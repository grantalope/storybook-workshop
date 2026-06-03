// tests/fulfillment/api-order-endpoint.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
	InMemoryOrderStore,
	OrderLifecycleService,
	StripeCheckoutService,
} from '$lib/services/fulfillment';
import { POST as orderPOST, __setOrderApiDeps } from '../../src/routes/api/order/+server';
import {
	GET as orderIdGET,
	POST as orderIdPOST,
} from '../../src/routes/api/order/[id]/+server';
import { callPost, callGet } from './api-helpers';
import {
	createMockStripe,
	makeAddress,
	makeShippingOption,
	makeConsent,
	makeClock,
	makeIdGen,
} from './fixtures';

function wireDeps() {
	const store = new InMemoryOrderStore();
	const stripeHttp = createMockStripe();
	const stripe = new StripeCheckoutService({ http: stripeHttp, webhookSecret: 's' });
	const clock = makeClock();
	const lifecycle = new OrderLifecycleService({ store, nowSource: clock.now });
	const idGen = makeIdGen('ord');
	__setOrderApiDeps({ lifecycle, stripe, store, idGen, nowSource: clock.now });
	return { store, stripe, stripeHttp, lifecycle, clock, idGen };
}

const validBody = () => ({
	kidId: 'kid_1',
	bookId: 'book_1',
	parentEmail: 'p@x.com',
	format: 'hardcover-8x8',
	pages: 40,
	pdfHash: 'sha256-abcdefgh',
	shippingAddress: makeAddress(),
	shippingOption: makeShippingOption(),
	consentLog: makeConsent(),
});

describe('POST /api/order — happy path', () => {
	beforeEach(() => {
		wireDeps();
	});

	it('creates order + returns orderId + clientSecret + paymentIntentId', async () => {
		const { status, data } = await callPost(orderPOST, { body: validBody() });
		expect(status).toBe(200);
		expect(data.orderId).toBeDefined();
		expect(data.clientSecret).toMatch(/_secret_/);
		expect(data.paymentIntentId).toMatch(/^pi_/);
		expect(data.amountCents).toBe(3499 + 899); // server-derived: 40pp hardcover = adventure tier ($34.99); per 2026-06-03 price-tampering fix
	});
});

describe('POST /api/order — validation errors (pre-Stripe)', () => {
	let deps: ReturnType<typeof wireDeps>;
	beforeEach(() => {
		deps = wireDeps();
	});

	it('400 invalid_json on bad body', async () => {
		const r = await callPost(orderPOST, { rawBody: '{not json' });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('invalid_json');
	});

	it('400 missing_field when required key absent', async () => {
		const body = validBody() as any;
		delete body.format;
		const r = await callPost(orderPOST, { body });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('missing_field');
	});

	it('400 pages_out_of_range when below format minPages', async () => {
		const body = validBody();
		body.pages = 10;
		const r = await callPost(orderPOST, { body });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('pages_out_of_range');
		expect(deps.stripeHttp.calls.length).toBe(0); // no Stripe call
	});

	it('400 pages_not_multiple_of', async () => {
		const body = validBody();
		body.pages = 41; // multiple is 2
		const r = await callPost(orderPOST, { body });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('pages_not_multiple_of');
	});

	it('400 consent_required when consent flags false', async () => {
		const body = validBody();
		body.consentLog = { ...body.consentLog, reviewedSpreads: false };
		const r = await callPost(orderPOST, { body });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('consent_required');
	});

	it('400 invalid_address when address invalid', async () => {
		const body = validBody();
		body.shippingAddress = makeAddress({ country: 'CN' });
		const r = await callPost(orderPOST, { body });
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('invalid_address');
	});
});

describe('GET /api/order/[id] — status projection', () => {
	beforeEach(() => {
		wireDeps();
	});

	it('returns 404 unknown id', async () => {
		const r = await callGet(orderIdGET, { params: { id: 'nope' } });
		expect(r.status).toBe(404);
	});

	it('returns status projection for known id', async () => {
		const post = await callPost(orderPOST, { body: validBody() });
		const r = await callGet(orderIdGET, { params: { id: post.data.orderId } });
		expect(r.status).toBe(200);
		expect(r.data.state).toBe('pending_payment');
		expect(r.data.id).toBe(post.data.orderId);
	});
});

describe('POST /api/order/[id] — cancel', () => {
	it('cancels a pending_payment order', async () => {
		wireDeps();
		const post = await callPost(orderPOST, { body: validBody() });
		const r = await callPost(orderIdPOST, {
			params: { id: post.data.orderId },
			body: { action: 'cancel' },
		});
		expect(r.status).toBe(200);
		expect(r.data.state).toBe('cancelled_pre_production');
	});

	it('returns 400 on unknown action', async () => {
		wireDeps();
		const post = await callPost(orderPOST, { body: validBody() });
		const r = await callPost(orderIdPOST, {
			params: { id: post.data.orderId },
			body: { action: 'bonk' },
		});
		expect(r.status).toBe(400);
	});

	it('returns 409 past_cancel_window when out-of-window', async () => {
		const deps = wireDeps();
		const post = await callPost(orderPOST, { body: validBody() });
		await deps.lifecycle.transition(post.data.orderId, 'paid', 'system');
		await deps.lifecycle.transition(post.data.orderId, 'submitted_to_lulu', 'system');
		await deps.lifecycle.transition(post.data.orderId, 'in_production', 'lulu');
		const r = await callPost(orderIdPOST, {
			params: { id: post.data.orderId },
			body: { action: 'cancel' },
		});
		expect(r.status).toBe(409);
		expect(r.data.error).toBe('past_cancel_window');
	});
});
