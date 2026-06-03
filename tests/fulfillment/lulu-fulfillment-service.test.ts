// tests/fulfillment/lulu-fulfillment-service.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { LuluFulfillmentService } from '$lib/services/fulfillment';
import { createMockLulu, makeAddress, makeOrder, hmacHex } from './fixtures';

describe('LuluFulfillmentService.getShippingQuote', () => {
	let mock: ReturnType<typeof createMockLulu>;
	let svc: LuluFulfillmentService;

	beforeEach(() => {
		mock = createMockLulu();
		svc = new LuluFulfillmentService({ http: mock, webhookSecret: 's3cr3t' });
	});

	it('forwards address+format+pages into LuluShippingCostRequest', async () => {
		await svc.getShippingQuote(makeAddress(), 'hardcover-8x8', 40);
		const call = mock.calls.find((c) => c.method === 'getShippingCost');
		expect(call).toBeDefined();
		const args = call!.args as { lineItems: Array<{ pageCount: number; podPackageId: string }> };
		expect(args.lineItems[0].pageCount).toBe(40);
		expect(args.lineItems[0].podPackageId).toBe('0850X0850FCSTDCW080CW444GXX');
	});

	it('converts costExclTax string -> cents integer', async () => {
		mock.setShippingResponse({
			options: [
				{
					shippingLevel: 'GROUND',
					shipSpeed: 'ground',
					name: 'Ground',
					costExclTax: '12.34',
					currency: 'USD',
					etaMin: 4,
					etaMax: 8,
				},
			],
		});
		const opts = await svc.getShippingQuote(makeAddress(), 'softcover-8x8', 40);
		expect(opts[0].costCents).toBe(1234);
		expect(opts[0].etaDays).toBe(6); // (4+8)/2
		expect(opts[0].luluShippingLevel).toBe('GROUND');
	});

	it('passes currency through', async () => {
		await svc.getShippingQuote(makeAddress({ country: 'CA' }), 'hardcover-8x8', 40, 'CAD');
		const call = mock.calls.find((c) => c.method === 'getShippingCost')!;
		const args = call.args as { currency: string };
		expect(args.currency).toBe('CAD');
	});
});

describe('LuluFulfillmentService.createPrintJob', () => {
	let mock: ReturnType<typeof createMockLulu>;
	let svc: LuluFulfillmentService;

	beforeEach(() => {
		mock = createMockLulu();
		svc = new LuluFulfillmentService({ http: mock, webhookSecret: 's3cr3t' });
	});

	it('sends externalId=order.id, contactEmail=parentEmail, shippingLevel from option', async () => {
		const order = makeOrder({ id: 'ord_abc', parentEmail: 'p@x.com' });
		await svc.createPrintJob(order, 'https://pdf', 'https://cover');
		const req = mock.calls.find((c) => c.method === 'createPrintJob')!.args as {
			externalId: string;
			contactEmail: string;
			shippingLevel: string;
			lineItems: Array<{
				printableNormalization: { interior: { sourceUrl: string }; cover: { sourceUrl: string } };
			}>;
		};
		expect(req.externalId).toBe('ord_abc');
		expect(req.contactEmail).toBe('p@x.com');
		expect(req.shippingLevel).toBe('GROUND');
		expect(req.lineItems[0].printableNormalization.interior.sourceUrl).toBe('https://pdf');
		expect(req.lineItems[0].printableNormalization.cover.sourceUrl).toBe('https://cover');
	});

	it('returns the Lulu response untouched', async () => {
		mock.setCreateJobResponse({ id: 'lj_99', status: { name: 'CREATED', message: 'queued' } });
		const r = await svc.createPrintJob(makeOrder(), 'a', 'b');
		expect(r.id).toBe('lj_99');
		expect(r.status.name).toBe('CREATED');
	});
});

describe('LuluFulfillmentService.cancel + reissue', () => {
	it('cancel calls http.cancelPrintJob with id', async () => {
		const mock = createMockLulu();
		const svc = new LuluFulfillmentService({ http: mock, webhookSecret: 's' });
		await svc.cancelPrintJob('lj_42');
		const call = mock.calls.find((c) => c.method === 'cancelPrintJob')!;
		expect(call.args).toBe('lj_42');
	});

	it('reissue calls http.reissuePrintJob with id+reason', async () => {
		const mock = createMockLulu();
		mock.setReissueJobResponse({ id: 'lj_new', status: { name: 'CREATED' } });
		const svc = new LuluFulfillmentService({ http: mock, webhookSecret: 's' });
		const r = await svc.reissuePrintJob('lj_old', 'lost in transit');
		expect(r.id).toBe('lj_new');
		const call = mock.calls.find((c) => c.method === 'reissuePrintJob')!;
		expect(call.args).toMatchObject({ id: 'lj_old', reason: 'lost in transit' });
	});
});

describe('LuluFulfillmentService.verifyWebhookSignature', () => {
	const secret = 'webhook-test-secret';
	let svc: LuluFulfillmentService;

	beforeEach(() => {
		svc = new LuluFulfillmentService({ http: createMockLulu(), webhookSecret: secret });
	});

	it('returns true for a correctly-signed body', async () => {
		const body = JSON.stringify({ topic: 'print_job.status', data: { printJobId: 'lj_1', status: 'SHIPPED' } });
		const sig = await hmacHex(secret, body);
		expect(await svc.verifyWebhookSignature(body, `sha256=${sig}`)).toBe(true);
	});

	it('returns false when the body is tampered', async () => {
		const body = JSON.stringify({ topic: 'x', data: { printJobId: 'lj_1', status: 'SHIPPED' } });
		const sig = await hmacHex(secret, body);
		const tampered = body.replace('SHIPPED', 'DELIVERED');
		expect(await svc.verifyWebhookSignature(tampered, `sha256=${sig}`)).toBe(false);
	});

	it('returns false when the header is missing or malformed', async () => {
		expect(await svc.verifyWebhookSignature('{}', null)).toBe(false);
		expect(await svc.verifyWebhookSignature('{}', 'bogus')).toBe(false);
		expect(await svc.verifyWebhookSignature('{}', 'sha256=zzz')).toBe(false);
	});

	it('returns false when secret differs', async () => {
		const body = '{}';
		const sig = await hmacHex('different', body);
		expect(await svc.verifyWebhookSignature(body, `sha256=${sig}`)).toBe(false);
	});
});

describe('LuluFulfillmentService.parseWebhookEvent', () => {
	it('parses valid payload', () => {
		const svc = new LuluFulfillmentService({ http: createMockLulu(), webhookSecret: 's' });
		const body = JSON.stringify({
			topic: 'print_job.status',
			data: { printJobId: 'lj_1', status: 'SHIPPED', trackingUrl: 'http://t' },
		});
		const ev = svc.parseWebhookEvent(body);
		expect(ev.topic).toBe('print_job.status');
		expect(ev.data.printJobId).toBe('lj_1');
		expect(ev.data.trackingUrl).toBe('http://t');
	});

	it('throws on malformed payload', () => {
		const svc = new LuluFulfillmentService({ http: createMockLulu(), webhookSecret: 's' });
		expect(() => svc.parseWebhookEvent('not json')).toThrow();
		expect(() => svc.parseWebhookEvent('{"topic":"x"}')).toThrow();
		expect(() => svc.parseWebhookEvent('{"topic":"x","data":{}}')).toThrow();
	});
});
