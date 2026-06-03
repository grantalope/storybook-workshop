// @graph-layer: private
// tests/ui/station7-stripe-elements.test.ts
//
// Real Stripe Elements lazy-load + Station 7 confirm-card-payment polish.
//
// Covered surface:
//   - StripeElementsLoader: lazy script injection, window.Stripe caching,
//     factory-override test seam, null fallback for malformed inputs and
//     SSR environments.
//   - /api/order/[id] POST {action: 'confirm'}: server-side re-fetch of
//     PaymentIntent before transitioning to 'paid'; idempotent vs webhook;
//     refuses to transition on non-succeeded statuses.
//   - Cross-cutting: client-side `confirmCardPayment` happens in the
//     browser (documented), server NEVER trusts client status claim.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
	loadStripe,
	__setStripeFactory,
	__resetStripeLoader,
	type StripeInstance,
	type StripeCardElement,
} from '$lib/workshop/components/StripeElementsLoader';
import {
	InMemoryOrderStore,
	OrderLifecycleService,
	StripeCheckoutService,
	type Order,
} from '$lib/services/fulfillment';
import {
	POST as orderPOST,
	__setOrderApiDeps,
} from '../../src/routes/api/order/+server';
import { POST as orderIdPOST } from '../../src/routes/api/order/[id]/+server';
import { callPost } from '../fulfillment/api-helpers';
import {
	createMockStripe,
	makeAddress,
	makeShippingOption,
	makeConsent,
	makeClock,
	makeIdGen,
} from '../fulfillment/fixtures';

// ---------------------------------------------------------------------------
// StripeElementsLoader unit tests
// ---------------------------------------------------------------------------

describe('StripeElementsLoader.loadStripe', () => {
	beforeEach(() => {
		__resetStripeLoader();
	});
	afterEach(() => {
		__resetStripeLoader();
	});

	it('returns null when publishableKey is empty', async () => {
		const stripe = await loadStripe('');
		expect(stripe).toBeNull();
	});

	it('returns null when publishableKey is not a string', async () => {
		const stripe = await loadStripe(undefined as unknown as string);
		expect(stripe).toBeNull();
	});

	it('uses the factory override and returns a Stripe instance', async () => {
		const fakeCard: StripeCardElement = {
			mount: vi.fn(),
			unmount: vi.fn(),
			destroy: vi.fn(),
			on: vi.fn(),
		};
		const fakeStripe: StripeInstance = {
			elements: () => ({ create: () => fakeCard }),
			confirmCardPayment: vi.fn(),
		};
		__setStripeFactory(() => fakeStripe);
		const stripe = await loadStripe('pk_test_abc');
		expect(stripe).toBe(fakeStripe);
	});

	it('caches the instance per publishable key — repeated calls return same ref', async () => {
		let constructed = 0;
		const fakeStripe: StripeInstance = {
			elements: () => ({
				create: () => ({
					mount: vi.fn(),
					unmount: vi.fn(),
					destroy: vi.fn(),
					on: vi.fn(),
				}),
			}),
			confirmCardPayment: vi.fn(),
		};
		__setStripeFactory(() => {
			constructed++;
			return fakeStripe;
		});
		const a = await loadStripe('pk_test_xyz');
		const b = await loadStripe('pk_test_xyz');
		expect(a).toBe(b);
		expect(constructed).toBe(1);
	});

	it('returns null in non-browser env when no factory override is set', async () => {
		// vitest default env is jsdom which provides window+document; for
		// this test we force the SSR branch by deleting the override and
		// stubbing the global window value to undefined for the duration.
		__setStripeFactory(null);
		const origWindow = globalThis.window;
		const origDoc = globalThis.document;
		delete (globalThis as { window?: unknown }).window;
		delete (globalThis as { document?: unknown }).document;
		try {
			const stripe = await loadStripe('pk_test_ssr');
			expect(stripe).toBeNull();
		} finally {
			(globalThis as { window?: unknown }).window = origWindow;
			(globalThis as { document?: unknown }).document = origDoc;
		}
	});

	it('factory throwing returns null (graceful degradation)', async () => {
		__setStripeFactory(() => {
			throw new Error('boom');
		});
		const stripe = await loadStripe('pk_test_throws');
		expect(stripe).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// /api/order/[id] POST {action:'confirm'} — server-side payment verification
// ---------------------------------------------------------------------------

type PiStatus = 'requires_payment_method' | 'requires_confirmation' | 'succeeded' | 'canceled';

function wireDeps(opts: { piStatus?: PiStatus } = {}) {
	const store = new InMemoryOrderStore();
	const stripeHttp = createMockStripe();
	// Override getPaymentIntent so confirm-action server re-fetch yields the
	// caller-controlled status (Stripe is source of truth for status).
	const origGet = stripeHttp.getPaymentIntent;
	stripeHttp.getPaymentIntent = async (id: string) => {
		const pi = await origGet.call(stripeHttp, id);
		return { ...pi, status: (opts.piStatus ?? 'succeeded') as PiStatus };
	};
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

describe('POST /api/order/[id] — confirm (real Stripe Elements path)', () => {
	it('transitions pending_payment → paid when PI status is succeeded', async () => {
		wireDeps({ piStatus: 'succeeded' as PiStatus });
		const post = await callPost(orderPOST, { body: validBody() });
		const orderId = post.data.orderId;
		const r = await callPost(orderIdPOST, {
			params: { id: orderId },
			body: { action: 'confirm' },
		});
		expect(r.status).toBe(200);
		expect(r.data.state).toBe('paid');
	});

	it('is idempotent when the order is already paid (webhook race)', async () => {
		const deps = wireDeps({ piStatus: 'succeeded' });
		const post = await callPost(orderPOST, { body: validBody() });
		const orderId = post.data.orderId;
		// Webhook arrived first, order is already paid.
		await deps.lifecycle.transition(orderId, 'paid', 'system');
		const r = await callPost(orderIdPOST, {
			params: { id: orderId },
			body: { action: 'confirm' },
		});
		expect(r.status).toBe(200);
		expect(r.data.state).toBe('paid');
		expect(r.data.idempotent).toBe(true);
	});

	it('returns 409 when Stripe reports PI not succeeded (client lied)', async () => {
		// Critical security property: server NEVER trusts the client claim;
		// the canonical PI status from Stripe is the only signal that flips
		// the lifecycle.
		wireDeps({ piStatus: 'requires_payment_method' });
		const post = await callPost(orderPOST, { body: validBody() });
		const orderId = post.data.orderId;
		const r = await callPost(orderIdPOST, {
			params: { id: orderId },
			body: { action: 'confirm' },
		});
		expect(r.status).toBe(409);
		expect(r.data.error).toBe('payment_not_succeeded');
		expect(r.data.status).toBe('requires_payment_method');
	});

	it('returns 404 for unknown order id', async () => {
		wireDeps();
		const r = await callPost(orderIdPOST, {
			params: { id: 'ord_missing' },
			body: { action: 'confirm' },
		});
		expect(r.status).toBe(404);
		expect(r.data.error).toBe('not_found');
	});

	it('returns 409 invalid_state when order is in submitted_to_lulu', async () => {
		const deps = wireDeps({ piStatus: 'succeeded' });
		const post = await callPost(orderPOST, { body: validBody() });
		const orderId = post.data.orderId;
		await deps.lifecycle.transition(orderId, 'paid', 'system');
		await deps.lifecycle.transition(orderId, 'submitted_to_lulu', 'system');
		const r = await callPost(orderIdPOST, {
			params: { id: orderId },
			body: { action: 'confirm' },
		});
		expect(r.status).toBe(409);
		expect(r.data.error).toBe('invalid_state');
	});

	it('returns 409 no_payment_intent when order has no stripe id', async () => {
		const deps = wireDeps({ piStatus: 'succeeded' });
		// Construct an order directly in the store WITHOUT a paymentIntentId
		// so the confirm path's pre-check fires.
		const orderId = 'ord_no_pi';
		const now = Date.now();
		const bare: Order = {
			id: orderId,
			kidId: 'k',
			bookId: 'b',
			parentEmail: 'p@x.com',
			format: 'hardcover-8x8',
			pages: 40,
			pdfHash: 'sha256-aaaaaaaa',
			shippingAddress: makeAddress(),
			shippingOption: makeShippingOption(),
			bookCostCents: 2999,
			state: 'pending_payment',
			transitions: [
				{ from: null, to: 'pending_payment', at: now, actor: 'system' },
			],
			consentLog: makeConsent(),
			createdAt: now,
			updatedAt: now,
		};
		await deps.store.put(bare);
		const r = await callPost(orderIdPOST, {
			params: { id: orderId },
			body: { action: 'confirm' },
		});
		expect(r.status).toBe(409);
		expect(r.data.error).toBe('no_payment_intent');
	});

	it('Stripe re-fetch is always invoked on confirm (server is authoritative)', async () => {
		const deps = wireDeps({ piStatus: 'succeeded' });
		const post = await callPost(orderPOST, { body: validBody() });
		const orderId = post.data.orderId;
		const before = deps.stripeHttp.calls.filter(
			(c) => c.method === 'getPaymentIntent',
		).length;
		await callPost(orderIdPOST, {
			params: { id: orderId },
			body: { action: 'confirm' },
		});
		const after = deps.stripeHttp.calls.filter(
			(c) => c.method === 'getPaymentIntent',
		).length;
		expect(after).toBe(before + 1);
	});

	it('unknown action returns 400 (preserves cancel-action contract)', async () => {
		wireDeps();
		const post = await callPost(orderPOST, { body: validBody() });
		const r = await callPost(orderIdPOST, {
			params: { id: post.data.orderId },
			body: { action: 'cooltime' },
		});
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('unknown_action');
	});
});
