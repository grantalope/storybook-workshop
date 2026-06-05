import { describe, expect, it } from 'vitest';
import {
	MockCrmClient,
	ReferralLinkService,
	REFERRAL_CREDIT_CENTS,
} from '$lib/services/marketing';

describe('ReferralLinkService', () => {
	function setup() {
		let now = 0;
		const crm = new MockCrmClient(() => now);
		const svc = new ReferralLinkService({
			crm,
			nowSource: () => now,
			publicUrlBase: 'https://sw.example',
		});
		return {
			svc,
			crm,
			setNow(v: number) {
				now = v;
			},
		};
	}

	it('mints unique 10-char shortcodes', () => {
		const ctx = setup();
		const a = ctx.svc.mintShortcode('p@example.com');
		const b = ctx.svc.mintShortcode('p@example.com');
		expect(a).toHaveLength(10);
		expect(b).toHaveLength(10);
		expect(a).not.toBe(b);
	});

	it('rejects invalid email at mint time', () => {
		const ctx = setup();
		expect(() => ctx.svc.mintShortcode('not-an-email')).toThrow();
	});

	it('builds shareUrl using publicUrlBase', () => {
		const ctx = setup();
		const code = ctx.svc.mintShortcode('p@example.com');
		expect(ctx.svc.shareUrl(code)).toBe(`https://sw.example/r/${code}`);
	});

	it('records clicks aggregate-only', () => {
		const ctx = setup();
		const code = ctx.svc.mintShortcode('p@example.com');
		ctx.svc.recordClick(code);
		ctx.svc.recordClick(code);
		ctx.svc.recordClick(code);
		expect(ctx.svc.clickCount(code)).toBe(3);
	});

	it('throws on unknown shortcode click', () => {
		const ctx = setup();
		expect(() => ctx.svc.recordClick('badcode000')).toThrow();
	});

	it('grandparent purchase triggers $5 credit + email', async () => {
		const ctx = setup();
		const code = ctx.svc.mintShortcode('p@example.com');
		const { conversion, credit } = await ctx.svc.recordConversion({
			shortcode: code,
			paymentId: 'pi_1',
			purchaseCents: 3499,
			isGrandparentPurchase: true,
		});
		expect(conversion.shortcode).toBe(code);
		expect(credit?.creditCents).toBe(REFERRAL_CREDIT_CENTS);
		expect(ctx.svc.totalCreditCentsFor('p@example.com')).toBe(500);
		expect(ctx.crm.sentByTemplate('referral_credit_awarded')).toHaveLength(1);
	});

	it('non-grandparent purchase does NOT award credit', async () => {
		const ctx = setup();
		const code = ctx.svc.mintShortcode('p@example.com');
		const { credit } = await ctx.svc.recordConversion({
			shortcode: code,
			paymentId: 'pi_1',
			purchaseCents: 3499,
			isGrandparentPurchase: false,
		});
		expect(credit).toBeUndefined();
		expect(ctx.svc.totalCreditCentsFor('p@example.com')).toBe(0);
	});

	it('conversion is idempotent on paymentId', async () => {
		const ctx = setup();
		const code = ctx.svc.mintShortcode('p@example.com');
		await ctx.svc.recordConversion({
			shortcode: code,
			paymentId: 'pi_1',
			purchaseCents: 3499,
			isGrandparentPurchase: true,
		});
		await ctx.svc.recordConversion({
			shortcode: code,
			paymentId: 'pi_1',
			purchaseCents: 3499,
			isGrandparentPurchase: true,
		});
		expect(ctx.svc.totalCreditCentsFor('p@example.com')).toBe(500);
		expect(ctx.crm.sentByTemplate('referral_credit_awarded')).toHaveLength(1);
	});

	it('resolves originating parent for a shortcode', () => {
		const ctx = setup();
		const code = ctx.svc.mintShortcode('p@example.com');
		expect(ctx.svc.parentForShortcode(code)).toBe('p@example.com');
		expect(ctx.svc.parentForShortcode('missing000')).toBeUndefined();
	});

	it('snapshots aggregate counters', async () => {
		const ctx = setup();
		const c1 = ctx.svc.mintShortcode('p@example.com');
		const c2 = ctx.svc.mintShortcode('p2@example.com');
		ctx.svc.recordClick(c1);
		ctx.svc.recordClick(c1);
		ctx.svc.recordClick(c2);
		await ctx.svc.recordConversion({
			shortcode: c1,
			paymentId: 'pi_1',
			purchaseCents: 3499,
			isGrandparentPurchase: true,
		});
		await ctx.svc.recordConversion({
			shortcode: c2,
			paymentId: 'pi_2',
			purchaseCents: 3499,
			isGrandparentPurchase: false,
		});
		const s = ctx.svc.snapshot();
		expect(s.shortcodes).toBe(2);
		expect(s.clicks).toBe(3);
		expect(s.conversions).toBe(2);
		expect(s.giftConversions).toBe(1);
		expect(s.creditCents).toBe(500);
	});

	it('codeGen override mints deterministic codes', () => {
		let i = 0;
		const ctx = setup();
		const svc = new ReferralLinkService({
			crm: ctx.crm,
			nowSource: () => 0,
			codeGen: () => `tttttttt0${i++}`,
		});
		const a = svc.mintShortcode('p@example.com');
		const b = svc.mintShortcode('p@example.com');
		expect(a).not.toBe(b);
		expect(a.startsWith('tttttttt0')).toBe(true);
	});
});
