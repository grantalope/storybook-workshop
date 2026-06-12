// tests/fulfillment/api-shipping-quote.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { POST as shippingPOST } from '../../src/routes/api/shipping-quote/+server';
import { callPost } from './api-helpers';
import { makeAddress } from './fixtures';
import { wireFulfillmentDeps } from './wireFulfillmentDeps';

function wire() {
	return wireFulfillmentDeps();
}

describe('POST /api/shipping-quote', () => {
	beforeEach(() => wire());

	it('returns options for valid request', async () => {
		const r = await callPost(shippingPOST, {
			body: {
				shippingAddress: makeAddress(),
				format: 'hardcover-8x8',
				pages: 40,
			},
		});
		expect(r.status).toBe(200);
		expect(Array.isArray(r.data.options)).toBe(true);
		expect(r.data.options.length).toBeGreaterThan(0);
		expect(r.data.options[0]).toMatchObject({
			shipSpeed: expect.any(String),
			costCents: expect.any(Number),
			currency: 'USD',
		});
	});

	it('400 invalid_address on unsupported country', async () => {
		const r = await callPost(shippingPOST, {
			body: {
				shippingAddress: makeAddress({ country: 'CN' }),
				format: 'hardcover-8x8',
				pages: 40,
			},
		});
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('invalid_address');
	});

	it('400 on missing fields', async () => {
		const r = await callPost(shippingPOST, { body: { format: 'hardcover-8x8' } });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('missing_fields');
	});

	it('400 invalid_json on garbage body', async () => {
		const r = await callPost(shippingPOST, { rawBody: 'not json' });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('invalid_json');
	});
});
