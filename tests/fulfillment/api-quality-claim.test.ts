// tests/fulfillment/api-quality-claim.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	POST as claimPOST,
	GET as claimGET,
} from '../../src/routes/api/quality-claim/+server';
import { callPost, callGet } from './api-helpers';
import { makeOrder } from './fixtures';
import { wireFulfillmentDeps } from './wireFulfillmentDeps';

function wire() {
	return wireFulfillmentDeps({ stripeWebhookSecret: 's' });
}

describe('POST /api/quality-claim', () => {
	beforeEach(() => wire());

	it('200 with decision on submit; wrong_content matches consent -> rejected', async () => {
		const { store } = wire();
		await store.put(
			makeOrder({
				id: 'ord_1',
				pdfHash: 'sha256-MATCH',
				consentLog: {
					reviewedSpreads: true,
					understandsNonRefundable: true,
					pdfHash: 'sha256-MATCH',
					timestampMs: 1_700_000_000_000,
				},
			}),
		);
		const r = await callPost(claimPOST, {
			body: {
				orderId: 'ord_1',
				category: 'wrong_content',
				photoUrls: [],
				parentText: 'wrong',
			},
		});
		expect(r.status).toBe(200);
		expect(r.data.decision).toBe('rejected');
		expect(r.data.reason).toBe('content_matches_parent_consent');
	});

	it('400 on invalid_category', async () => {
		const r = await callPost(claimPOST, {
			body: { orderId: 'ord_1', category: 'bonk' },
		});
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('invalid_category');
	});

	it('400 on missing orderId', async () => {
		const r = await callPost(claimPOST, { body: { category: 'defect' } });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('missing_orderId');
	});

	it('default claim ids use CSPRNG instead of Math.random', async () => {
		vi.resetModules();
		const random = vi.spyOn(Math, 'random').mockImplementation(() => {
			throw new Error('Math.random should not generate quality-claim ids');
		});
		try {
			const { __getQualityApiDeps } = await import('../../src/routes/api/quality-claim/+server');
			const id = __getQualityApiDeps().idGen();
			expect(id).toMatch(/^claim_[a-z0-9]{10}$/);
			expect(random).not.toHaveBeenCalled();
		} finally {
			random.mockRestore();
		}
	});
});

describe('GET /api/quality-claim', () => {
	it('returns the pending list', async () => {
		const { store } = wire();
		await store.put(makeOrder({ id: 'ord_pending' }));
		await callPost(claimPOST, {
			body: {
				orderId: 'ord_pending',
				category: 'defect',
				photoUrls: ['http://p.jpg'],
				parentText: 'crinkled',
			},
		});
		const r = await callGet(claimGET);
		expect(r.status).toBe(200);
		expect(Array.isArray(r.data.pending)).toBe(true);
		expect(r.data.pending.length).toBeGreaterThanOrEqual(1);
	});
});
