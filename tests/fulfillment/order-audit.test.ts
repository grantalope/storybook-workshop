// tests/fulfillment/order-audit.test.ts

import { describe, it, expect } from 'vitest';
import {
	InMemoryOrderStore,
	OrderAuditService,
	OrderLifecycleService,
} from '$lib/services/fulfillment';
import { makeAddress, makeConsent, makeShippingOption } from './fixtures';

async function createAndAdvance() {
	const store = new InMemoryOrderStore();
	const svc = new OrderLifecycleService({ store });
	await svc.create({
		id: 'ord_1',
		kidId: 'kid_x',
		bookId: 'book_x',
		parentEmail: 'p@x.com',
		format: 'hardcover-8x8',
		pages: 40,
		pdfHash: 'sha256-1',
		shippingAddress: makeAddress(),
		shippingOption: makeShippingOption(),
		bookCostCents: 2999,
		consentLog: makeConsent(),
	});
	await svc.transition('ord_1', 'paid', 'system');
	await svc.transition('ord_1', 'submitted_to_lulu', 'system');
	await svc.transition('ord_1', 'shipped', 'lulu', { patch: { trackingUrl: 'http://t' } });
	return store;
}

describe('OrderAuditService.getStatus', () => {
	it('projects order to parent-visible shape', async () => {
		const store = await createAndAdvance();
		const audit = new OrderAuditService({ store });
		const status = await audit.getStatus('ord_1');
		expect(status).toBeDefined();
		expect(status!.state).toBe('shipped');
		expect(status!.trackingUrl).toBe('http://t');
		expect(status!.transitions.length).toBeGreaterThanOrEqual(4);
		// Privacy: status doesn't leak pdfHash / consent / address / payment intent
		const keys = Object.keys(status!);
		expect(keys).not.toContain('pdfHash');
		expect(keys).not.toContain('shippingAddress');
		expect(keys).not.toContain('stripePaymentIntentId');
	});

	it('returns undefined for missing order', async () => {
		const audit = new OrderAuditService({ store: new InMemoryOrderStore() });
		expect(await audit.getStatus('nope')).toBeUndefined();
	});
});

describe('OrderAuditService.getTransitions', () => {
	it('returns full transition list in order', async () => {
		const store = await createAndAdvance();
		const audit = new OrderAuditService({ store });
		const t = await audit.getTransitions('ord_1');
		expect(t.map((x) => x.to)).toEqual([
			'pending_payment',
			'paid',
			'submitted_to_lulu',
			'shipped',
		]);
	});

	it('empty list for unknown order', async () => {
		const audit = new OrderAuditService({ store: new InMemoryOrderStore() });
		expect(await audit.getTransitions('nope')).toEqual([]);
	});
});

describe('OrderAuditService.customerServicePrefill', () => {
	it('returns summary + last entries (capped 10)', async () => {
		const store = await createAndAdvance();
		const audit = new OrderAuditService({ store });
		const p = await audit.customerServicePrefill('ord_1');
		expect(p).toBeDefined();
		expect(p!.orderId).toBe('ord_1');
		expect(p!.summary).toMatch(/Order ord_1 \[shipped\]/);
		expect(p!.lastEntries.length).toBeLessThanOrEqual(10);
	});
});
