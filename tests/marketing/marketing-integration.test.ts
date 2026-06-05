import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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
import { GET as referralGet } from '../../src/routes/api/marketing/referral/[shortcode]/+server';
import {
	assertProductionConfig,
	inspectProductionConfig,
	isProduction,
} from '$lib/env/production-config';

const SECRET = 'integration-test-secret-1234567890';
const ROOT = path.resolve(__dirname, '..', '..');

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

describe('marketing route group filesystem layout (blocker 4)', () => {
	it('has nested marketing under (marketing) group', () => {
		const p = path.join(ROOT, 'src/routes/(marketing)/marketing/+page.svelte');
		expect(fs.existsSync(p), `expected ${p}`).toBe(true);
	});
	it('has (marketing)/r/[shortcode]/+page.svelte', () => {
		const p = path.join(ROOT, 'src/routes/(marketing)/r/[shortcode]/+page.svelte');
		expect(fs.existsSync(p), `expected ${p}`).toBe(true);
	});
	it('has (marketing)/+layout.svelte', () => {
		const p = path.join(ROOT, 'src/routes/(marketing)/+layout.svelte');
		expect(fs.existsSync(p), `expected ${p}`).toBe(true);
	});
	it('legacy src/routes/marketing/ is gone', () => {
		const p = path.join(ROOT, 'src/routes/marketing/+page.svelte');
		expect(fs.existsSync(p)).toBe(false);
	});
	it('legacy src/routes/r/ is gone', () => {
		const p = path.join(ROOT, 'src/routes/r/[shortcode]/+page.svelte');
		expect(fs.existsSync(p)).toBe(false);
	});
});

describe('marketing landing cross-references (blocker 22)', () => {
	it('landing page links to /gift and /marketing/research / privacy', () => {
		const p = path.join(ROOT, 'src/routes/(marketing)/marketing/+page.svelte');
		const src = fs.readFileSync(p, 'utf8');
		expect(src).toContain('/gift');
		expect(src).toContain('/marketing/research');
		expect(src).toContain('/marketing/privacy');
	});
	it('read-along page links to /?ref={shortcode} so workshop entry can read it', () => {
		const p = path.join(ROOT, 'src/routes/(marketing)/r/[shortcode]/+page.svelte');
		const src = fs.readFileSync(p, 'utf8');
		expect(src).toContain('/?ref={shortcode}');
	});
	it('workshop entry +page.ts reads the ref query param (or workshop +page.svelte does)', () => {
		const ts = path.join(ROOT, 'src/routes/+page.ts');
		const sv = path.join(ROOT, 'src/routes/+page.svelte');
		const src = (fs.existsSync(ts) ? fs.readFileSync(ts, 'utf8') : '') + '\n' + fs.readFileSync(sv, 'utf8');
		// Either the load function or the page reads searchParams 'ref'
		// or persists it via referralCookie. We assert at least one of:
		const hasRefRead = /searchParams\.get\(['"]ref['"]\)/.test(src) || /url\.searchParams\.get\(['"]ref['"]\)/.test(src);
		expect(
			hasRefRead,
			'workshop entry should read ?ref= for grandparent attribution',
		).toBe(true);
	});
});

describe('referral GET location header safety (blocker 25)', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		__resetRateLimitersForTests();
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('only allows lowercase alphanumeric shortcodes through to Location', async () => {
		const valid = deps.referral.mintShortcode('p@example.com');
		const r = await referralGet({
			params: { shortcode: valid },
			url: new URL('http://localhost/api/marketing/referral/' + valid),
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(302);
		const loc = r.headers.get('location') ?? '';
		// Must be /?ref=<valid> with no smuggled CR/LF or non-alphabet chars
		expect(loc).toMatch(/^\/\?ref=[a-z2-9]{8,12}$/);
		expect(loc).not.toContain('\n');
		expect(loc).not.toContain('\r');
	});

	it('rejects uppercase / slash / control char shortcodes with 400', async () => {
		const r = await referralGet({
			params: { shortcode: 'BADSTUFF' },
			url: new URL('http://localhost/api/marketing/referral/BADSTUFF'),
			getClientAddress: () => '1.2.3.4',
		} as never);
		expect(r.status).toBe(400);
	});
});

describe('production-config helper (env-var discipline)', () => {
	beforeEach(() => {
		__resetMarketingApiDeps();
	});

	it('isProduction returns false in vitest by default', () => {
		expect(isProduction()).toBe(false);
	});

	it('inspectProductionConfig is ok when not in production', () => {
		const r = inspectProductionConfig();
		expect(r.ok).toBe(true);
	});

	it('inspectProductionConfig reports missing secrets in production', () => {
		const r = inspectProductionConfig({
			NODE_ENV: 'production',
		} as never);
		expect(r.ok).toBe(false);
		expect(r.missing).toContain('STORYBOOK_EMAIL_GATE_SECRET');
		expect(r.missing).toContain('CRON_SECRET');
	});

	it('assertProductionConfig throws on missing required vars', () => {
		expect(() => assertProductionConfig({ NODE_ENV: 'production' } as never)).toThrow(
			/STORYBOOK_EMAIL_GATE_SECRET/,
		);
	});

	it('inspectProductionConfig ok when all required vars set', () => {
		const r = inspectProductionConfig({
			NODE_ENV: 'production',
			STORYBOOK_EMAIL_GATE_SECRET: 'a'.repeat(32),
			CRON_SECRET: 'b'.repeat(32),
			RESEND_API_KEY: 'c'.repeat(16),
			RESEND_FROM: 'noreply@sw.example',
		} as never);
		expect(r.ok).toBe(true);
	});
});

describe('AbandonedCartService.track accepts shortcode', () => {
	let deps: MarketingDeps & { crm: MockCrmClient };
	beforeEach(() => {
		__resetRateLimitersForTests();
		deps = makeDeps();
		__setMarketingApiDeps(deps);
	});

	it('track({shortcode}) stores it on the cart for link composition', () => {
		const cart = deps.abandonedCart.track({
			parentEmail: 'p@example.com',
			kidId: 'kid-1',
			shortcode: 'abcd1234',
			bookCostCents: 3499,
		});
		expect(cart.shortcode).toBe('abcd1234');
	});

	it('track without shortcode throws', () => {
		expect(() =>
			deps.abandonedCart.track({
				parentEmail: 'p@example.com',
				kidId: 'kid-3',
				bookCostCents: 3499,
			} as never),
		).toThrow(/shortcode/);
	});
});
