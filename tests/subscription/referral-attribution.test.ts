// tests/storybook-workshop/subscription/referral-attribution.test.ts
//
// Covers:
// - mintShortcode + click counter
// - recordConversion (gift purchase) → $5 credit + email
// - non-gift conversion → no credit
// - paymentId idempotency
// - per-parent totalCreditCentsFor
// - unknown shortcode throws

import { describe, it, expect, beforeEach } from 'vitest';
import {
	REFERRAL_CREDIT_CENTS,
	ReferralAttribution,
	SHORTCODE_LENGTH,
} from '$lib/services/subscription';
import { createMockMailer, makeReferralShortcodeGen } from './fixtures';

describe('ReferralAttribution.mintShortcode', () => {
	let mailer: ReturnType<typeof createMockMailer>;
	let svc: ReferralAttribution;

	beforeEach(() => {
		mailer = createMockMailer();
		svc = new ReferralAttribution({
			mailer,
			nowSource: () => 1_700_000_000_000,
			codeGen: makeReferralShortcodeGen(),
		});
	});

	it('mints a fresh shortcode each call', () => {
		const a = svc.mintShortcode('parent@example.com');
		const b = svc.mintShortcode('parent@example.com');
		expect(a).not.toBe(b);
	});

	it('rejects invalid email', () => {
		expect(() => svc.mintShortcode('not-an-email')).toThrow(/invalid email/);
	});

	it('default shortcode generator length is SHORTCODE_LENGTH', () => {
		const svc2 = new ReferralAttribution({
			mailer,
			nowSource: () => 1_700_000_000_000,
		});
		const code = svc2.mintShortcode('parent@example.com');
		expect(code).toHaveLength(SHORTCODE_LENGTH);
	});
});

describe('ReferralAttribution.recordClick', () => {
	let svc: ReferralAttribution;

	beforeEach(() => {
		svc = new ReferralAttribution({
			mailer: createMockMailer(),
			nowSource: () => 1_700_000_000_000,
			codeGen: makeReferralShortcodeGen(),
		});
	});

	it('increments click count', () => {
		const code = svc.mintShortcode('parent@example.com');
		svc.recordClick(code);
		svc.recordClick(code);
		svc.recordClick(code);
		expect(svc.clickCount(code)).toBe(3);
	});

	it('throws on unknown shortcode', () => {
		expect(() => svc.recordClick('nope')).toThrow(/unknown shortcode/);
	});
});

describe('ReferralAttribution.recordConversion — gift purchase', () => {
	let mailer: ReturnType<typeof createMockMailer>;
	let svc: ReferralAttribution;

	beforeEach(() => {
		mailer = createMockMailer();
		svc = new ReferralAttribution({
			mailer,
			nowSource: () => 1_700_000_000_000,
			codeGen: makeReferralShortcodeGen(),
		});
	});

	it('awards $5 credit + sends email', async () => {
		const code = svc.mintShortcode('parent@example.com');
		const { credit } = await svc.recordConversion({
			shortcode: code,
			paymentId: 'pi_test_1',
			purchaseCents: 27999,
			isGiftPurchase: true,
		});
		expect(credit).toBeDefined();
		expect(credit!.creditCents).toBe(REFERRAL_CREDIT_CENTS);
		expect(credit!.originatingParentEmail).toBe('parent@example.com');
		expect(mailer.calls.find((c) => c.kind === 'referral_credit_awarded')).toBeDefined();
	});

	it('non-gift purchase does NOT award credit', async () => {
		const code = svc.mintShortcode('parent@example.com');
		const { credit } = await svc.recordConversion({
			shortcode: code,
			paymentId: 'pi_test_2',
			purchaseCents: 3499,
			isGiftPurchase: false,
		});
		expect(credit).toBeUndefined();
	});

	it('paymentId idempotent — same paymentId is a no-op', async () => {
		const code = svc.mintShortcode('parent@example.com');
		await svc.recordConversion({
			shortcode: code,
			paymentId: 'pi_dupe',
			purchaseCents: 27999,
			isGiftPurchase: true,
		});
		const second = await svc.recordConversion({
			shortcode: code,
			paymentId: 'pi_dupe',
			purchaseCents: 27999,
			isGiftPurchase: true,
		});
		expect(second.credit).toBeUndefined();
		expect(svc.conversionsFor(code)).toHaveLength(1);
	});

	it('multiple shortcodes for same parent aggregate credits', async () => {
		const a = svc.mintShortcode('parent@example.com');
		const b = svc.mintShortcode('parent@example.com');
		await svc.recordConversion({
			shortcode: a,
			paymentId: 'p1',
			purchaseCents: 27999,
			isGiftPurchase: true,
		});
		await svc.recordConversion({
			shortcode: b,
			paymentId: 'p2',
			purchaseCents: 14999,
			isGiftPurchase: true,
		});
		expect(svc.totalCreditCentsFor('parent@example.com')).toBe(2 * REFERRAL_CREDIT_CENTS);
	});

	it('snapshot reports aggregate counts', async () => {
		const a = svc.mintShortcode('parent@example.com');
		svc.recordClick(a);
		svc.recordClick(a);
		await svc.recordConversion({
			shortcode: a,
			paymentId: 'p1',
			purchaseCents: 14999,
			isGiftPurchase: true,
		});
		const snap = svc.snapshot();
		expect(snap.shortcodes).toBe(1);
		expect(snap.totalClicks).toBe(2);
		expect(snap.totalConversions).toBe(1);
		expect(snap.totalGiftConversions).toBe(1);
		expect(snap.totalCreditCents).toBe(REFERRAL_CREDIT_CENTS);
	});
});

describe('ReferralAttribution.recordConversion — unknown shortcode', () => {
	it('throws', async () => {
		const svc = new ReferralAttribution({
			mailer: createMockMailer(),
			nowSource: () => 1_700_000_000_000,
		});
		await expect(
			svc.recordConversion({
				shortcode: 'nope',
				paymentId: 'p1',
				purchaseCents: 100,
				isGiftPurchase: true,
			})
		).rejects.toThrow(/unknown shortcode/);
	});
});
