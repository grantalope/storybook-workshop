// @graph-layer: private
// tests/ui/station7-stripe-elements.test.ts
//
// Real Stripe Elements lazy-load + Station 7 confirm-card-payment polish.
//
// Covered surface:
//   - StripeElementsLoader: lazy script injection, window.Stripe caching,
//     factory-override test seam, null fallback for malformed inputs and
//     SSR environments.
//   - `readPublishableKey()`: live `$env/static/public` import, vitest
//     `process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY` shim, test-only override.
//   - `stripeElementsGate`: useRealStripe decision, 3DS / requires_action
//     classification, retrievePaymentIntent re-poll after 3DS.
//   - /api/order/[id] POST {action: 'confirm'}: server-side re-fetch of
//     PaymentIntent before transitioning to 'paid'; idempotent vs webhook;
//     refuses to transition on non-succeeded statuses.
//   - Cross-cutting: client-side `confirmCardPayment` happens in the
//     browser (documented), server NEVER trusts client status claim.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
	loadStripe,
	readPublishableKey,
	getLastStripeLoadError,
	__setStripeFactory,
	__resetStripeLoader,
	__setPublishableKeyForTests,
	type StripeInstance,
	type StripeCardElement,
	type StripePaymentIntentResult,
} from '$lib/workshop/components/StripeElementsLoader';
import {
	decideStripePath,
	handlePaymentIntentResult,
	pollAfter3DS,
} from '$lib/workshop/services/stripeElementsGate';
import {
	type Order,
} from '$lib/services/fulfillment';
import { POST as orderPOST } from '../../src/routes/api/order/+server';
import { POST as orderIdPOST } from '../../src/routes/api/order/[id]/+server';
import { callPost } from '../fulfillment/api-helpers';
import {
	makeAddress,
	makeShippingOption,
	makeConsent,
} from '../fulfillment/fixtures';
import { wireFulfillmentDeps } from '../fulfillment/wireFulfillmentDeps';

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
		expect(getLastStripeLoadError()?.message).toBe('invalid_publishable_key');
	});

	it('returns null when publishableKey is not a string', async () => {
		const stripe = await loadStripe(undefined as unknown as string);
		expect(stripe).toBeNull();
		expect(getLastStripeLoadError()?.message).toBe('invalid_publishable_key');
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
			retrievePaymentIntent: vi.fn(),
		};
		__setStripeFactory(() => fakeStripe);
		const stripe = await loadStripe('pk_test_abc');
		expect(stripe).toBe(fakeStripe);
		// Successful load clears the last error.
		expect(getLastStripeLoadError()).toBeNull();
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
			retrievePaymentIntent: vi.fn(),
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
		// vitest default env is node; force the SSR branch by stubbing
		// window/document undefined for the duration of the test.
		__setStripeFactory(null);
		const origWindow = (globalThis as { window?: unknown }).window;
		const origDoc = (globalThis as { document?: unknown }).document;
		delete (globalThis as { window?: unknown }).window;
		delete (globalThis as { document?: unknown }).document;
		try {
			const stripe = await loadStripe('pk_test_ssr');
			expect(stripe).toBeNull();
			expect(getLastStripeLoadError()?.message).toBe('no_browser_environment');
		} finally {
			(globalThis as { window?: unknown }).window = origWindow;
			(globalThis as { document?: unknown }).document = origDoc;
		}
	});

	it('factory throwing returns null + captures error (graceful degradation)', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			__setStripeFactory(() => {
				throw new Error('boom');
			});
			const stripe = await loadStripe('pk_test_throws');
			expect(stripe).toBeNull();
			expect(getLastStripeLoadError()?.message).toBe('boom');
			expect(spy).toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
});

// ---------------------------------------------------------------------------
// readPublishableKey — $env/static/public bridge
// ---------------------------------------------------------------------------

describe('readPublishableKey — $env/static/public bridge', () => {
	beforeEach(() => {
		__resetStripeLoader();
		__setPublishableKeyForTests(null);
	});
	afterEach(() => {
		__setPublishableKeyForTests(null);
	});

	it('returns the test-override value when set', () => {
		__setPublishableKeyForTests('pk_test_override_xyz');
		expect(readPublishableKey()).toBe('pk_test_override_xyz');
	});

	it("returns '' when the override is null and the env value is missing", () => {
		// Vitest alias points at src/test-stubs/$env/static/public.ts which
		// reads process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY. Both should be
		// unset in the default vitest run.
		expect(readPublishableKey()).toBe('');
	});

	it('test override of empty string is honoured (signals devMode-fallback)', () => {
		__setPublishableKeyForTests('');
		expect(readPublishableKey()).toBe('');
	});
});

// ---------------------------------------------------------------------------
// decideStripePath — useRealStripe gate
// ---------------------------------------------------------------------------

describe('stripeElementsGate.decideStripePath', () => {
	it('returns useRealStripe=true when key is set and devMode is false', () => {
		const d = decideStripePath({
			publishableKey: 'pk_test_real',
			devMode: false,
		});
		expect(d).toEqual({ useRealStripe: true, reason: 'real_stripe' });
	});

	it('returns useRealStripe=false when key is empty', () => {
		const d = decideStripePath({ publishableKey: '', devMode: false });
		expect(d).toEqual({ useRealStripe: false, reason: 'no_key' });
	});

	it('returns useRealStripe=false when devMode=true even if key is set', () => {
		const d = decideStripePath({
			publishableKey: 'pk_test_real',
			devMode: true,
		});
		expect(d).toEqual({ useRealStripe: false, reason: 'dev_mode' });
	});
});

// ---------------------------------------------------------------------------
// handlePaymentIntentResult — 3DS / declined / error classification
// ---------------------------------------------------------------------------

describe('stripeElementsGate.handlePaymentIntentResult', () => {
	it('returns succeeded for a clean PI', () => {
		const r: StripePaymentIntentResult = {
			paymentIntent: { id: 'pi_1', status: 'succeeded' },
		};
		expect(handlePaymentIntentResult(r)).toEqual({ kind: 'succeeded' });
	});

	it('returns requires_action for a 3DS challenge (with UX guidance)', () => {
		const r: StripePaymentIntentResult = {
			paymentIntent: { id: 'pi_2', status: 'requires_action' },
		};
		const outcome = handlePaymentIntentResult(r);
		expect(outcome.kind).toBe('requires_action');
		expect(outcome.kind === 'requires_action' && outcome.userMessage).toContain(
			'bank verification',
		);
	});

	it('returns requires_payment_method for a declined card', () => {
		const r: StripePaymentIntentResult = {
			paymentIntent: { id: 'pi_3', status: 'requires_payment_method' },
		};
		const outcome = handlePaymentIntentResult(r);
		expect(outcome.kind).toBe('requires_payment_method');
		expect(outcome.kind === 'requires_payment_method' && outcome.userMessage).toMatch(
			/declined/i,
		);
	});

	it('returns error when result.error is present', () => {
		const r: StripePaymentIntentResult = {
			error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' },
		};
		const outcome = handlePaymentIntentResult(r);
		expect(outcome.kind).toBe('error');
		expect(outcome.kind === 'error' && outcome.userMessage).toBe(
			'Your card was declined.',
		);
	});

	it('returns other_pending for non-terminal statuses', () => {
		const r: StripePaymentIntentResult = {
			paymentIntent: { id: 'pi_4', status: 'processing' },
		};
		const outcome = handlePaymentIntentResult(r);
		expect(outcome.kind).toBe('other_pending');
		expect(outcome.kind === 'other_pending' && outcome.status).toBe('processing');
	});
});

describe('stripeElementsGate.pollAfter3DS', () => {
	it('re-fetches PI via retrievePaymentIntent and returns succeeded after the challenge', async () => {
		const retrieve = vi.fn().mockResolvedValue({
			paymentIntent: { id: 'pi_3ds', status: 'succeeded' },
		});
		const fakeStripe: StripeInstance = {
			elements: () => ({ create: () => ({} as StripeCardElement) }),
			confirmCardPayment: vi.fn(),
			retrievePaymentIntent: retrieve,
		};
		const outcome = await pollAfter3DS(fakeStripe, 'cs_test_secret');
		expect(retrieve).toHaveBeenCalledWith('cs_test_secret');
		expect(outcome).toEqual({ kind: 'succeeded' });
	});

	it('returns requires_payment_method when 3DS challenge failed', async () => {
		const retrieve = vi.fn().mockResolvedValue({
			paymentIntent: { id: 'pi_3ds_fail', status: 'requires_payment_method' },
		});
		const fakeStripe: StripeInstance = {
			elements: () => ({ create: () => ({} as StripeCardElement) }),
			confirmCardPayment: vi.fn(),
			retrievePaymentIntent: retrieve,
		};
		const outcome = await pollAfter3DS(fakeStripe, 'cs_test_secret');
		expect(outcome.kind).toBe('requires_payment_method');
	});
});

// ---------------------------------------------------------------------------
// /api/order/[id] POST {action:'confirm'} — server-side payment verification
// ---------------------------------------------------------------------------

type PiStatus = 'requires_payment_method' | 'requires_confirmation' | 'succeeded' | 'canceled';

function wireDeps(opts: { piStatus?: PiStatus } = {}) {
	const deps = wireFulfillmentDeps({ stripeWebhookSecret: 's' });
	const { store, stripeHttp, stripe, clock, lifecycle, idGen } = deps;
	// Override getPaymentIntent so confirm-action server re-fetch yields the
	// caller-controlled status (Stripe is source of truth for status).
	const origGet = stripeHttp.getPaymentIntent;
	stripeHttp.getPaymentIntent = async (id: string) => {
		const pi = await origGet.call(stripeHttp, id);
		return { ...pi, status: (opts.piStatus ?? 'succeeded') as PiStatus };
	};
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

// ---------------------------------------------------------------------------
// /api/order POST does NOT require client-side bookCostCents (server-as-truth)
// ---------------------------------------------------------------------------

describe('POST /api/order — server is single source of truth for price', () => {
	it('creates an order successfully when client omits bookCostCents entirely', async () => {
		wireDeps({ piStatus: 'succeeded' });
		const body = { ...validBody() };
		// validBody() already omits bookCostCents; assert that the create
		// succeeds with no price drift hazard.
		expect((body as Record<string, unknown>).bookCostCents).toBeUndefined();
		const r = await callPost(orderPOST, { body });
		expect(r.status).toBe(200);
		expect(r.data.orderId).toBeTruthy();
	});
});
