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
import { mintUnsubToken } from '$lib/services/marketing/unsubToken';
import { __resetRateLimitersForTests } from '$lib/services/marketing/rateLimit';
import {
	__resetMarketingApiDeps,
	__setMarketingApiDeps,
	type MarketingDeps,
} from '../../src/routes/api/marketing/_shared';
import { POST as emailGatePost } from '../../src/routes/api/marketing/email-gate/+server';
import { POST as lifecycleTickPost } from '../../src/routes/api/marketing/lifecycle-tick/+server';
import { POST as abandonedCartTickPost } from '../../src/routes/api/marketing/abandoned-cart-tick/+server';
import { GET as referralGet } from '../../src/routes/api/marketing/referral/[shortcode]/+server';
import { GET as unsubGet, POST as unsubPost } from '../../src/routes/api/marketing/unsubscribe/+server';
import { POST as promoPost } from '../../src/routes/api/marketing/promo/[code]/+server';

const SECRET = 'test-secret-1234567890';

// _globalReset: drain rate-limit buckets between tests so per-IP throttle
// does not bleed across cases.
beforeEach(() => __resetRateLimitersForTests());

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
		publicUrlBase: 'https://sw.example',
		serverSecret: SECRET,
		gate,
	});
	const referral = new ReferralLinkService({
		crm,
		nowSource: () => now,
		publicUrlBase: 'https://sw.example',
	});
	const educationalDrip = new EducationalDripService({ crm, gate, nowSource: () => now, serverSecret: SECRET });
	const unsubscribe = new UnsubscribeService({ gate });
	return { crm, gate, lifecycle, abandonedCart, referral, educationalDrip, unsubscribe, promo, serverSecret: SECRET };
}

function jsonReq(body: unknown): Request {
	return new Request('http://localhost/x', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('/api/marketing/email-gate POST', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('records a fresh email + sets cookie + fires gate_unlock', async () => {
		const r = await emailGatePost({
			request: jsonReq({ email: 'p@example.com', shortcode: 'abcd1234' }),
			getClientAddress: () => "1.2.3.4",
			url: new URL("http://localhost/api/marketing/email-gate"),
		} as never);
		const body = (await r.json()) as { ok: boolean; unlocked: boolean; reused: boolean };
		expect(body.ok).toBe(true);
		expect(body.unlocked).toBe(true);
		expect(body.reused).toBe(false);
		const cookie = r.headers.get('set-cookie');
		expect(cookie).toMatch(/^swEmailGate_abcd1234=/);
		expect(cookie).toContain('HttpOnly');
		// Drain async send
		await new Promise((res) => setTimeout(res, 5));
		expect(deps.crm.sentByTemplate('gate_unlock')).toHaveLength(1);
	});

	it('returns 400 invalid_json on bad body', async () => {
		const r = await emailGatePost({
			request: new Request('http://localhost/x', {
				method: 'POST',
				body: 'not-json',
			}),
			getClientAddress: () => "1.2.3.4",
			url: new URL("http://localhost/api/marketing/email-gate"),
		} as never);
		expect(r.status).toBe(400);
	});

	it('returns 400 missing_field email', async () => {
		const r = await emailGatePost({
			request: jsonReq({ shortcode: 'abcd1234' }),
			getClientAddress: () => "1.2.3.4",
			url: new URL("http://localhost/api/marketing/email-gate"),
		} as never);
		expect(r.status).toBe(400);
		const body = (await r.json()) as { field?: string };
		expect(body.field).toBe('email');
	});

	it('returns 400 invalid_email', async () => {
		const r = await emailGatePost({
			request: jsonReq({ email: 'bad', shortcode: 'abcd1234' }),
			getClientAddress: () => "1.2.3.4",
			url: new URL("http://localhost/api/marketing/email-gate"),
		} as never);
		expect(r.status).toBe(400);
		const body = (await r.json()) as { error?: string };
		expect(body.error).toBe('invalid_email');
	});

	it('is idempotent on resubmit (reused: true, no second email)', async () => {
		await emailGatePost({
			request: jsonReq({ email: 'p@example.com', shortcode: 'abcd1234' }),
			getClientAddress: () => "1.2.3.4",
			url: new URL("http://localhost/api/marketing/email-gate"),
		} as never);
		await new Promise((res) => setTimeout(res, 5));
		const r2 = await emailGatePost({
			request: jsonReq({ email: 'p@example.com', shortcode: 'abcd1234' }),
			getClientAddress: () => "1.2.3.4",
			url: new URL("http://localhost/api/marketing/email-gate"),
		} as never);
		const body = (await r2.json()) as { reused: boolean };
		expect(body.reused).toBe(true);
		await new Promise((res) => setTimeout(res, 5));
		expect(deps.crm.sentByTemplate('gate_unlock')).toHaveLength(1);
	});
});

describe('/api/marketing/lifecycle-tick POST', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('runs tick and returns report', async () => {
		const rec = await deps.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		// Simulate the email-gate POST endpoint successfully sending gate_unlock
		// — this test scopes the tick report to lifecycle_T0 only, not retry.
		rec.contact.templateLastSentAt['gate_unlock'] = 0;
		const r = await lifecycleTickPost({
			request: new Request('http://localhost/x', { method: 'POST' }),
		} as never);
		expect(r.status).toBe(200);
		const body = (await r.json()) as { ok: boolean; report: { sent: number } };
		expect(body.ok).toBe(true);
		expect(body.report.sent).toBe(1);
	});
});

describe('/api/marketing/abandoned-cart-tick POST', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('runs tick and returns report', async () => {
		deps.abandonedCart.track({
			parentEmail: 'p@example.com',
			kidId: 'k',
			shortcode: 'b',
			bookCostCents: 3499,
		});
		const r = await abandonedCartTickPost({
			request: new Request('http://localhost/x', { method: 'POST' }),
		} as never);
		expect(r.status).toBe(200);
		const body = (await r.json()) as { ok: boolean; report: { scanned: number } };
		expect(body.report.scanned).toBe(1);
	});
});

describe('/api/marketing/referral/[shortcode] GET', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('302s on valid shortcode and records click', async () => {
		const code = deps.referral.mintShortcode('p@example.com');
		const r = await referralGet({ params: { shortcode: code }, url: new URL("http://localhost/api/marketing/referral/" + code), getClientAddress: () => "1.2.3.4" } as never);
		expect(r.status).toBe(302);
		expect(r.headers.get('location')).toContain(`/?ref=${code}`);
		expect(r.headers.get('set-cookie')).toMatch(/swReferral=/);
		expect(deps.referral.clickCount(code)).toBe(1);
	});

	it('404 on unknown shortcode', async () => {
		const r = await referralGet({ params: { shortcode: 'unknownxxx' } } as never);
		expect(r.status).toBe(404);
	});

	it('400 on invalid shortcode format', async () => {
		const r = await referralGet({ params: { shortcode: 'BAD/STUFF' } } as never);
		expect(r.status).toBe(400);
	});
});

describe('/api/marketing/unsubscribe GET + POST', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('GET ?email=&type=marketing&token=<hmac> unsubscribes', async () => {
		await deps.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const token = await mintUnsubToken({ email: 'p@example.com', bucket: 'marketing', secret: SECRET });
		const url = new URL(`http://localhost/api/marketing/unsubscribe?email=p%40example.com&type=marketing&token=${token}`);
		const r = await unsubGet({ url } as never);
		expect(r.status).toBe(200);
		const body = (await r.json()) as { ok: boolean; bucket: string };
		expect(body.ok).toBe(true);
		expect(body.bucket).toBe('marketing');
		expect(deps.gate.getContact('p@example.com')?.unsubscribed.marketing).toBe(true);
	});

	it('GET returns 401 when token is missing (anti-victim-unsub)', async () => {
		await deps.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const url = new URL('http://localhost/api/marketing/unsubscribe?email=p%40example.com&type=marketing');
		const r = await unsubGet({ url } as never);
		expect(r.status).toBe(401);
		const body = (await r.json()) as { error: string };
		expect(body.error).toBe('missing_token');
		expect(deps.gate.getContact('p@example.com')?.unsubscribed.marketing).toBe(false);
	});

	it('GET returns 401 when token is for a different email', async () => {
		await deps.gate.record({ email: 'victim@example.com', shortcode: 'abcd1234' });
		const attackerToken = await mintUnsubToken({ email: 'attacker@example.com', bucket: 'marketing', secret: SECRET });
		const url = new URL(`http://localhost/api/marketing/unsubscribe?email=victim%40example.com&type=marketing&token=${attackerToken}`);
		const r = await unsubGet({ url } as never);
		expect(r.status).toBe(401);
		expect(deps.gate.getContact('victim@example.com')?.unsubscribed.marketing).toBe(false);
	});

	it('GET returns 400 on invalid bucket', async () => {
		const url = new URL('http://localhost/api/marketing/unsubscribe?email=p%40x.com&type=bad');
		const r = await unsubGet({ url } as never);
		expect(r.status).toBe(400);
	});

	it('GET returns 400 on missing email', async () => {
		const url = new URL('http://localhost/api/marketing/unsubscribe?type=marketing');
		const r = await unsubGet({ url } as never);
		expect(r.status).toBe(400);
	});

	it('GET returns ok:false but 200 on unknown email (no enumeration)', async () => {
		const token = await mintUnsubToken({ email: 'ghost@x.com', bucket: 'marketing', secret: SECRET });
		const url = new URL(`http://localhost/api/marketing/unsubscribe?email=ghost%40x.com&type=marketing&token=${token}`);
		const r = await unsubGet({ url } as never);
		expect(r.status).toBe(200);
		const body = (await r.json()) as { ok: boolean };
		expect(body.ok).toBe(false);
	});

	it('POST body { email, type, token } unsubscribes', async () => {
		await deps.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const token = await mintUnsubToken({ email: 'p@example.com', bucket: 'educational', secret: SECRET });
		const r = await unsubPost({
			request: jsonReq({ email: 'p@example.com', type: 'educational', token }),
			url: new URL('http://localhost/api/marketing/unsubscribe'),
		} as never);
		expect(r.status).toBe(200);
		const body = (await r.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
	});

	it('POST returns 401 when token is missing', async () => {
		await deps.gate.record({ email: 'p@example.com', shortcode: 'abcd1234' });
		const r = await unsubPost({
			request: jsonReq({ email: 'p@example.com', type: 'educational' }),
			url: new URL('http://localhost/api/marketing/unsubscribe'),
		} as never);
		expect(r.status).toBe(401);
	});
});

describe('/api/marketing/promo/[code] POST', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('applies BEDTIME10 to a $34.99 subtotal', async () => {
		const r = await promoPost({
			params: { code: 'BEDTIME10' },
			request: jsonReq({ parentEmail: 'p@example.com', subtotalCents: 3499 }),
		} as never);
		expect(r.status).toBe(200);
		const body = (await r.json()) as {
			ok: boolean;
			discountCents: number;
			finalCents: number;
			code?: { code: string };
		};
		expect(body.ok).toBe(true);
		expect(body.discountCents).toBe(349);
		expect(body.finalCents).toBe(3150);
		expect(body.code?.code).toBe('BEDTIME10');
	});

	it('rejects unknown code with 400', async () => {
		const r = await promoPost({
			params: { code: 'BADCODE' },
			request: jsonReq({ parentEmail: 'p@example.com', subtotalCents: 1000 }),
		} as never);
		expect(r.status).toBe(400);
		const body = (await r.json()) as { error?: string };
		expect(body.error).toBe('unknown');
	});

	it('rejects missing parentEmail', async () => {
		const r = await promoPost({
			params: { code: 'BEDTIME10' },
			request: jsonReq({ subtotalCents: 1000 }),
		} as never);
		expect(r.status).toBe(400);
	});

	it('rejects invalid subtotal', async () => {
		const r = await promoPost({
			params: { code: 'BEDTIME10' },
			request: jsonReq({ parentEmail: 'p@example.com', subtotalCents: -1 }),
		} as never);
		expect(r.status).toBe(400);
	});
});

describe('cron auth gate', () => {
	beforeEach(() => __resetMarketingApiDeps());

	it('rejects lifecycle-tick when CRON_SECRET is set and Authorization missing', async () => {
		const prev = process.env.CRON_SECRET;
		process.env.CRON_SECRET = 'topsecret';
		try {
			const deps = makeDeps();
			__setMarketingApiDeps(deps);
			const r = await lifecycleTickPost({
				request: new Request('http://localhost/x', { method: 'POST' }),
			} as never);
			expect(r.status).toBe(401);
		} finally {
			if (prev === undefined) delete process.env.CRON_SECRET;
			else process.env.CRON_SECRET = prev;
		}
	});

	it('accepts lifecycle-tick when Authorization Bearer matches', async () => {
		const prev = process.env.CRON_SECRET;
		process.env.CRON_SECRET = 'topsecret';
		try {
			const deps = makeDeps();
			__setMarketingApiDeps(deps);
			const r = await lifecycleTickPost({
				request: new Request('http://localhost/x', {
					method: 'POST',
					headers: { authorization: 'Bearer topsecret' },
				}),
			} as never);
			expect(r.status).toBe(200);
		} finally {
			if (prev === undefined) delete process.env.CRON_SECRET;
			else process.env.CRON_SECRET = prev;
		}
	});
});
