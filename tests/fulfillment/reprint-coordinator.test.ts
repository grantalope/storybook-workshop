// tests/fulfillment/reprint-coordinator.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	InMemoryOrderStore,
	LuluFulfillmentService,
	OrderLifecycleService,
	ReprintCoordinator,
} from '$lib/services/fulfillment';
import { createMockLulu, makeOrder } from './fixtures';

describe('ReprintCoordinator.reprint', () => {
	let store: InMemoryOrderStore;
	let mock: ReturnType<typeof createMockLulu>;
	let lulu: LuluFulfillmentService;
	let lifecycle: OrderLifecycleService;
	let onSubmitted: ReturnType<typeof vi.fn<(o: import('$lib/services/fulfillment').Order) => void>>;
	let coord: ReprintCoordinator;

	beforeEach(() => {
		store = new InMemoryOrderStore();
		mock = createMockLulu();
		lulu = new LuluFulfillmentService({ http: mock, webhookSecret: 's' });
		onSubmitted = vi.fn<(o: import('$lib/services/fulfillment').Order) => void>();
		lifecycle = new OrderLifecycleService({ store, handlers: { onSubmitted } });
		coord = new ReprintCoordinator({ lulu, lifecycle, store, idGen: () => 'newgen' });
	});

	it('creates a reissue order linked to the original; original back-links to reissue', async () => {
		await store.put(makeOrder({ id: 'ord_original', luluJobId: 'lj_old', state: 'delivered' }));
		mock.setReissueJobResponse({ id: 'lj_reissue_99', status: { name: 'CREATED' } });
		const r = await coord.reprint('ord_original', 'lost in transit');
		expect(r.reissueOrderId).toBe('ord_newgen');
		expect(r.luluJobId).toBe('lj_reissue_99');

		const updatedOriginal = await store.get('ord_original');
		expect(updatedOriginal!.reissueOrderId).toBe('ord_newgen');

		const reissue = await store.get('ord_newgen');
		expect(reissue!.reissueOfOrderId).toBe('ord_original');
		expect(reissue!.state).toBe('submitted_to_lulu');
		expect(reissue!.luluJobId).toBe('lj_reissue_99');
		expect(reissue!.transitions.map((t) => t.to)).toEqual([
			'pending_payment',
			'paid',
			'submitted_to_lulu',
		]);
	});

	it('throws when original missing luluJobId (never submitted)', async () => {
		await store.put(makeOrder({ id: 'ord_no_lulu', luluJobId: undefined }));
		await expect(coord.reprint('ord_no_lulu', 'r')).rejects.toThrow(/no luluJobId/);
	});

	it('throws when already reissued', async () => {
		await store.put(
			makeOrder({
				id: 'ord_x',
				luluJobId: 'lj',
				reissueOrderId: 'ord_old_reissue',
			}),
		);
		await expect(coord.reprint('ord_x', 'r')).rejects.toThrow(/already reissued/);
	});

	it('fires onSubmitted handler for the reissue order', async () => {
		await store.put(makeOrder({ id: 'ord_a', luluJobId: 'lj_old' }));
		await coord.reprint('ord_a', 'defect');
		expect(onSubmitted).toHaveBeenCalledTimes(1);
		const arg = onSubmitted.mock.calls[0][0];
		expect(arg.state).toBe('submitted_to_lulu');
		expect(arg.reissueOfOrderId).toBe('ord_a');
	});
});
