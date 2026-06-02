// tests/storybook-workshop/subscription/gift-flow-service.test.ts
//
// Covers:
// - Recurring gift creates Stripe checkout in 'subscription' mode
// - Bundle gift creates Stripe checkout in 'payment' mode
// - Receipt + invite emails sent
// - Recipient redeem → creates Subscription (recurring) or Bundle (prepaid)
// - buildDedicationOverride returns card-from-giver shape
// - Card length > 500 rejected
// - Duplicate redeem throws

import { describe, it, expect, beforeEach } from 'vitest';
import {
	BundleService,
	GiftFlowService,
	SubscriptionService,
} from '$lib/services/subscription';
import {
	createMockMailer,
	createMockPayment,
	makeClock,
	makeIdGen,
	makeRedeemCodeGen,
} from './fixtures';

describe('GiftFlowService.createGift — recurring', () => {
	let payment: ReturnType<typeof createMockPayment>;
	let mailer: ReturnType<typeof createMockMailer>;
	let subs: SubscriptionService;
	let bundles: BundleService;
	let svc: GiftFlowService;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		payment = createMockPayment();
		mailer = createMockMailer();
		const clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		bundles = new BundleService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('bundle'),
		});
		svc = new GiftFlowService({
			payment,
			mailer,
			subscriptions: subs,
			bundles,
			nowSource: clock.now,
			idGen: makeIdGen('gift'),
			redeemCodeGen: makeRedeemCodeGen(),
		});
	});

	it('creates recurring gift → Stripe checkout in subscription mode', async () => {
		const gift = await svc.createGift({
			recipientParentEmail: 'parent@example.com',
			recipientName: 'Eli',
			cadence: 'monthly',
			format: 'hardcover',
			bundleLength: null,
			startDate: T0,
			cardFromGiver: 'Love you, Eli! — Grandma',
			giverName: 'Grandma Lou',
			giverEmail: 'grandma@example.com',
		});
		expect(gift.id).toMatch(/^gift_/);
		expect(gift.status).toBe('pending_redeem');
		expect(gift.redeemCode).toMatch(/^RDM/);
		const checkout = payment.calls.find((c) => c.method === 'createGiftCheckoutSession');
		expect(checkout).toBeDefined();
		const args = checkout!.args as { mode: string };
		expect(args.mode).toBe('subscription');
	});

	it('sends receipt + invite emails', async () => {
		await svc.createGift({
			recipientParentEmail: 'parent@example.com',
			recipientName: 'Eli',
			cadence: 'monthly',
			format: 'hardcover',
			bundleLength: null,
			startDate: T0,
			cardFromGiver: 'Hi Eli',
			giverName: 'Grandma',
			giverEmail: 'grandma@example.com',
		});
		const giverEmail = mailer.calls.find((c) => c.kind === 'gift_purchase_giver_receipt');
		const recipientEmail = mailer.calls.find((c) => c.kind === 'gift_purchase_recipient_invite');
		expect(giverEmail).toBeDefined();
		expect(giverEmail!.to).toBe('grandma@example.com');
		expect(recipientEmail).toBeDefined();
		expect(recipientEmail!.to).toBe('parent@example.com');
	});

	it('rejects card-from-giver > 500 chars', async () => {
		const tooLong = 'x'.repeat(501);
		await expect(
			svc.createGift({
				recipientParentEmail: 'parent@example.com',
				recipientName: 'Eli',
				cadence: 'monthly',
				format: 'hardcover',
				bundleLength: null,
				startDate: T0,
				cardFromGiver: tooLong,
				giverName: 'G',
				giverEmail: 'g@example.com',
			})
		).rejects.toThrow(/exceeds 500/);
	});
});

describe('GiftFlowService.createGift — bundle', () => {
	let payment: ReturnType<typeof createMockPayment>;
	let mailer: ReturnType<typeof createMockMailer>;
	let svc: GiftFlowService;
	let subs: SubscriptionService;
	let bundles: BundleService;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		payment = createMockPayment();
		mailer = createMockMailer();
		const clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		bundles = new BundleService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('bundle'),
		});
		svc = new GiftFlowService({
			payment,
			mailer,
			subscriptions: subs,
			bundles,
			nowSource: clock.now,
			idGen: makeIdGen('gift'),
			redeemCodeGen: makeRedeemCodeGen(),
		});
	});

	it('creates bundle gift → Stripe checkout in payment mode', async () => {
		const gift = await svc.createGift({
			recipientParentEmail: 'parent@example.com',
			recipientName: 'Eli',
			cadence: 'monthly',
			format: 'hardcover',
			bundleLength: 12,
			startDate: T0,
			cardFromGiver: 'For the year ahead',
			giverName: 'Grandma',
			giverEmail: 'grandma@example.com',
		});
		const checkout = payment.calls.find((c) => c.method === 'createGiftCheckoutSession');
		const args = checkout!.args as { mode: string; amountCents?: number };
		expect(args.mode).toBe('payment');
		expect(args.amountCents).toBe(27999);
		void gift;
	});
});

describe('GiftFlowService.redeem', () => {
	let payment: ReturnType<typeof createMockPayment>;
	let mailer: ReturnType<typeof createMockMailer>;
	let subs: SubscriptionService;
	let bundles: BundleService;
	let svc: GiftFlowService;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		payment = createMockPayment();
		mailer = createMockMailer();
		const clock = makeClock(T0);
		subs = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
		bundles = new BundleService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('bundle'),
		});
		svc = new GiftFlowService({
			payment,
			mailer,
			subscriptions: subs,
			bundles,
			nowSource: clock.now,
			idGen: makeIdGen('gift'),
			redeemCodeGen: makeRedeemCodeGen(),
		});
	});

	it('recurring gift redeem creates a Subscription', async () => {
		const gift = await svc.createGift({
			recipientParentEmail: 'parent@example.com',
			recipientName: 'Eli',
			cadence: 'monthly',
			format: 'hardcover',
			bundleLength: null,
			startDate: T0,
			cardFromGiver: 'Card',
			giverName: 'G',
			giverEmail: 'g@example.com',
		});
		const result = await svc.redeem({ redeemCode: gift.redeemCode, kidId: 'kid-1' });
		expect(result.subscriptionId).toBeDefined();
		expect(result.bundleId).toBeUndefined();
		expect(gift.status).toBe('redeemed');
		expect(gift.redeemedAt).toBeDefined();
		const sub = subs.get(result.subscriptionId!);
		expect(sub).toBeDefined();
		expect(sub!.kidId).toBe('kid-1');
		expect(sub!.giverEmail).toBe('g@example.com');
	});

	it('bundle gift redeem creates a Bundle', async () => {
		const gift = await svc.createGift({
			recipientParentEmail: 'parent@example.com',
			recipientName: 'Eli',
			cadence: 'monthly',
			format: 'hardcover',
			bundleLength: 6,
			startDate: T0,
			cardFromGiver: 'Card',
			giverName: 'G',
			giverEmail: 'g@example.com',
		});
		const result = await svc.redeem({ redeemCode: gift.redeemCode });
		expect(result.bundleId).toBeDefined();
		expect(result.subscriptionId).toBeUndefined();
		const bundle = bundles.get(result.bundleId!);
		expect(bundle).toBeDefined();
		expect(bundle!.bookCount).toBe(6);
		expect(bundle!.giverEmail).toBe('g@example.com');
	});

	it('throws on invalid redeem code', async () => {
		await expect(svc.redeem({ redeemCode: 'BOGUS' })).rejects.toThrow(/invalid redeem code/);
	});

	it('double-redeem throws', async () => {
		const gift = await svc.createGift({
			recipientParentEmail: 'parent@example.com',
			recipientName: 'Eli',
			cadence: 'monthly',
			format: 'hardcover',
			bundleLength: null,
			startDate: T0,
			cardFromGiver: 'Card',
			giverName: 'G',
			giverEmail: 'g@example.com',
		});
		await svc.redeem({ redeemCode: gift.redeemCode });
		await expect(svc.redeem({ redeemCode: gift.redeemCode })).rejects.toThrow(
			/status=redeemed/
		);
	});
});

describe('GiftFlowService.buildDedicationOverride', () => {
	it('returns card-from-giver + giverName for the workshop dedication pipeline', async () => {
		const payment = createMockPayment();
		const mailer = createMockMailer();
		const subs = new SubscriptionService({
			payment,
			nowSource: () => 1_700_000_000_000,
			idGen: makeIdGen('sub'),
		});
		const bundles = new BundleService({
			payment,
			nowSource: () => 1_700_000_000_000,
			idGen: makeIdGen('bundle'),
		});
		const svc = new GiftFlowService({
			payment,
			mailer,
			subscriptions: subs,
			bundles,
			nowSource: () => 1_700_000_000_000,
			idGen: makeIdGen('gift'),
			redeemCodeGen: makeRedeemCodeGen(),
		});
		const gift = await svc.createGift({
			recipientParentEmail: 'parent@example.com',
			recipientName: 'Eli',
			cadence: 'monthly',
			format: 'hardcover',
			bundleLength: null,
			startDate: 0,
			cardFromGiver: 'Love, Grandma',
			giverName: 'Grandma Lou',
			giverEmail: 'g@example.com',
		});
		const override = svc.buildDedicationOverride(gift.id);
		expect(override).toBeDefined();
		expect(override!.cardFromGiver).toBe('Love, Grandma');
		expect(override!.giverName).toBe('Grandma Lou');
		expect(override!.recipientName).toBe('Eli');
	});

	it('returns undefined for unknown giftId', () => {
		const payment = createMockPayment();
		const mailer = createMockMailer();
		const subs = new SubscriptionService({
			payment,
			nowSource: () => 0,
			idGen: makeIdGen('sub'),
		});
		const bundles = new BundleService({
			payment,
			nowSource: () => 0,
			idGen: makeIdGen('bundle'),
		});
		const svc = new GiftFlowService({
			payment,
			mailer,
			subscriptions: subs,
			bundles,
			nowSource: () => 0,
		});
		expect(svc.buildDedicationOverride('gift_nonexistent')).toBeUndefined();
	});
});
