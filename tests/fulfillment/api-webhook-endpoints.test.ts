// tests/fulfillment/api-webhook-endpoints.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
	InMemoryOrderStore,
	OrderLifecycleService,
	StripeCheckoutService,
	LuluFulfillmentService,
	type Order,
} from '$lib/services/fulfillment';
import {
	POST as orderPOST,
	__setOrderApiDeps,
} from '../../src/routes/api/order/+server';
import {
	POST as luluWebhookPOST,
	__setLuluWebhookApiDeps,
} from '../../src/routes/api/lulu-webhook/+server';
import {
	POST as stripeWebhookPOST,
	__setStripeWebhookApiDeps,
} from '../../src/routes/api/stripe-webhook/+server';
import { callPost } from './api-helpers';
import {
	createMockLulu,
	createMockStripe,
	hmacHex,
	makeAddress,
	makeConsent,
	makeShippingOption,
	makeClock,
	makeIdGen,
} from './fixtures';

const LULU_SECRET = 'lulu-test-secret';
const STRIPE_SECRET = 'whsec_test';

function wireAll() {
	const store = new InMemoryOrderStore();
	const stripeHttp = createMockStripe();
	const stripe = new StripeCheckoutService({
		http: stripeHttp,
		webhookSecret: STRIPE_SECRET,
		nowSource: () => clock.now(),
	});
	const clock = makeClock();
	const luluHttp = createMockLulu();
	const lulu = new LuluFulfillmentService({ http: luluHttp, webhookSecret: LULU_SECRET });
	const lifecycle = new OrderLifecycleService({ store, nowSource: clock.now });
	__setOrderApiDeps({
		lifecycle,
		stripe,
		store,
		idGen: makeIdGen('ord'),
		nowSource: clock.now,
	});
	__setLuluWebhookApiDeps({ lulu });
	__setStripeWebhookApiDeps({ stripe });
	return { store, stripeHttp, lifecycle, clock, lulu, luluHttp };
}

const validBody = () => ({
	kidId: 'kid_1',
	bookId: 'book_1',
	parentEmail: 'p@x.com',
	format: 'hardcover-8x8' as const,
	pages: 40,
	pdfHash: 'sha256-abcdefgh',
	shippingAddress: makeAddress(),
	shippingOption: makeShippingOption(),
	consentLog: makeConsent(),
});

async function createOrderViaApi() {
	const r = await callPost(orderPOST, { body: validBody() });
	return r.data.orderId as string;
}

describe('POST /api/lulu-webhook — signature verification', () => {
	let deps: ReturnType<typeof wireAll>;
	beforeEach(() => {
		deps = wireAll();
	});

	it('401 on missing signature', async () => {
		const r = await callPost(luluWebhookPOST, { rawBody: '{}', headers: {} });
		expect(r.status).toBe(401);
	});

	it('401 on tampered body', async () => {
		const body = JSON.stringify({
			topic: 'print_job.status',
			data: { printJobId: 'lj_1', status: 'SHIPPED' },
		});
		const sig = await hmacHex(LULU_SECRET, body);
		const tampered = body.replace('SHIPPED', 'DELIVERED');
		const r = await callPost(luluWebhookPOST, {
			rawBody: tampered,
			headers: { 'lulu-signature': `sha256=${sig}` },
		});
		expect(r.status).toBe(401);
	});

	it('200 ignored when lulu job unknown', async () => {
		const body = JSON.stringify({
			topic: 'x',
			data: { printJobId: 'lj_unknown', status: 'SHIPPED' },
		});
		const sig = await hmacHex(LULU_SECRET, body);
		const r = await callPost(luluWebhookPOST, {
			rawBody: body,
			headers: { 'lulu-signature': `sha256=${sig}` },
		});
		expect(r.status).toBe(200);
		expect(r.data.ignored).toBe('unknown_lulu_job');
	});

	it('transitions order to shipped when status SHIPPED + valid signature', async () => {
		const orderId = await createOrderViaApi();
		// Advance to submitted_to_lulu state and link Lulu job id
		await deps.lifecycle.transition(orderId, 'paid', 'system');
		await deps.lifecycle.transition(orderId, 'submitted_to_lulu', 'system', {
			patch: { luluJobId: 'lj_42' },
		});

		const body = JSON.stringify({
			topic: 'print_job.status',
			data: { printJobId: 'lj_42', status: 'SHIPPED', trackingUrl: 'http://track' },
		});
		const sig = await hmacHex(LULU_SECRET, body);
		const r = await callPost(luluWebhookPOST, {
			rawBody: body,
			headers: { 'lulu-signature': `sha256=${sig}` },
		});
		expect(r.status).toBe(200);
		expect(r.data.transitioned).toBe('shipped');

		const order = await deps.store.get(orderId);
		expect(order!.state).toBe('shipped');
		expect(order!.trackingUrl).toBe('http://track');
	});
});

describe('POST /api/stripe-webhook — signature + state mapping', () => {
	let deps: ReturnType<typeof wireAll>;
	beforeEach(() => {
		deps = wireAll();
	});

	async function signedStripe(body: string): Promise<string> {
		const ts = Math.floor(deps.clock.now() / 1000);
		const sig = await hmacHex(STRIPE_SECRET, `${ts}.${body}`);
		return `t=${ts},v1=${sig}`;
	}

	it('401 on missing signature', async () => {
		const r = await callPost(stripeWebhookPOST, { rawBody: '{}', headers: {} });
		expect(r.status).toBe(401);
	});

	it('maps payment_intent.succeeded -> paid', async () => {
		const orderId = await createOrderViaApi();
		const order = (await deps.store.get(orderId))!;
		const piId = order.stripePaymentIntentId!;

		const body = JSON.stringify({
			id: 'evt_1',
			type: 'payment_intent.succeeded',
			data: { object: { id: piId } },
		});
		const r = await callPost(stripeWebhookPOST, {
			rawBody: body,
			headers: { 'stripe-signature': await signedStripe(body) },
		});
		expect(r.status).toBe(200);
		expect(r.data.transitioned).toBe('paid');
		expect((await deps.store.get(orderId))!.state).toBe('paid');
	});

	it('audit-logs charge.refunded without changing state', async () => {
		const orderId = await createOrderViaApi();
		const order = (await deps.store.get(orderId))!;
		const piId = order.stripePaymentIntentId!;

		const body = JSON.stringify({
			id: 'evt_2',
			type: 'charge.refunded',
			data: { object: { id: piId } },
		});
		const r = await callPost(stripeWebhookPOST, {
			rawBody: body,
			headers: { 'stripe-signature': await signedStripe(body) },
		});
		expect(r.status).toBe(200);
		expect(r.data.audited).toBe('refund');
		const updated = (await deps.store.get(orderId))!;
		expect(updated.state).toBe('pending_payment'); // state unchanged
		const refundEntry = updated.transitions.find((t) => t.reason === 'stripe_charge_refunded');
		expect(refundEntry).toBeDefined();
	});

	it('maps payment_intent.payment_failed -> failed_validation', async () => {
		const orderId = await createOrderViaApi();
		const order = (await deps.store.get(orderId))!;
		const piId = order.stripePaymentIntentId!;
		const body = JSON.stringify({
			id: 'evt_3',
			type: 'payment_intent.payment_failed',
			data: { object: { id: piId } },
		});
		const r = await callPost(stripeWebhookPOST, {
			rawBody: body,
			headers: { 'stripe-signature': await signedStripe(body) },
		});
		expect(r.status).toBe(200);
		expect(r.data.transitioned).toBe('failed_validation');
	});
});
