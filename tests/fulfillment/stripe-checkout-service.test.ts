// tests/fulfillment/stripe-checkout-service.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { StripeCheckoutService } from '$lib/services/fulfillment';
import { createMockStripe, makeAddress, hmacHex, makeClock } from './fixtures';

describe('StripeCheckoutService.createPaymentIntent', () => {
	let mock: ReturnType<typeof createMockStripe>;
	let svc: StripeCheckoutService;

	beforeEach(() => {
		mock = createMockStripe();
		svc = new StripeCheckoutService({ http: mock, webhookSecret: 's' });
	});

	it('forwards opts + uses idempotency key `order:{orderId}:create-payment`', async () => {
		await svc.createPaymentIntent({
			orderId: 'ord_42',
			amountCents: 3899,
			currency: 'USD',
			parentEmail: 'p@x.com',
			shippingAddress: makeAddress(),
		});
		expect(mock.idempotencyKeys[0]).toBe('order:ord_42:create-payment');
		expect(mock.calls[0].args).toMatchObject({
			orderId: 'ord_42',
			amountCents: 3899,
			parentEmail: 'p@x.com',
		});
	});

	it('repeated calls with same orderId return same PaymentIntent (idempotency)', async () => {
		const a = await svc.createPaymentIntent({
			orderId: 'ord_x',
			amountCents: 1000,
			currency: 'USD',
			parentEmail: 'p@x.com',
			shippingAddress: makeAddress(),
		});
		const b = await svc.createPaymentIntent({
			orderId: 'ord_x',
			amountCents: 1000,
			currency: 'USD',
			parentEmail: 'p@x.com',
			shippingAddress: makeAddress(),
		});
		expect(a.id).toBe(b.id);
		expect(mock.idempotencyKeys[0]).toBe(mock.idempotencyKeys[1]);
	});

	it('throws on missing orderId', async () => {
		await expect(
			svc.createPaymentIntent({
				orderId: '',
				amountCents: 1000,
				currency: 'USD',
				parentEmail: 'p@x.com',
				shippingAddress: makeAddress(),
			}),
		).rejects.toThrow(/orderId required/);
	});

	it('throws when amount below 50 cents (Stripe min)', async () => {
		await expect(
			svc.createPaymentIntent({
				orderId: 'ord_1',
				amountCents: 49,
				currency: 'USD',
				parentEmail: 'p@x.com',
				shippingAddress: makeAddress(),
			}),
		).rejects.toThrow(/amount below minimum/);
	});

	it('throws on missing parentEmail', async () => {
		await expect(
			svc.createPaymentIntent({
				orderId: 'ord_1',
				amountCents: 1000,
				currency: 'USD',
				parentEmail: '',
				shippingAddress: makeAddress(),
			}),
		).rejects.toThrow(/parentEmail required/);
	});
});

describe('StripeCheckoutService.refund', () => {
	let mock: ReturnType<typeof createMockStripe>;
	let svc: StripeCheckoutService;

	beforeEach(() => {
		mock = createMockStripe();
		svc = new StripeCheckoutService({ http: mock, webhookSecret: 's' });
	});

	it('full refund (no amount)', async () => {
		const r = await svc.refund('pi_1');
		expect(r.status).toBe('succeeded');
		expect(r.paymentIntentId).toBe('pi_1');
	});

	it('partial refund forwards amount', async () => {
		await svc.refund('pi_1', 500);
		const call = mock.calls.find((c) => c.method === 'refund')!;
		expect((call.args as { amountCents: number }).amountCents).toBe(500);
	});

	it('forwards refund idempotency key', async () => {
		await svc.refund('pi_1', 500, 'order:ord_1:claim:claim_1:refund:500');
		const call = mock.calls.find((c) => c.method === 'refund')!;
		expect(call.idempotencyKey).toBe('order:ord_1:claim:claim_1:refund:500');
	});

	it('throws on missing piId / non-positive amount', async () => {
		await expect(svc.refund('')).rejects.toThrow(/paymentIntentId required/);
		await expect(svc.refund('pi_1', 0)).rejects.toThrow(/refund amount must be positive/);
		await expect(svc.refund('pi_1', -1)).rejects.toThrow(/refund amount must be positive/);
		await expect(svc.refund('pi_1', 100, ' ')).rejects.toThrow(/idempotency key/);
	});
});

describe('StripeCheckoutService.verifyWebhookSignature', () => {
	const secret = 'whsec_test';

	it('returns true for correctly-signed payload', async () => {
		const clock = makeClock();
		const svc = new StripeCheckoutService({
			http: createMockStripe(),
			webhookSecret: secret,
			nowSource: clock.now,
		});
		const ts = Math.floor(clock.now() / 1000);
		const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
		const sig = await hmacHex(secret, `${ts}.${body}`);
		const header = `t=${ts},v1=${sig}`;
		expect(await svc.verifyWebhookSignature(body, header)).toBe(true);
	});

	it('returns false when signature tampered', async () => {
		const clock = makeClock();
		const svc = new StripeCheckoutService({
			http: createMockStripe(),
			webhookSecret: secret,
			nowSource: clock.now,
		});
		const ts = Math.floor(clock.now() / 1000);
		const body = '{"id":"evt_1","type":"x","data":{"object":{"id":"pi_1"}}}';
		const sig = await hmacHex(secret, `${ts}.${body}`);
		const header = `t=${ts},v1=${sig}`;
		const tamperedBody = body.replace('pi_1', 'pi_evil');
		expect(await svc.verifyWebhookSignature(tamperedBody, header)).toBe(false);
	});

	it('returns false when ts is outside tolerance window', async () => {
		const clock = makeClock();
		const svc = new StripeCheckoutService({
			http: createMockStripe(),
			webhookSecret: secret,
			nowSource: clock.now,
		});
		const tsOld = Math.floor(clock.now() / 1000) - 10_000;
		const body = '{"id":"evt_1","type":"x","data":{"object":{"id":"pi_1"}}}';
		const sig = await hmacHex(secret, `${tsOld}.${body}`);
		expect(await svc.verifyWebhookSignature(body, `t=${tsOld},v1=${sig}`)).toBe(false);
	});

	it('returns false when header missing', async () => {
		const svc = new StripeCheckoutService({
			http: createMockStripe(),
			webhookSecret: secret,
		});
		expect(await svc.verifyWebhookSignature('{}', null)).toBe(false);
		expect(await svc.verifyWebhookSignature('{}', 'garbage')).toBe(false);
	});
});
