// tests/fulfillment/money-integrity.test.ts
//
// Regression tests for Cluster-A money-integrity findings:
//   P1: charge.refunded uses charge.id instead of charge.payment_intent -> refunds never audited
//   P0: order creation must fail closed and charge server-quoted shipping

import { describe, it, expect, beforeEach } from 'vitest';
import {
	POST as orderPOST,
	__setOrderApiDeps,
} from '../../src/routes/api/order/+server';
import {
	POST as stripeWebhookPOST,
} from '../../src/routes/api/stripe-webhook/+server';
import { callPost } from './api-helpers';
import {
	hmacHex,
	makeAddress,
	makeConsent,
	makeShippingOption,
} from './fixtures';
import { wireFulfillmentDeps } from './wireFulfillmentDeps';

const STRIPE_SECRET = 'whsec_test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wireAll() {
	return wireFulfillmentDeps({ stripeWebhookSecret: STRIPE_SECRET });
}

async function signedStripe(secret: string, body: string, nowMs: number): Promise<string> {
	const ts = Math.floor(nowMs / 1000);
	const sig = await hmacHex(secret, `${ts}.${body}`);
	return `t=${ts},v1=${sig}`;
}

const validBody = () => ({
	kidId: 'kid_1',
	bookId: 'book_1',
	parentEmail: 'p@x.com',
	format: 'hardcover-8x8' as const,
	pages: 40,
	pdfHash: 'sha256-abcdefgh',
	shippingAddress: makeAddress(),
	shippingOption: makeShippingOption({
		name: 'Standard',
		shipSpeed: 'mail',
		costCents: 499,
		etaDays: 14,
		luluShippingLevel: 'MAIL',
	}),
	consentLog: makeConsent(),
});

async function createOrder() {
	const r = await callPost(orderPOST, { body: validBody() });
	expect(r.status).toBe(200);
	return r.data.orderId as string;
}

// ---------------------------------------------------------------------------
// P1: charge.refunded must look up by payment_intent, not charge.id
// ---------------------------------------------------------------------------

describe('P1 — charge.refunded webhook uses payment_intent not charge id', () => {
	let deps: ReturnType<typeof wireAll>;
	beforeEach(() => { deps = wireAll(); });

	it('ADVERSARIAL: charge.refunded with mismatched charge id (ch_...) correctly audits via payment_intent', async () => {
		// Simulate the real Stripe payload: object.id = ch_xxx (Charge ID), object.payment_intent = pi_xxx
		// The bug: code used event.data.object.id (ch_...) as the lookup key
		// so getByStripePaymentIntent(ch_...) always returned null -> refund never recorded.
		const orderId = await createOrder();
		const order = (await deps.store.get(orderId))!;
		const piId = order.stripePaymentIntentId!;

		const chargeId = 'ch_DIFFERENT_FROM_PI_ID';
		expect(chargeId).not.toBe(piId); // guard: they must differ in a real Stripe event

		const body = JSON.stringify({
			id: 'evt_refund_adversarial',
			type: 'charge.refunded',
			data: {
				object: {
					id: chargeId,            // Charge ID — WRONG lookup key (the bug)
					payment_intent: piId,    // PaymentIntent ID — CORRECT lookup key (the fix)
					amount_refunded: 3499,
				},
			},
		});
		const header = await signedStripe(STRIPE_SECRET, body, deps.clock.now());
		const r = await callPost(stripeWebhookPOST, {
			rawBody: body,
			headers: { 'stripe-signature': header },
		});
		expect(r.status).toBe(200);
		expect(r.data.audited).toBe('refund');

		// The audit entry MUST appear — proves the fix uses payment_intent not id
		const updated = (await deps.store.get(orderId))!;
		const refundEntry = updated.transitions.find((t) => t.reason === 'stripe_charge_refunded');
		expect(refundEntry).toBeDefined();
		// Meta must carry the PaymentIntent id, not the charge id
		expect((refundEntry!.meta as Record<string, unknown>)?.paymentIntentId).toBe(piId);
	});

	it('ADVERSARIAL: charge.refunded with unknown payment_intent is graceful no-op', async () => {
		const body = JSON.stringify({
			id: 'evt_refund_unknown',
			type: 'charge.refunded',
			data: {
				object: {
					id: 'ch_unknown',
					payment_intent: 'pi_unknown_does_not_exist',
				},
			},
		});
		const header = await signedStripe(STRIPE_SECRET, body, deps.clock.now());
		const r = await callPost(stripeWebhookPOST, {
			rawBody: body,
			headers: { 'stripe-signature': header },
		});
		expect(r.status).toBe(200);
		expect(r.data.audited).toBe('refund'); // graceful no-op when order unknown
	});

	it('HAPPY: charge.refunded with matching payment_intent correctly writes audit log', async () => {
		const orderId = await createOrder();
		const order = (await deps.store.get(orderId))!;
		const piId = order.stripePaymentIntentId!;

		const body = JSON.stringify({
			id: 'evt_refund_happy',
			type: 'charge.refunded',
			data: {
				object: {
					id: 'ch_real_charge_id',
					payment_intent: piId,
					amount_refunded: 3499,
				},
			},
		});
		const header = await signedStripe(STRIPE_SECRET, body, deps.clock.now());
		const r = await callPost(stripeWebhookPOST, {
			rawBody: body,
			headers: { 'stripe-signature': header },
		});
		expect(r.status).toBe(200);
		expect(r.data.audited).toBe('refund');

		const updated = (await deps.store.get(orderId))!;
		const entry = updated.transitions.find((t) => t.reason === 'stripe_charge_refunded');
		expect(entry).toBeDefined();
		expect(entry!.meta?.paymentIntentId).toBe(piId);
	});
});

// ---------------------------------------------------------------------------
// P0: shipping option costCents must be server-validated, not client-trusted
// ---------------------------------------------------------------------------

describe('P0 — shipping costCents fail-closed and server-quoted', () => {
	it('ADVERSARIAL: missing shippingQuote service returns 503 before Stripe', async () => {
		const deps = wireAll();
		__setOrderApiDeps({
			lifecycle: deps.lifecycle,
			stripe: deps.stripe,
			store: deps.store,
			qualityClaimStore: deps.claimStore,
			idGen: deps.idGen,
			nowSource: deps.clock.now,
		} as unknown as Parameters<typeof __setOrderApiDeps>[0]);

		const r = await callPost(orderPOST, { body: validBody() });
		expect(r.status).toBe(503);
		expect(r.data.error).toBe('shipping_unavailable');
		expect(stripeCreateCalls(deps)).toHaveLength(0);
	});

	it('ADVERSARIAL: quote service throw returns 503 before Stripe', async () => {
		const deps = wireAll();
		deps.luluHttp.failNext('getShippingCost', new Error('lulu down'));

		const r = await callPost(orderPOST, { body: validBody() });
		expect(r.status).toBe(503);
		expect(r.data.error).toBe('shipping_unavailable');
		expect(stripeCreateCalls(deps)).toHaveLength(0);
	});

	it('ADVERSARIAL: zero costCents is rejected before Stripe', async () => {
		const deps = wireAll();
		const tampered = validBody();
		tampered.shippingOption = makeShippingOption({
			...tampered.shippingOption,
			costCents: 0,
		});

		const r = await callPost(orderPOST, { body: tampered });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('invalid_shipping_cost');
		expect(stripeCreateCalls(deps)).toHaveLength(0);
	});

	it('ADVERSARIAL: unknown shipping level is rejected even when cost matches', async () => {
		const deps = wireAll();
		const tampered = validBody();
		tampered.shippingOption = makeShippingOption({
			...tampered.shippingOption,
			name: 'Unavailable',
			luluShippingLevel: 'OVERNIGHT_MOON',
		});

		const r = await callPost(orderPOST, { body: tampered });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('shipping_option_unavailable');
		expect(stripeCreateCalls(deps)).toHaveLength(0);
	});

	it('ADVERSARIAL: matching level with wrong currency is rejected', async () => {
		const deps = wireAll();
		const tampered = validBody();
		tampered.shippingOption = makeShippingOption({
			...tampered.shippingOption,
			currency: 'CAD',
		});

		const r = await callPost(orderPOST, { body: tampered });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('shipping_option_unavailable');
		expect(stripeCreateCalls(deps)).toHaveLength(0);
	});

	it('ADVERSARIAL: matching level with tampered cost is rejected with server quote', async () => {
		const deps = wireAll();
		const tampered = validBody();
		tampered.shippingOption = makeShippingOption({
			...tampered.shippingOption,
			costCents: 999999,
		});

		const r = await callPost(orderPOST, { body: tampered });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('shipping_mismatch');
		expect(r.data.serverQuote).toMatchObject({
			luluShippingLevel: 'MAIL',
			currency: 'USD',
			costCents: 499,
		});
		expect(stripeCreateCalls(deps)).toHaveLength(0);
	});

	it('HAPPY: persists matched server option and charges server shipping amount', async () => {
		const deps = wireAll();
		const body = validBody();
		body.shippingOption = makeShippingOption({
			name: 'Client supplied label must not persist',
			shipSpeed: 'ground',
			costCents: 499,
			currency: 'USD',
			etaDays: 1,
			luluShippingLevel: 'MAIL',
		});

		const r = await callPost(orderPOST, { body });
		expect(r.status).toBe(200);
		expect(r.data.amountCents).toBe(3499 + 499);

		const stored = (await deps.store.get(r.data.orderId as string))!;
		expect(stored.shippingOption).toMatchObject({
			name: 'Standard mail',
			shipSpeed: 'mail',
			costCents: 499,
			currency: 'USD',
			etaDays: 14,
			luluShippingLevel: 'MAIL',
		});
		expect(stripeCreateCalls(deps)[0]?.args).toMatchObject({
			amountCents: 3499 + 499,
			currency: 'USD',
		});
	});
});

function stripeCreateCalls(deps: ReturnType<typeof wireAll>) {
	return (
		deps.stripeHttp as unknown as {
			calls: Array<{ method: string; args: unknown }>;
		}
	).calls.filter((call) => call.method === 'createPaymentIntent');
}
