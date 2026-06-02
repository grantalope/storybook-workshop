// tests/storybook-workshop/subscription/bundle-service.test.ts
//
// Covers:
// - All 4 bundle sizes priced per spec §6.4
// - One-time Stripe charge created
// - N scheduled slots materialized on cadence interval
// - consumeOneSlot increments + flips to exhausted at N
// - 12-book bundle pricing achieves ~22% discount vs 12× monthly
// - cancel flow

import { describe, it, expect, beforeEach } from 'vitest';
import {
	BUNDLE_PRICES,
	BundleService,
	bundleCentsFor,
	materializeSlots,
	MS_PER_DAY,
} from '$lib/services/subscription';
import { createMockPayment, makeClock, makeIdGen } from './fixtures';

describe('BUNDLE_PRICES', () => {
	it('has exactly 4 entries (3/6/12/24)', () => {
		expect(BUNDLE_PRICES.map((b) => b.bookCount).sort((a, b) => a - b)).toEqual([3, 6, 12, 24]);
	});

	it('3-book is $79.99 per spec §6.4', () => {
		expect(bundleCentsFor(3)).toBe(7999);
	});

	it('6-book is $149.99 per spec §6.4', () => {
		expect(bundleCentsFor(6)).toBe(14999);
	});

	it('12-book is $279.99 per spec §6.4 (~22% discount on per-book price)', () => {
		expect(bundleCentsFor(12)).toBe(27999);
		const flagshipMonthly = 2999; // $29.99/mo flagship
		const undiscounted = flagshipMonthly * 12;
		const discount = (undiscounted - 27999) / undiscounted;
		// ~22% discount target — accept 20-25% range
		expect(discount).toBeGreaterThan(0.2);
		expect(discount).toBeLessThan(0.25);
	});

	it('24-book is linear 2× 12-book (preserves per-book economics)', () => {
		expect(bundleCentsFor(24)).toBe(2 * 27999);
	});
});

describe('materializeSlots', () => {
	it('produces N timestamps each one cadence interval apart', () => {
		const slots = materializeSlots(1_000_000, 3, 'monthly');
		expect(slots).toHaveLength(3);
		expect(slots[1] - slots[0]).toBe(30 * MS_PER_DAY);
		expect(slots[2] - slots[1]).toBe(30 * MS_PER_DAY);
	});

	it('weekly cadence — 4 weekly slots', () => {
		const slots = materializeSlots(0, 4, 'weekly');
		expect(slots).toEqual([0, 7 * MS_PER_DAY, 14 * MS_PER_DAY, 21 * MS_PER_DAY]);
	});
});

describe('BundleService.create', () => {
	let payment: ReturnType<typeof createMockPayment>;
	let svc: BundleService;

	beforeEach(() => {
		payment = createMockPayment();
		const clock = makeClock(1_700_000_000_000);
		svc = new BundleService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('bundle'),
		});
	});

	it('creates a 3-book bundle with one-time Stripe charge', async () => {
		const bundle = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'softcover',
			bookCount: 3,
		});
		expect(bundle.id).toMatch(/^bundle_/);
		expect(bundle.prepaidCents).toBe(7999);
		expect(bundle.scheduledSlots).toHaveLength(3);
		expect(bundle.status).toBe('active');
		expect(payment.calls.find((c) => c.method === 'createOneTimeCharge')).toBeDefined();
	});

	it('creates a 12-book bundle with 12 scheduled slots', async () => {
		const bundle = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			bookCount: 12,
		});
		expect(bundle.bookCount).toBe(12);
		expect(bundle.scheduledSlots).toHaveLength(12);
	});

	it('rejects invalid email', async () => {
		await expect(
			svc.create({
				recipientParentEmail: 'bogus',
				cadence: 'monthly',
				format: 'hardcover',
				bookCount: 3,
			})
		).rejects.toThrow(/invalid email/);
	});
});

describe('BundleService.consumeOneSlot', () => {
	let svc: BundleService;

	beforeEach(() => {
		svc = new BundleService({
			payment: createMockPayment(),
			nowSource: () => 1_700_000_000_000,
			idGen: makeIdGen('bundle'),
		});
	});

	it('increments consumed; flips to exhausted at bookCount', async () => {
		const bundle = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			bookCount: 3,
		});
		svc.consumeOneSlot(bundle.id);
		expect(bundle.consumed).toBe(1);
		expect(bundle.status).toBe('active');
		svc.consumeOneSlot(bundle.id);
		svc.consumeOneSlot(bundle.id);
		expect(bundle.consumed).toBe(3);
		expect(bundle.status).toBe('exhausted');
	});

	it('throws when consuming an exhausted bundle', async () => {
		const bundle = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			bookCount: 3,
		});
		svc.consumeOneSlot(bundle.id);
		svc.consumeOneSlot(bundle.id);
		svc.consumeOneSlot(bundle.id);
		expect(() => svc.consumeOneSlot(bundle.id)).toThrow(/status=exhausted/);
	});
});

describe('BundleService.cancel + snapshot', () => {
	it('cancel flips status; snapshot reports cents collected only for non-cancelled', async () => {
		const svc = new BundleService({
			payment: createMockPayment(),
			nowSource: () => 1_700_000_000_000,
			idGen: makeIdGen('bundle'),
		});
		const b1 = await svc.create({
			recipientParentEmail: 'a@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			bookCount: 3,
		});
		const b2 = await svc.create({
			recipientParentEmail: 'a@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			bookCount: 6,
		});
		svc.cancel(b1.id);
		const snap = svc.snapshot();
		expect(snap.statuses.cancelled).toBe(1);
		expect(snap.statuses.active).toBe(1);
		expect(snap.totalCentsCollected).toBe(b2.prepaidCents);
	});
});
