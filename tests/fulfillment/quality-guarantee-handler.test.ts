// tests/fulfillment/quality-guarantee-handler.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
	InMemoryOrderStore,
	InMemoryQualityClaimStore,
	QualityGuaranteeHandler,
	CLAIM_WINDOW_MS,
	type Order,
} from '$lib/services/fulfillment';
import { makeOrder, makeClock } from './fixtures';

async function persistOrderWithStateHistory(
	store: InMemoryOrderStore,
	order: Partial<Order> & { id: string },
	clock: ReturnType<typeof makeClock>,
	flow: Array<{ to: Order['state']; atOffsetMs: number }>,
): Promise<Order> {
	const full: Order = {
		...makeOrder(),
		...order,
		transitions: [],
	};
	for (const step of flow) {
		full.transitions.push({
			from: full.state,
			to: step.to,
			at: clock.now() + step.atOffsetMs,
			actor: 'lulu',
		});
		full.state = step.to;
	}
	await store.put(full);
	return full;
}

describe('QualityGuaranteeHandler — wrong_content consent-log defense', () => {
	it('rejects when claim pdf hash matches parent consent hash', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
		});
		await persistOrderWithStateHistory(
			store,
			{
				id: 'ord_1',
				pdfHash: 'sha256-MATCH',
				consentLog: {
					reviewedSpreads: true,
					understandsNonRefundable: true,
					pdfHash: 'sha256-MATCH',
					timestampMs: clock.now(),
				},
			},
			clock,
			[
				{ to: 'paid', atOffsetMs: 0 },
				{ to: 'submitted_to_lulu', atOffsetMs: 0 },
				{ to: 'shipped', atOffsetMs: 1000 },
				{ to: 'delivered', atOffsetMs: 2000 },
			],
		);
		const claim = await handler.submit({
			id: 'claim_1',
			orderId: 'ord_1',
			category: 'wrong_content',
			photoUrls: [],
			parentText: 'wrong story',
		});
		expect(claim.decision).toBe('rejected');
		expect(claim.decisionReason).toBe('content_matches_parent_consent');
	});

	it('approves reprint when hashes differ (consent drift)', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
		});
		await persistOrderWithStateHistory(
			store,
			{
				id: 'ord_1',
				pdfHash: 'sha256-CHANGED',
				consentLog: {
					reviewedSpreads: true,
					understandsNonRefundable: true,
					pdfHash: 'sha256-ORIGINAL',
					timestampMs: clock.now(),
				},
			},
			clock,
			[
				{ to: 'paid', atOffsetMs: 0 },
				{ to: 'submitted_to_lulu', atOffsetMs: 0 },
				{ to: 'shipped', atOffsetMs: 1000 },
				{ to: 'delivered', atOffsetMs: 2000 },
			],
		);
		const claim = await handler.submit({
			id: 'claim_2',
			orderId: 'ord_1',
			category: 'wrong_content',
			photoUrls: [],
			parentText: 'no match',
		});
		expect(claim.decision).toBe('approved_reprint');
		expect(claim.decisionReason).toBe('wrong_content_no_consent_match');
	});
});

describe('QualityGuaranteeHandler — lost_transit', () => {
	it('pending when shipped recently (under threshold)', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
			lostTransitDaysThreshold: 14,
		});
		await persistOrderWithStateHistory(store, { id: 'ord_1' }, clock, [
			{ to: 'paid', atOffsetMs: 0 },
			{ to: 'submitted_to_lulu', atOffsetMs: 0 },
			{ to: 'shipped', atOffsetMs: 0 },
		]);
		clock.advanceMs(2 * 24 * 3600_000);
		const claim = await handler.submit({
			id: 'c_1',
			orderId: 'ord_1',
			category: 'lost_transit',
			photoUrls: [],
			parentText: 'has not arrived',
		});
		expect(claim.decision).toBe('pending');
		expect(claim.decisionReason).toBe('too_early_to_declare_lost');
	});

	it('approves reprint when shipped > threshold w/o delivered', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
			lostTransitDaysThreshold: 14,
		});
		await persistOrderWithStateHistory(store, { id: 'ord_1' }, clock, [
			{ to: 'paid', atOffsetMs: 0 },
			{ to: 'submitted_to_lulu', atOffsetMs: 0 },
			{ to: 'shipped', atOffsetMs: 0 },
		]);
		clock.advanceMs(20 * 24 * 3600_000);
		const claim = await handler.submit({
			id: 'c_1',
			orderId: 'ord_1',
			category: 'lost_transit',
			photoUrls: [],
			parentText: '',
		});
		expect(claim.decision).toBe('approved_reprint');
	});

	it('rejects lost_transit when already delivered', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
		});
		await persistOrderWithStateHistory(store, { id: 'ord_1' }, clock, [
			{ to: 'paid', atOffsetMs: 0 },
			{ to: 'submitted_to_lulu', atOffsetMs: 0 },
			{ to: 'shipped', atOffsetMs: 0 },
			{ to: 'delivered', atOffsetMs: 1000 },
		]);
		const claim = await handler.submit({
			id: 'c_2',
			orderId: 'ord_1',
			category: 'lost_transit',
			photoUrls: [],
			parentText: '',
		});
		expect(claim.decision).toBe('rejected');
		expect(claim.decisionReason).toBe('order_already_delivered');
	});
});

describe('QualityGuaranteeHandler — defect + color_off + photo evidence', () => {
	it('defect with photos -> pending (ops review)', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
		});
		await store.put(makeOrder({ id: 'ord_1' }));
		const claim = await handler.submit({
			id: 'c_3',
			orderId: 'ord_1',
			category: 'defect',
			photoUrls: ['http://photo.jpg'],
			parentText: 'binding torn',
		});
		expect(claim.decision).toBe('pending');
	});

	it('defect missing photos -> rejected (missing evidence)', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
		});
		await store.put(makeOrder({ id: 'ord_1' }));
		const claim = await handler.submit({
			id: 'c_4',
			orderId: 'ord_1',
			category: 'defect',
			photoUrls: [],
			parentText: '',
		});
		expect(claim.decision).toBe('rejected');
		expect(claim.decisionReason).toBe('missing_photo_evidence');
	});

	it('color_off with photos -> pending; missing photos -> rejected', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
		});
		await store.put(makeOrder({ id: 'ord_2' }));
		const ok = await handler.submit({
			id: 'c_5',
			orderId: 'ord_2',
			category: 'color_off',
			photoUrls: ['http://p.jpg'],
			parentText: '',
		});
		expect(ok.decision).toBe('pending');
		const bad = await handler.submit({
			id: 'c_6',
			orderId: 'ord_2',
			category: 'color_off',
			photoUrls: [],
			parentText: '',
		});
		expect(bad.decision).toBe('rejected');
	});
});

describe('QualityGuaranteeHandler — window + order existence', () => {
	it('rejects when 30-day window elapsed', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const clock = makeClock();
		const handler = new QualityGuaranteeHandler({
			orderStore: store,
			claimStore: claims,
			nowSource: clock.now,
		});
		await persistOrderWithStateHistory(store, { id: 'ord_1' }, clock, [
			{ to: 'paid', atOffsetMs: 0 },
			{ to: 'submitted_to_lulu', atOffsetMs: 0 },
			{ to: 'shipped', atOffsetMs: 0 },
			{ to: 'delivered', atOffsetMs: 0 },
		]);
		clock.advanceMs(CLAIM_WINDOW_MS + 24 * 3600_000);
		const claim = await handler.submit({
			id: 'c_x',
			orderId: 'ord_1',
			category: 'defect',
			photoUrls: ['p'],
			parentText: 'late',
		});
		expect(claim.decision).toBe('rejected');
		expect(claim.decisionReason).toBe('past_30_day_window');
	});

	it('rejects when order not found', async () => {
		const store = new InMemoryOrderStore();
		const claims = new InMemoryQualityClaimStore();
		const handler = new QualityGuaranteeHandler({ orderStore: store, claimStore: claims });
		const claim = await handler.submit({
			id: 'c_y',
			orderId: 'nope',
			category: 'defect',
			photoUrls: ['p'],
			parentText: '',
		});
		expect(claim.decision).toBe('rejected');
		expect(claim.decisionReason).toBe('order_not_found');
	});
});
