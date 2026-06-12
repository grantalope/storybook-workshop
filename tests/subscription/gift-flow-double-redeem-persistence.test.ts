// tests/subscription/gift-flow-double-redeem-persistence.test.ts
//
// Regression tests for cluster D finding #1:
//   GiftFlowService.redeem() backed by in-memory Map — a fresh service
//   instance has no gift state and allows double-redeem of the same code.
//
// These tests FAIL before the fix (in-memory-only store per instance)
// and PASS after (injected GiftStore that survives across instances).

import { describe, it, expect, beforeEach } from 'vitest';
import {
	BundleService,
	GiftFlowService,
	SubscriptionService,
} from '$lib/services/subscription';
import { InMemoryGiftStore, type GiftStore } from '$lib/services/subscription/GiftFlowService';
import type { Gift } from '$lib/services/subscription/types';
import {
	createMockMailer,
	createMockPayment,
	makeClock,
	makeIdGen,
	makeRedeemCodeGen,
} from './fixtures';

// ---------------------------------------------------------------------------
// Helper: build a GiftFlowService backed by the SHARED store
// ---------------------------------------------------------------------------
function makeService(
	store: GiftStore,
	overrides: { clockStart?: number } = {}
) {
	const T0 = overrides.clockStart ?? 1_700_000_000_000;
	const clock = makeClock(T0);
	const payment = createMockPayment();
	const mailer = createMockMailer();
	const subs = new SubscriptionService({
		payment,
		nowSource: clock.now,
		idGen: makeIdGen('sub'),
	});
	const bundles = new BundleService({
		payment,
		nowSource: clock.now,
		idGen: makeIdGen('bundle'),
	});
	return new GiftFlowService({
		payment,
		mailer,
		subscriptions: subs,
		bundles,
		nowSource: clock.now,
		idGen: makeIdGen('gift'),
		redeemCodeGen: makeRedeemCodeGen(),
		store, // <-- injected external store
	});
}

// ---------------------------------------------------------------------------
// Gift creation helper
// ---------------------------------------------------------------------------
async function createTestGift(svc: GiftFlowService): Promise<Gift> {
	return svc.createGift({
		recipientParentEmail: 'parent@example.com',
		recipientName: 'Eli',
		cadence: 'monthly',
		format: 'hardcover',
		bundleLength: null,
		startDate: 1_700_000_000_000,
		cardFromGiver: 'Love, Grandma',
		giverName: 'Grandma Lou',
		giverEmail: 'grandma@example.com',
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GiftFlowService — persistence across service re-instantiation (regression cluster D#1)', () => {
	let store: InMemoryGiftStore;

	beforeEach(() => {
		store = new InMemoryGiftStore();
	});

	it('redeem code is visible to a SECOND service instance that shares the store', async () => {
		// First instance creates the gift
		const svc1 = makeService(store);
		const gift = await createTestGift(svc1);
		expect(gift.status).toBe('pending_redeem');

		// Second instance — simulates a new request handler in the same process
		const svc2 = makeService(store);
		const result = await svc2.redeem({ redeemCode: gift.redeemCode, kidId: 'kid-1' });
		expect(result.giftId).toBe(gift.id);
		expect(result.subscriptionId).toBeDefined();
	});

	it('double-redeem from two separate service instances sharing the store throws', async () => {
		const svc1 = makeService(store);
		const gift = await createTestGift(svc1);

		const svc2 = makeService(store);
		await svc2.redeem({ redeemCode: gift.redeemCode });

		// Third instance simulates a third request
		const svc3 = makeService(store);
		await expect(svc3.redeem({ redeemCode: gift.redeemCode })).rejects.toThrow(
			/status=redeemed/
		);
	});

	it('status written by one instance is visible to another instance (CAS-like check)', async () => {
		const svc1 = makeService(store);
		const gift = await createTestGift(svc1);

		const svc2 = makeService(store);
		await svc2.redeem({ redeemCode: gift.redeemCode });

		// Status should be 'redeemed' in the shared store
		const stored = store.getById(gift.id);
		expect(stored).toBeDefined();
		expect(stored!.status).toBe('redeemed');
	});

	it('getByRedeemCode on a fresh service that shares the store finds the gift', async () => {
		const svc1 = makeService(store);
		const gift = await createTestGift(svc1);

		const svc2 = makeService(store);
		const found = svc2.getByRedeemCode(gift.redeemCode);
		expect(found).toBeDefined();
		expect(found!.id).toBe(gift.id);
	});
});
