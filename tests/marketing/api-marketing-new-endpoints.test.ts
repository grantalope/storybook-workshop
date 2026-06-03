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
import {
	POST as cartAbandonedPost,
	DELETE as cartAbandonedDelete,
} from '../../src/routes/api/marketing/cart-abandoned/+server';
import { POST as referralMintPost } from '../../src/routes/api/marketing/referral/mint/+server';
import { POST as referralPost } from '../../src/routes/api/marketing/referral/[shortcode]/+server';
import { POST as promoPost } from '../../src/routes/api/marketing/promo/[code]/+server';

const SECRET = 'test-new-tests-secret-1234567890';

function makeDeps(): MarketingDeps & { crm: MockCrmClient } {
	let now = 0;
	const crm = new MockCrmClient(() => now);
	const gate = new EmailGateService({ serverSecret: SECRET, nowSource: () => now });
	const promo = new PromoCodeService({ nowSource: () => now });
	const lifecycle = new LifecycleEmailService({
		crm,
		gate,
		nowSource: () => now,
		serverSecret: SECRET,
	});
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
	const educationalDrip = new EducationalDripService({
		crm,
		gate,
		nowSource: () => now,
		serverSecret: SECRET,
	});
	const unsubscribe = new UnsubscribeService({ gate });
	return {
		crm,
		gate,
		lifecycle,
		abandonedCart,
		referral,
		educationalDrip,
		unsubscribe,
		promo,
		serverSecret: SECRET,
	};
}

function jsonReq(body: unknown): Request {
	return new Request('http://localhost/x', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('/api/marketing/cart-abandoned (blocker 5 wiring)', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		__resetRateLimitersForTests();
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('POST registers a Station-7 abandonment', async () => {
		const r = await cartAbandonedPost({
			request: jsonReq({
				parentEmail: 'p@example.com',
				kidId: 'kid-1',
				shortcode: 'abcd1234',
				bookCostCents: 3499,
			}),
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(200);
		const cart = deps.abandonedCart.getCart('p@example.com', 'kid-1');
		expect(cart).toBeDefined();
		expect(cart?.bookId).toBe('abcd1234');
		expect(cart?.bookCostCents).toBe(3499);
	});

	it('POST 400 on missing parentEmail', async () => {
		const r = await cartAbandonedPost({
			request: jsonReq({ kidId: 'kid-1', shortcode: 'abcd1234', bookCostCents: 3499 }),
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(400);
	});

	it('DELETE resolves an existing cart', async () => {
		deps.abandonedCart.track({
			parentEmail: 'p@example.com',
			kidId: 'kid-1',
			bookId: 'abcd1234',
			bookCostCents: 3499,
		});
		const url = new URL(
			'http://localhost/api/marketing/cart-abandoned?parentEmail=p%40example.com&kidId=kid-1',
		);
		const r = await cartAbandonedDelete({
			request: jsonReq({}),
			url,
		} as never);
		expect(r.status).toBe(200);
		const body = (await r.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
		expect(deps.abandonedCart.getCart('p@example.com', 'kid-1')?.resolved).toBe(true);
	});
});

describe('/api/marketing/referral/mint (blocker 6 wiring)', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		__resetRateLimitersForTests();
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('mints a shortcode for an originating parent', async () => {
		const r = await referralMintPost({
			request: jsonReq({ originatingParentEmail: 'p@example.com' }),
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(200);
		const body = (await r.json()) as {
			ok: boolean;
			shortcode: string;
			shareUrl: string;
		};
		expect(body.ok).toBe(true);
		expect(body.shortcode).toMatch(/^[a-z2-9]{8,12}$/);
		expect(body.shareUrl).toContain('/r/');
		expect(deps.referral.parentForShortcode(body.shortcode)).toBe('p@example.com');
	});

	it('400 on missing originatingParentEmail', async () => {
		const r = await referralMintPost({
			request: jsonReq({}),
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(400);
	});

	it('400 on invalid email', async () => {
		const r = await referralMintPost({
			request: jsonReq({ originatingParentEmail: 'not-an-email' }),
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(400);
	});
});

describe('/api/marketing/referral/[shortcode] POST (track-only, blocker 18)', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		__resetRateLimitersForTests();
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('records a click without redirecting', async () => {
		const code = deps.referral.mintShortcode('p@example.com');
		const r = await referralPost({
			params: { shortcode: code },
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(200);
		expect(deps.referral.clickCount(code)).toBe(1);
	});

	it('400 on invalid shortcode format', async () => {
		const r = await referralPost({
			params: { shortcode: 'BAD/STUFF' },
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(400);
	});

	it('404 on unknown shortcode', async () => {
		const r = await referralPost({
			params: { shortcode: 'unknownxxx' },
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(404);
	});
});

describe('/api/marketing/promo/[code] hardening (blocker 7)', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		__resetRateLimitersForTests();
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('returns 429 after rate limit exceeded', async () => {
		const reqGen = () => ({
			params: { code: 'BEDTIME10' },
			request: jsonReq({ parentEmail: 'p@example.com', subtotalCents: 1000 }),
			getClientAddress: () => '9.9.9.9',
		});
		for (let i = 0; i < 30; i++) {
			await promoPost(reqGen() as never);
		}
		const r = await promoPost(reqGen() as never);
		expect(r.status).toBe(429);
	});

	it('rejects when gate cookie email does not match body parentEmail', async () => {
		const realEmail = 'victim@example.com';
		const result = await deps.gate.record({ email: realEmail, shortcode: 'abcd1234' });
		const cookie = result.cookieValue;
		const r = await promoPost({
			params: { code: 'BEDTIME10' },
			request: new Request('http://localhost/x', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					cookie: `swEmailGate_abcd1234=${cookie}`,
				},
				body: JSON.stringify({
					parentEmail: 'attacker@example.com',
					subtotalCents: 3499,
					shortcode: 'abcd1234',
				}),
			}),
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(401);
	});
});

describe('cron auth gate (blocker 2: fail-closed when CRON_SECRET unset in prod)', () => {
	beforeEach(() => {
		__resetMarketingApiDeps();
		__resetRateLimitersForTests();
	});

	it('lifecycle-tick rejects when CRON_SECRET is unset in production', async () => {
		const { POST: lifecycleTickPost } = await import(
			'../../src/routes/api/marketing/lifecycle-tick/+server'
		);
		const prevNode = process.env.NODE_ENV;
		const prevSecret = process.env.CRON_SECRET;
		const prevVitest = process.env.VITEST;
		const prevVitestWorker = process.env.VITEST_WORKER_ID;
		process.env.NODE_ENV = 'production';
		delete process.env.CRON_SECRET;
		delete process.env.VITEST;
		delete process.env.VITEST_WORKER_ID;
		try {
			const deps = makeDeps();
			__setMarketingApiDeps(deps);
			const r = await lifecycleTickPost({
				request: new Request('http://localhost/x', { method: 'POST' }),
			} as never);
			expect(r.status).toBe(401);
			const body = (await r.json()) as { reason?: string };
			expect(body.reason).toBe('cron_secret_unconfigured');
		} finally {
			if (prevNode === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = prevNode;
			if (prevSecret !== undefined) process.env.CRON_SECRET = prevSecret;
			if (prevVitest !== undefined) process.env.VITEST = prevVitest;
			if (prevVitestWorker !== undefined) process.env.VITEST_WORKER_ID = prevVitestWorker;
		}
	});

	it('abandoned-cart-tick rejects when bearer is wrong', async () => {
		const { POST: abandonedTickPost } = await import(
			'../../src/routes/api/marketing/abandoned-cart-tick/+server'
		);
		const prevSecret = process.env.CRON_SECRET;
		process.env.CRON_SECRET = 'topsecret';
		try {
			const deps = makeDeps();
			__setMarketingApiDeps(deps);
			const r = await abandonedTickPost({
				request: new Request('http://localhost/x', {
					method: 'POST',
					headers: { authorization: 'Bearer wrong' },
				}),
			} as never);
			expect(r.status).toBe(401);
		} finally {
			if (prevSecret === undefined) delete process.env.CRON_SECRET;
			else process.env.CRON_SECRET = prevSecret;
		}
	});

	it('lifecycle-tick rejects malformed Authorization header', async () => {
		const { POST: lifecycleTickPost } = await import(
			'../../src/routes/api/marketing/lifecycle-tick/+server'
		);
		const prevSecret = process.env.CRON_SECRET;
		process.env.CRON_SECRET = 'topsecret';
		try {
			const deps = makeDeps();
			__setMarketingApiDeps(deps);
			const r = await lifecycleTickPost({
				request: new Request('http://localhost/x', {
					method: 'POST',
					headers: { authorization: 'topsecret' },
				}),
			} as never);
			expect(r.status).toBe(401);
		} finally {
			if (prevSecret === undefined) delete process.env.CRON_SECRET;
			else process.env.CRON_SECRET = prevSecret;
		}
	});
});
