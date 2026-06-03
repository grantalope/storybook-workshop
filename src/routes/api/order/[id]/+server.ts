// src/routes/api/order/[id]/+server.ts
//
// GET: parent-facing order status projection.
// POST: parent-initiated cancel (within window).

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
	if (body.action !== 'cancel') {
		return json({ error: 'unknown_action', action: body.action }, { status: 400 });
	}
	const deps = __getOrderApiDeps();
	try {
		const order = await deps.lifecycle.cancelByParent(id);
		return json({ ok: true, state: order.state });
	} catch (e) {
		if (e instanceof OrderLifecycleError) {
			return json({ error: e.reason }, { status: 409 });
		}
		throw e;
	}
};
