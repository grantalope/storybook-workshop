// src/routes/api/stripe-webhook/+server.ts
//
// POST: inbound Stripe webhook. Verifies signature, parses event, maps
// payment_intent.succeeded -> paid (then submit to Lulu via onPaid handler).
// charge.refunded -> audit log only (state machine doesn't have a refunded
// state — see spec §5.5; refund tracking lives in the transition log).

import { json, type RequestHandler } from '@sveltejs/kit';
import {
	StripeCheckoutService,
	OrderLifecycleError,
	type StripeHttpClient,
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

	if (event.type === 'payment_intent.succeeded') {
		const piId = event.data.object.id;
		const order = await orderDeps.store.getByStripePaymentIntent(piId);
		if (!order) {
			return json({ ok: true, ignored: 'unknown_payment_intent' });
		}
		if (order.state !== 'pending_payment') {
			return json({ ok: true, ignored: 'not_pending_payment', state: order.state });
		}
		try {
			await orderDeps.lifecycle.transition(order.id, 'paid', 'system', {
				reason: 'stripe_payment_intent_succeeded',
				meta: { paymentIntentId: piId },
			});
			return json({ ok: true, transitioned: 'paid' });
		} catch (e) {
			if (e instanceof OrderLifecycleError) {
				return json({ error: e.reason }, { status: 409 });
			}
			throw e;
		}
	}

	if (event.type === 'payment_intent.payment_failed') {
		const piId = event.data.object.id;
		const order = await orderDeps.store.getByStripePaymentIntent(piId);
		if (!order) return json({ ok: true, ignored: 'unknown_payment_intent' });
		if (order.state !== 'pending_payment') {
			return json({ ok: true, ignored: 'not_pending_payment' });
		}
		try {
			await orderDeps.lifecycle.transition(order.id, 'failed_validation', 'system', {
				reason: 'stripe_payment_failed',
				meta: { paymentIntentId: piId },
			});
			return json({ ok: true, transitioned: 'failed_validation' });
		} catch (e) {
			if (e instanceof OrderLifecycleError) {
				return json({ error: e.reason }, { status: 409 });
			}
			throw e;
		}
	}

	if (event.type === 'charge.refunded') {
		// Audit log only; state machine has no refunded state.
		const piId = event.data.object.id;
		const order = await orderDeps.store.getByStripePaymentIntent(piId);
		if (order) {
			const updated = {
				...order,
				transitions: [
					...order.transitions,
					{
						from: order.state,
						to: order.state,
						at: Date.now(),
						actor: 'system' as const,
						reason: 'stripe_charge_refunded',
						meta: { paymentIntentId: piId },
					},
				],
				updatedAt: Date.now(),
			};
			await orderDeps.store.put(updated);
		}
		return json({ ok: true, audited: 'refund' });
	}

	return json({ ok: true, ignored: 'unhandled_event_type', type: event.type });
};
