// src/routes/api/stripe-webhook/+server.ts
//
// POST: inbound Stripe webhook. Verifies signature, parses event, maps
// payment_intent.succeeded -> paid (then submit to Lulu via onPaid handler).
// charge.refunded -> audit log only (state machine doesn't have a refunded
// state — see spec §5.5; refund tracking lives in the transition log).

import { json, type RequestHandler } from '@sveltejs/kit';
import {
	StripeCheckoutService,
	isWebhookOrderStore,
	type OrderStore,
	type StripeHttpClient,
	type OrderState,
	type StripeWebhookApplyResult,
	type WebhookOrderStore,
} from '$lib/services/fulfillment';
import { __getOrderApiDeps } from '../order/+server';

interface StripeWebhookApiDeps {
	stripe: StripeCheckoutService;
}

let _deps: StripeWebhookApiDeps | null = null;

export function __setStripeWebhookApiDeps(deps: StripeWebhookApiDeps): void {
	_deps = deps;
}

export function __getStripeWebhookApiDeps(): StripeWebhookApiDeps {
	if (_deps) return _deps;
	const stripeHttp: StripeHttpClient = {
		async createPaymentIntent(_opts, _key) {
			return {
				id: 'pi_test',
				clientSecret: 'pi_test_secret',
				status: 'requires_payment_method',
				amountCents: 0,
				currency: 'USD',
			};
		},
		async getPaymentIntent(id) {
			return {
				id,
				clientSecret: `${id}_secret`,
				status: 'succeeded',
				amountCents: 0,
				currency: 'USD',
			};
		},
		async refund(paymentIntentId, amountCents) {
			return {
				id: 'refund_test',
				paymentIntentId,
				amountCents: amountCents ?? 0,
				status: 'succeeded',
			};
		},
	};
	const stripe = new StripeCheckoutService({
		http: stripeHttp,
		webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? 'test-webhook-secret',
	});
	_deps = { stripe };
	return _deps;
}

export const POST: RequestHandler = async ({ request }) => {
	const rawBody = await request.text();
	const sigHeader = request.headers.get('Stripe-Signature');
	const wDeps = __getStripeWebhookApiDeps();
	const orderDeps = __getOrderApiDeps();

	const sigOk = await wDeps.stripe.verifyWebhookSignature(rawBody, sigHeader);
	if (!sigOk) {
		return json({ error: 'invalid_signature' }, { status: 401 });
	}

	let event;
	try {
		event = wDeps.stripe.parseWebhookEvent(rawBody);
	} catch (e) {
		return json({ error: 'malformed_payload', message: (e as Error).message }, { status: 400 });
	}

	if (!hasEventId(event)) {
		return json({ error: 'malformed_payload', message: 'missing Stripe event id' }, { status: 400 });
	}

	const store = requireWebhookOrderStore(orderDeps.store);
	if (!store) {
		return json({ error: 'webhook_store_missing_capability' }, { status: 500 });
	}
	const at = orderDeps.nowSource();

	if (event.type === 'payment_intent.succeeded') {
		const piId = paymentIntentIdFromPaymentIntentEvent(event);
		if (!piId) return json({ error: 'malformed_payload', message: 'missing PaymentIntent id' }, { status: 400 });
		const result = await store.applyStripeWebhookEventOnce({
			eventId: event.id,
			eventType: event.type,
			paymentIntentId: piId,
			expectedState: 'pending_payment',
			toState: 'paid',
			actor: 'system',
			reason: 'stripe_payment_intent_succeeded',
			meta: { paymentIntentId: piId },
			at,
		});
		if (result.outcome === 'applied' && result.order) {
			await orderDeps.lifecycle._fireHandler('paid', result.order);
		}
		return stripeOutcomeJson(result, { transitioned: 'paid' });
	}

	if (event.type === 'payment_intent.payment_failed') {
		const piId = paymentIntentIdFromPaymentIntentEvent(event);
		if (!piId) return json({ error: 'malformed_payload', message: 'missing PaymentIntent id' }, { status: 400 });
		const result = await store.applyStripeWebhookEventOnce({
			eventId: event.id,
			eventType: event.type,
			paymentIntentId: piId,
			expectedState: 'pending_payment',
			toState: 'failed_validation',
			actor: 'system',
			reason: 'stripe_payment_failed',
			meta: { paymentIntentId: piId },
			at,
		});
		if (result.outcome === 'applied' && result.order) {
			await orderDeps.lifecycle._fireHandler('failed_validation', result.order);
		}
		return stripeOutcomeJson(result, { transitioned: 'failed_validation' });
	}

	if (event.type === 'charge.refunded') {
		// Audit log only; state machine has no refunded state.
		const piId = paymentIntentIdFromChargeEvent(event);
		if (!piId) return json({ error: 'malformed_payload', message: 'missing charge PaymentIntent id' }, { status: 400 });
		const result = await store.applyStripeWebhookEventOnce({
			eventId: event.id,
			eventType: event.type,
			paymentIntentId: piId,
			actor: 'system',
			reason: 'stripe_charge_refunded',
			meta: { paymentIntentId: piId },
			at,
		});
		return stripeOutcomeJson(result, { audited: 'refund' });
	}

	console.info('[stripe-webhook] ignored unhandled event type', event.type);
	return json({
		ok: true,
		received: true,
		outcome: 'ignored',
		ignored: true,
		reason: 'unhandled_event_type',
		type: event.type,
	});
};

function requireWebhookOrderStore(store: OrderStore): WebhookOrderStore | null {
	return isWebhookOrderStore(store) ? store : null;
}

function hasEventId(event: { id?: unknown }): event is { id: string } {
	return typeof event.id === 'string' && event.id.length > 0;
}

function paymentIntentIdFromPaymentIntentEvent(event: { data?: { object?: { id?: unknown } } }): string | null {
	const id = event.data?.object?.id;
	return typeof id === 'string' && id.length > 0 ? id : null;
}

function paymentIntentIdFromChargeEvent(event: {
	data?: { object?: { id?: unknown; payment_intent?: unknown } };
}): string | null {
	const piId = event.data?.object?.payment_intent ?? event.data?.object?.id;
	return typeof piId === 'string' && piId.length > 0 ? piId : null;
}

function stripeOutcomeJson(
	result: StripeWebhookApplyResult,
	applied: { transitioned?: OrderState; audited?: 'refund' },
) {
	if (result.outcome === 'applied') {
		return json({ ok: true, received: true, outcome: 'applied', ...applied });
	}
	if (result.outcome === 'duplicate') {
		return json({ ok: true, received: true, outcome: 'duplicate', deduped: true });
	}

	const ignored =
		result.reason === 'unknown_payment_intent' ? 'unknown_payment_intent' : 'not_pending_payment';
	return json({
		ok: true,
		received: true,
		outcome: 'ignored',
		ignored,
		state: result.currentState,
		...applied,
	});
}
