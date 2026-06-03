// src/routes/api/order/[id]/+server.ts
//
// GET: parent-facing order status projection.
// POST: parent-initiated actions.
//   - { action: 'cancel' }  — cancel inside the 75-min Lulu window.
//   - { action: 'confirm' } — confirm the client-side Stripe Elements
//                              `confirmCardPayment` succeeded. The server
//                              re-fetches the PaymentIntent from Stripe to
//                              verify status (NEVER trusts the client claim);
//                              on `succeeded` transitions the order to `paid`
//                              if it is still `pending_payment`. The webhook
//                              remains the ultimate source of truth for the
//                              backend lifecycle — `{action:confirm}` lets
//                              the parent UI see "paid" immediately rather
//                              than waiting for the async webhook round-trip,
//                              while staying idempotent with the webhook
//                              handler (both transition only when the order
//                              is still pending_payment).

import { json, type RequestHandler } from '@sveltejs/kit';
import { OrderAuditService, OrderLifecycleError } from '$lib/services/fulfillment';
import { __getOrderApiDeps } from '../+server';

export const GET: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id) return json({ error: 'missing_id' }, { status: 400 });
	const deps = __getOrderApiDeps();
	const audit = new OrderAuditService({ store: deps.store });
	const status = await audit.getStatus(id);
	if (!status) return json({ error: 'not_found' }, { status: 404 });
	return json(status);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const id = params.id;
	if (!id) return json({ error: 'missing_id' }, { status: 400 });
	let body: { action?: string };
	try {
		body = (await request.json()) as { action?: string };
	} catch {
		body = {};
	}
	const deps = __getOrderApiDeps();
	if (body.action === 'cancel') {
		try {
			const order = await deps.lifecycle.cancelByParent(id);
			return json({ ok: true, state: order.state });
		} catch (e) {
			if (e instanceof OrderLifecycleError) {
				return json({ error: e.reason }, { status: 409 });
			}
			throw e;
		}
	}
	if (body.action === 'confirm') {
		const order = await deps.store.get(id);
		if (!order) return json({ error: 'not_found' }, { status: 404 });
		if (order.state === 'paid') {
			// Webhook may have raced ahead — idempotent: nothing to do.
			return json({ ok: true, state: order.state, idempotent: true });
		}
		if (order.state !== 'pending_payment') {
			return json(
				{ error: 'invalid_state', state: order.state },
				{ status: 409 },
			);
		}
		if (!order.stripePaymentIntentId) {
			return json({ error: 'no_payment_intent' }, { status: 409 });
		}
		// Server-side verification: ALWAYS re-fetch the PaymentIntent from
		// Stripe before transitioning. The client claim is informational —
		// the server-known PI status is authoritative.
		let pi;
		try {
			pi = await deps.stripe.getPaymentIntent(order.stripePaymentIntentId);
		} catch (e) {
			return json(
				{ error: 'stripe_error', message: (e as Error).message },
				{ status: 502 },
			);
		}
		if (pi.status !== 'succeeded') {
			return json(
				{ error: 'payment_not_succeeded', status: pi.status },
				{ status: 409 },
			);
		}
		try {
			const next = await deps.lifecycle.transition(id, 'paid', 'system', {
				reason: 'client_confirm_card_payment_verified',
				meta: { paymentIntentId: order.stripePaymentIntentId },
			});
			return json({ ok: true, state: next.state });
		} catch (e) {
			if (e instanceof OrderLifecycleError) {
				return json({ error: e.reason }, { status: 409 });
			}
			throw e;
		}
	}
	return json({ error: 'unknown_action', action: body.action }, { status: 400 });
};
