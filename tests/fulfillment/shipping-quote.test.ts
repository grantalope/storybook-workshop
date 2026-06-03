// tests/fulfillment/shipping-quote.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
	LuluFulfillmentService,
	ShippingQuoteService,
	ShippingAddressError,
	validateShippingAddress,
	SHIPPING_QUOTE_TTL_MS,
} from '$lib/services/fulfillment';
import { createMockLulu, makeAddress, makeClock } from './fixtures';

describe('validateShippingAddress', () => {
	it('accepts a valid US address', () => {
		expect(() => validateShippingAddress(makeAddress())).not.toThrow();
	});

	it('rejects empty name / line1 / city / region / postcode', () => {
		expect(() => validateShippingAddress(makeAddress({ name: '' }))).toThrow(ShippingAddressError);
		expect(() => validateShippingAddress(makeAddress({ line1: 'no' }))).toThrow(ShippingAddressError);
		expect(() => validateShippingAddress(makeAddress({ city: '' }))).toThrow(ShippingAddressError);
		expect(() => validateShippingAddress(makeAddress({ region: '' }))).toThrow(ShippingAddressError);
		expect(() => validateShippingAddress(makeAddress({ postcode: '' }))).toThrow(ShippingAddressError);
	});

	it('rejects non-ISO-2 country / unsupported country', () => {
		expect(() => validateShippingAddress(makeAddress({ country: 'USA' }))).toThrow(/ISO-3166-1/);
		expect(() => validateShippingAddress(makeAddress({ country: 'CN' }))).toThrow(/not supported in v1/);
	});
});

describe('ShippingQuoteService cache + TTL', () => {
	let mock: ReturnType<typeof createMockLulu>;
	let lulu: LuluFulfillmentService;
	let clock: ReturnType<typeof makeClock>;
	let svc: ShippingQuoteService;

	beforeEach(() => {
		mock = createMockLulu();
		lulu = new LuluFulfillmentService({ http: mock, webhookSecret: 's' });
		clock = makeClock();
		svc = new ShippingQuoteService({ lulu, nowSource: clock.now });
	});

	it('first call hits Lulu, second call (same key) hits cache', async () => {
		await svc.getQuote(makeAddress(), 'hardcover-8x8', 40);
		await svc.getQuote(makeAddress(), 'hardcover-8x8', 40);
		const hits = mock.calls.filter((c) => c.method === 'getShippingCost');
		expect(hits.length).toBe(1);
	});

	it('different format/pages busts cache', async () => {
		await svc.getQuote(makeAddress(), 'hardcover-8x8', 40);
		await svc.getQuote(makeAddress(), 'softcover-8x8', 40);
		await svc.getQuote(makeAddress(), 'hardcover-8x8', 60);
		expect(mock.calls.filter((c) => c.method === 'getShippingCost').length).toBe(3);
	});

	it('different country/region busts cache', async () => {
		await svc.getQuote(makeAddress({ region: 'OR' }), 'hardcover-8x8', 40);
		await svc.getQuote(makeAddress({ region: 'CA' }), 'hardcover-8x8', 40);
		expect(mock.calls.filter((c) => c.method === 'getShippingCost').length).toBe(2);
	});

	it('TTL expiry re-fetches', async () => {
		await svc.getQuote(makeAddress(), 'hardcover-8x8', 40);
		clock.advanceMs(SHIPPING_QUOTE_TTL_MS + 1);
		await svc.getQuote(makeAddress(), 'hardcover-8x8', 40);
		expect(mock.calls.filter((c) => c.method === 'getShippingCost').length).toBe(2);
	});

	it('invalid address rejected before any Lulu call', async () => {
		await expect(svc.getQuote(makeAddress({ country: 'XX' }), 'hardcover-8x8', 40)).rejects.toThrow(
			ShippingAddressError,
		);
		expect(mock.calls.filter((c) => c.method === 'getShippingCost').length).toBe(0);
	});
});
