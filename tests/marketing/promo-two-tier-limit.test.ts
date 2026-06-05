// tests/marketing/promo-two-tier-limit.test.ts
//
// Regression test for blocker #2: anonymous promo requests must be
// rate-limited at the tighter 10/IP/hour tier; cookie-bearing requests
// at the standard 30/IP/hour tier. Pre-fix both paths shared the 30/hour
// pool — anonymous code enumeration was bounded only by the single limit.

import { beforeEach, describe, expect, it } from 'vitest';
import {
	AbandonedCartService,
	EducationalDripService,
	EmailGateService,
	LifecycleEmailService,
	MockCrmClient,
	PromoCodeService,
	ReferralLinkService,
	UnsubscribeService,
} from '$lib/services/marketing';
import { __resetRateLimitersForTests } from '$lib/services/marketing/rateLimit';
import {
	__resetMarketingApiDeps,
	__setMarketingApiDeps,
	type MarketingDeps,
} from '../../src/routes/api/marketing/_shared';
import { POST as promoPost } from '../../src/routes/api/marketing/promo/[code]/+server';

const SECRET = 'test-secret-1234567890';

function makeDeps(): MarketingDeps & { crm: MockCrmClient } {
	let now = 0;
	const crm = new MockCrmClient(() => now);
	const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
	const promo = new PromoCodeService({ nowSource: () => now });
	const lifecycle = new LifecycleEmailService({ crm, gate, nowSource: () => now, serverSecret: SECRET });
	const abandonedCart = new AbandonedCartService({
		crm,
		promo,
		nowSource: () => now,
		serverSecret: SECRET,
		gate,
	});
	const referral = new ReferralLinkService({ crm, nowSource: () => now });
	const educationalDrip = new EducationalDripService({ crm, gate, nowSource: () => now, serverSecret: SECRET });
	const unsubscribe = new UnsubscribeService({ gate });
	return { crm, gate, lifecycle, abandonedCart, referral, educationalDrip, unsubscribe, promo, serverSecret: SECRET };
}

function jsonReqWithCookie(body: unknown, cookie?: string): Request {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (cookie) headers.cookie = cookie;
	return new Request('http://localhost/x', {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	});
}

describe('promo two-tier rate limit', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		__resetRateLimitersForTests();
		__resetMarketingApiDeps();
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('anonymous (no cookie) tier caps at 10/IP/hour, cookie-present tier permits more', async () => {
		const anonIp = '9.9.9.9';
		// Anonymous: 10 should succeed, 11th 429.
		for (let i = 0; i < 10; i++) {
			const r = await promoPost({
				params: { code: 'BEDTIME10' },
				request: jsonReqWithCookie({ parentEmail: 'p@example.com', subtotalCents: 1000 }),
				getClientAddress: () => anonIp,
			} as never);
			expect(r.status, `anon iter ${i}`).toBe(200);
		}
		const blocked = await promoPost({
			params: { code: 'BEDTIME10' },
			request: jsonReqWithCookie({ parentEmail: 'p@example.com', subtotalCents: 1000 }),
			getClientAddress: () => anonIp,
		} as never);
		expect(blocked.status).toBe(429);

		// Cookie-bearing IP gets the 30/hour tier. Mint a real cookie so the
		// presence-check (swEmailGate_*) trips.
		const cookieIp = '5.5.5.5';
		const rec = await deps.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const cookie = `swEmailGate_abcd1234=${rec.cookieValue}`;
		// 11 should still pass — anonymous tier is bypassed because cookie present.
		for (let i = 0; i < 11; i++) {
			const r = await promoPost({
				params: { code: 'BEDTIME10' },
				request: jsonReqWithCookie(
					{ parentEmail: 'p@example.com', subtotalCents: 1000, shortcode: 'abcd1234' },
					cookie,
				),
				getClientAddress: () => cookieIp,
			} as never);
			expect(r.status, `cookie iter ${i}`).toBe(200);
		}
	});

	it('anonymous tier exhaustion does NOT exhaust the cookie-bearing tier on the same IP', async () => {
		const ip = '7.7.7.7';
		// Exhaust anonymous tier.
		for (let i = 0; i < 10; i++) {
			await promoPost({
				params: { code: 'BEDTIME10' },
				request: jsonReqWithCookie({ parentEmail: 'p@example.com', subtotalCents: 1000 }),
				getClientAddress: () => ip,
			} as never);
		}
		const blocked = await promoPost({
			params: { code: 'BEDTIME10' },
			request: jsonReqWithCookie({ parentEmail: 'p@example.com', subtotalCents: 1000 }),
			getClientAddress: () => ip,
		} as never);
		expect(blocked.status).toBe(429);
		// Same IP with a real cookie should still succeed — different limiter.
		const rec = await deps.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const cookie = `swEmailGate_abcd1234=${rec.cookieValue}`;
		const okWithCookie = await promoPost({
			params: { code: 'BEDTIME10' },
			request: jsonReqWithCookie(
				{ parentEmail: 'p@example.com', subtotalCents: 1000, shortcode: 'abcd1234' },
				cookie,
			),
			getClientAddress: () => ip,
		} as never);
		expect(okWithCookie.status).toBe(200);
	});
});
