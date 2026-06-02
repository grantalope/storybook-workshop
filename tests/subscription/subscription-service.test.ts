// tests/storybook-workshop/subscription/subscription-service.test.ts
//
// Covers:
// - pricing catalog shape (12 cells per spec §6.4)
// - create flow: recurring → Stripe sub created; prepaid → no Stripe sub
// - skip-a-month: nextBookAt advances + consecutiveSkips increments + cap enforced
// - cancel: stripe sub cancelled for recurring path
// - markBookDelivered: resets consecutiveSkips + advances nextBookAt
// - pause/resume
// - error paths (bad email, unknown id, double cancel)

import { describe, it, expect, beforeEach } from 'vitest';
import {
	PRICING_CATALOG,
	MAX_CONSECUTIVE_SKIPS,
	MS_PER_DAY,
	SubscriptionService,
	nextCadenceAt,
	priceCentsFor,
	stripePriceIdFor,
} from '$lib/services/subscription';
import { createMockPayment, makeClock, makeIdGen } from './fixtures';

describe('PRICING_CATALOG', () => {
	it('has 12 cells (4 cadences × 3 formats) per spec §6.4', () => {
		expect(PRICING_CATALOG).toHaveLength(12);
	});

	it('monthly hardcover is $29.99 (2999 cents) — flagship tier', () => {
		expect(priceCentsFor('monthly', 'hardcover')).toBe(2999);
	});

	it('weekly hardcover is $99.99 — top tier', () => {
		expect(priceCentsFor('weekly', 'hardcover')).toBe(9999);
	});

	it('quarterly bedtime is $7.99 — floor tier', () => {
		expect(priceCentsFor('quarterly', 'bedtime')).toBe(799);
	});

	it('stripePriceIdFor returns a deterministic id', () => {
		const id = stripePriceIdFor('monthly', 'hardcover', 'recurring');
		expect(id).toBe('price_monthly_hardcover_recurring');
	});

	it('nextCadenceAt advances by correct days', () => {
		const t0 = 1_700_000_000_000;
		expect(nextCadenceAt(t0, 'weekly') - t0).toBe(7 * MS_PER_DAY);
		expect(nextCadenceAt(t0, 'biweekly') - t0).toBe(14 * MS_PER_DAY);
		expect(nextCadenceAt(t0, 'monthly') - t0).toBe(30 * MS_PER_DAY);
		expect(nextCadenceAt(t0, 'quarterly') - t0).toBe(90 * MS_PER_DAY);
	});
});

describe('SubscriptionService.create', () => {
	let payment: ReturnType<typeof createMockPayment>;
	let svc: SubscriptionService;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		payment = createMockPayment();
		const clock = makeClock(T0);
		svc = new SubscriptionService({
			payment,
			nowSource: clock.now,
			idGen: makeIdGen('sub'),
		});
	});

	it('creates a recurring subscription with Stripe sub id', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			kidId: 'kid-1',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		expect(sub.id).toMatch(/^sub_/);
		expect(sub.stripeSubscriptionId).toBeDefined();
		expect(sub.status).toBe('active');
		expect(sub.autopilotEnabled).toBe(true);
		expect(sub.consecutiveSkips).toBe(0);
		expect(sub.booksDelivered).toBe(0);
		expect(payment.calls.find((c) => c.method === 'createSubscription')).toBeDefined();
	});

	it('creates a prepaid subscription without Stripe sub call', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'softcover',
			billingMode: 'prepaid_bundle',
		});
		expect(sub.stripeSubscriptionId).toBeUndefined();
		expect(payment.calls.find((c) => c.method === 'createSubscription')).toBeUndefined();
	});

	it('rejects invalid email', async () => {
		await expect(
			svc.create({
				recipientParentEmail: 'not-an-email',
				cadence: 'monthly',
				format: 'hardcover',
				billingMode: 'recurring',
			})
		).rejects.toThrow(/invalid email/);
	});

	it('listByRecipient returns all subs for the parent', async () => {
		await svc.create({
			recipientParentEmail: 'a@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		await svc.create({
			recipientParentEmail: 'a@example.com',
			cadence: 'weekly',
			format: 'bedtime',
			billingMode: 'recurring',
		});
		await svc.create({
			recipientParentEmail: 'b@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		expect(svc.listByRecipient('a@example.com')).toHaveLength(2);
		expect(svc.listByRecipient('b@example.com')).toHaveLength(1);
	});
});

describe('SubscriptionService.skip', () => {
	let payment: ReturnType<typeof createMockPayment>;
	let svc: SubscriptionService;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		payment = createMockPayment();
		svc = new SubscriptionService({
			payment,
			nowSource: () => T0,
			idGen: makeIdGen('sub'),
		});
	});

	it('advances nextBookAt by one cadence interval + increments consecutiveSkips', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const initialNext = sub.nextBookAt;
		svc.skip(sub.id);
		expect(sub.nextBookAt - initialNext).toBe(30 * MS_PER_DAY);
		expect(sub.consecutiveSkips).toBe(1);
	});

	it('caps consecutive skips at MAX_CONSECUTIVE_SKIPS', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		for (let i = 0; i < MAX_CONSECUTIVE_SKIPS; i++) {
			svc.skip(sub.id);
		}
		expect(sub.consecutiveSkips).toBe(MAX_CONSECUTIVE_SKIPS);
		expect(() => svc.skip(sub.id)).toThrow(/MAX_CONSECUTIVE_SKIPS/);
	});

	it('throws for unknown subscription id', () => {
		expect(() => svc.skip('sub_nonexistent')).toThrow(/unknown subscription/);
	});

	it('throws when subscription is cancelled', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		await svc.cancel(sub.id);
		expect(() => svc.skip(sub.id)).toThrow(/status=cancelled/);
	});
});

describe('SubscriptionService.cancel', () => {
	let payment: ReturnType<typeof createMockPayment>;
	let svc: SubscriptionService;

	beforeEach(() => {
		payment = createMockPayment();
		svc = new SubscriptionService({
			payment,
			nowSource: () => 1_700_000_000_000,
			idGen: makeIdGen('sub'),
		});
	});

	it('cancels recurring sub + calls Stripe cancel', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		await svc.cancel(sub.id);
		expect(sub.status).toBe('cancelled');
		const cancelCall = payment.calls.find((c) => c.method === 'cancelSubscription');
		expect(cancelCall).toBeDefined();
		expect((cancelCall!.args as { id: string }).id).toBe(sub.stripeSubscriptionId);
	});

	it('cancels prepaid sub WITHOUT calling Stripe cancel', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'prepaid_bundle',
		});
		await svc.cancel(sub.id);
		const cancelCall = payment.calls.find((c) => c.method === 'cancelSubscription');
		expect(cancelCall).toBeUndefined();
	});

	it('throws on double-cancel', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		await svc.cancel(sub.id);
		await expect(svc.cancel(sub.id)).rejects.toThrow(/status=cancelled/);
	});
});

describe('SubscriptionService.markBookDelivered', () => {
	let svc: SubscriptionService;
	const T0 = 1_700_000_000_000;

	beforeEach(() => {
		svc = new SubscriptionService({
			payment: createMockPayment(),
			nowSource: () => T0,
			idGen: makeIdGen('sub'),
		});
	});

	it('increments booksDelivered and resets consecutiveSkips', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		svc.skip(sub.id);
		expect(sub.consecutiveSkips).toBe(1);
		svc.markBookDelivered(sub.id);
		expect(sub.consecutiveSkips).toBe(0);
		expect(sub.booksDelivered).toBe(1);
	});
});

describe('SubscriptionService.pause/resume', () => {
	let svc: SubscriptionService;

	beforeEach(() => {
		svc = new SubscriptionService({
			payment: createMockPayment(),
			nowSource: () => 1_700_000_000_000,
			idGen: makeIdGen('sub'),
		});
	});

	it('pause moves to paused; resume restores active', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		svc.pause(sub.id);
		expect(sub.status).toBe('paused');
		svc.resume(sub.id);
		expect(sub.status).toBe('active');
	});

	it('resume throws when not paused', async () => {
		const sub = await svc.create({
			recipientParentEmail: 'parent@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		expect(() => svc.resume(sub.id)).toThrow(/is not paused/);
	});
});

describe('SubscriptionService.snapshot', () => {
	it('reports status counts', async () => {
		const svc = new SubscriptionService({
			payment: createMockPayment(),
			nowSource: () => 1_700_000_000_000,
			idGen: makeIdGen('sub'),
		});
		const a = await svc.create({
			recipientParentEmail: 'a@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		const b = await svc.create({
			recipientParentEmail: 'b@example.com',
			cadence: 'monthly',
			format: 'hardcover',
			billingMode: 'recurring',
		});
		await svc.cancel(b.id);
		const snap = svc.snapshot();
		expect(snap.count).toBe(2);
		expect(snap.statuses.active).toBe(1);
		expect(snap.statuses.cancelled).toBe(1);
		// silence unused
		void a;
	});
});
