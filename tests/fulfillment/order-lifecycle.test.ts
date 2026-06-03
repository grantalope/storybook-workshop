// tests/fulfillment/order-lifecycle.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	OrderLifecycleService,
	OrderLifecycleError,
	InMemoryOrderStore,
	DEFAULT_CANCEL_WINDOW_MS,
} from '$lib/services/fulfillment';
import { makeAddress, makeShippingOption, makeConsent, makeClock } from './fixtures';

function defaultCreate(svc: OrderLifecycleService, id = 'ord_1') {
	return svc.create({
		id,
		kidId: 'kid_1',
		bookId: 'book_1',
		parentEmail: 'p@x.com',
		format: 'hardcover-8x8',
		pages: 40,
		pdfHash: 'sha256-1',
		shippingAddress: makeAddress(),
		shippingOption: makeShippingOption(),
		bookCostCents: 2999,
		consentLog: makeConsent(),
	});
}

describe('OrderLifecycleService.create', () => {
	it('creates order in pending_payment with one transition entry', async () => {
		const store = new InMemoryOrderStore();
		const svc = new OrderLifecycleService({ store });
		const order = await defaultCreate(svc);
		expect(order.state).toBe('pending_payment');
		expect(order.transitions).toHaveLength(1);
		expect(order.transitions[0]).toMatchObject({
			from: null,
			to: 'pending_payment',
			actor: 'system',
			reason: 'order_created',
		});
	});
});

describe('OrderLifecycleService.transition — allowed paths per spec §5.3', () => {
	let store: InMemoryOrderStore;
	let svc: OrderLifecycleService;

	beforeEach(() => {
		store = new InMemoryOrderStore();
		svc = new OrderLifecycleService({ store });
	});

	it('pending_payment -> paid allowed', async () => {
		await defaultCreate(svc);
		const next = await svc.transition('ord_1', 'paid', 'system');
		expect(next.state).toBe('paid');
		expect(next.transitions).toHaveLength(2);
	});

	it('paid -> submitted_to_lulu -> in_production -> shipped -> delivered happy path', async () => {
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		await svc.transition('ord_1', 'in_production', 'lulu');
		await svc.transition('ord_1', 'shipped', 'lulu');
		const o = await svc.transition('ord_1', 'delivered', 'lulu');
		expect(o.state).toBe('delivered');
		expect(o.transitions.map((t) => t.to)).toEqual([
			'pending_payment',
			'paid',
			'submitted_to_lulu',
			'in_production',
			'shipped',
			'delivered',
		]);
	});

	it('submitted_to_lulu -> shipped directly is allowed (Lulu may skip in_production)', async () => {
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		const o = await svc.transition('ord_1', 'shipped', 'lulu');
		expect(o.state).toBe('shipped');
	});
});

describe('OrderLifecycleService.transition — blocked paths', () => {
	let store: InMemoryOrderStore;
	let svc: OrderLifecycleService;

	beforeEach(() => {
		store = new InMemoryOrderStore();
		svc = new OrderLifecycleService({ store });
	});

	it('throws OrderLifecycleError on illegal transition (paid -> shipped)', async () => {
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await expect(svc.transition('ord_1', 'shipped', 'lulu')).rejects.toThrow(
			OrderLifecycleError,
		);
	});

	it('delivered is terminal — cannot transition out', async () => {
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		await svc.transition('ord_1', 'shipped', 'lulu');
		await svc.transition('ord_1', 'delivered', 'lulu');
		await expect(svc.transition('ord_1', 'shipped', 'lulu')).rejects.toThrow(
			/transition not allowed/,
		);
	});

	it('returns OrderLifecycleError when order id unknown', async () => {
		await expect(svc.transition('nope', 'paid', 'system')).rejects.toThrow(/not found/);
	});
});

describe('OrderLifecycleService — side-effect handlers', () => {
	it('fires onPaid + onSubmitted + onShipped after persistence', async () => {
		const store = new InMemoryOrderStore();
		const onPaid = vi.fn();
		const onSubmitted = vi.fn();
		const onShipped = vi.fn();
		const svc = new OrderLifecycleService({
			store,
			handlers: { onPaid, onSubmitted, onShipped },
		});
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		await svc.transition('ord_1', 'shipped', 'lulu');
		expect(onPaid).toHaveBeenCalledTimes(1);
		expect(onSubmitted).toHaveBeenCalledTimes(1);
		expect(onShipped).toHaveBeenCalledTimes(1);
	});

	it('handler runs after store.put — order seen by handler is post-transition', async () => {
		const store = new InMemoryOrderStore();
		let seen = '';
		const svc = new OrderLifecycleService({
			store,
			handlers: {
				onPaid: (o) => {
					seen = o.state;
				},
			},
		});
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		expect(seen).toBe('paid');
		// Persisted state agrees
		const persisted = await store.get('ord_1');
		expect(persisted!.state).toBe('paid');
	});
});

describe('OrderLifecycleService.cancelByParent — cancel window', () => {
	it('cancel from pending_payment is always allowed', async () => {
		const clock = makeClock();
		const store = new InMemoryOrderStore();
		const svc = new OrderLifecycleService({ store, nowSource: clock.now });
		await defaultCreate(svc);
		clock.advanceMs(7 * 24 * 3600_000);
		const o = await svc.cancelByParent('ord_1');
		expect(o.state).toBe('cancelled_pre_production');
	});

	it('cancel within window after submitted_to_lulu', async () => {
		const clock = makeClock();
		const store = new InMemoryOrderStore();
		const svc = new OrderLifecycleService({ store, nowSource: clock.now });
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		clock.advanceMs(60 * 60_000); // 60 min < default 75
		const o = await svc.cancelByParent('ord_1');
		expect(o.state).toBe('cancelled_pre_production');
	});

	it('outside the 75 min window throws past_cancel_window', async () => {
		const clock = makeClock();
		const store = new InMemoryOrderStore();
		const svc = new OrderLifecycleService({ store, nowSource: clock.now });
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		clock.advanceMs(80 * 60_000);
		await expect(svc.cancelByParent('ord_1')).rejects.toThrow(/past_cancel_window/);
	});

	it('cancel from in_production throws past_cancel_window', async () => {
		const store = new InMemoryOrderStore();
		const svc = new OrderLifecycleService({ store });
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		await svc.transition('ord_1', 'in_production', 'lulu');
		await expect(svc.cancelByParent('ord_1')).rejects.toThrow(/past_cancel_window/);
	});

	it('configurable cancelWindowMs override', async () => {
		const clock = makeClock();
		const store = new InMemoryOrderStore();
		const svc = new OrderLifecycleService({ store, nowSource: clock.now, cancelWindowMs: 60_000 });
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		clock.advanceMs(2 * 60_000);
		await expect(svc.cancelByParent('ord_1')).rejects.toThrow(/past_cancel_window/);
	});

	it('isPastCancelWindow helper agrees with cancelByParent', async () => {
		const clock = makeClock();
		const store = new InMemoryOrderStore();
		const svc = new OrderLifecycleService({ store, nowSource: clock.now });
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		const orderInWindow = await store.get('ord_1');
		expect(svc.isPastCancelWindow(orderInWindow!)).toBe(false);
		clock.advanceMs(DEFAULT_CANCEL_WINDOW_MS + 1000);
		const orderPast = await store.get('ord_1');
		expect(svc.isPastCancelWindow(orderPast!)).toBe(true);
	});
});

describe('OrderLifecycleService.transition — patch persists', () => {
	it('patch attribute (trackingUrl) applied during transition', async () => {
		const store = new InMemoryOrderStore();
		const svc = new OrderLifecycleService({ store });
		await defaultCreate(svc);
		await svc.transition('ord_1', 'paid', 'system');
		await svc.transition('ord_1', 'submitted_to_lulu', 'system');
		const o = await svc.transition('ord_1', 'shipped', 'lulu', {
			patch: { trackingUrl: 'http://track' },
		});
		expect(o.trackingUrl).toBe('http://track');
	});
});
