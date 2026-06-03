// src/routes/api/lulu-webhook/+server.ts
//
// POST: inbound Lulu Direct webhook. Verifies signature, parses payload,
// maps Lulu status -> OrderState, applies lifecycle transition.

import { json, type RequestHandler } from '@sveltejs/kit';
import {
	LuluFulfillmentService,
	luluStatusToOrderState,
	OrderLifecycleError,
	type LuluHttpClient,
} from '$lib/services/fulfillment';
import { __getOrderApiDeps } from '../order/+server';

interface LuluWebhookApiDeps {
	lulu: LuluFulfillmentService;
}

let _deps: LuluWebhookApiDeps | null = null;

export function __setLuluWebhookApiDeps(deps: LuluWebhookApiDeps): void {
	_deps = deps;
}

export function __getLuluWebhookApiDeps(): LuluWebhookApiDeps {
	if (_deps) return _deps;
	const luluHttp: LuluHttpClient = {
		async getAccessToken() {
			return { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 };
		},
		async getShippingCost(_req) {
			return { options: [] };
		},
		async createPrintJob(_req) {
			return { id: 'lj_mock', status: { name: 'CREATED' } };
		},
		async getPrintJob(id) {
			return { id, status: { name: 'CREATED' } };
		},
		async cancelPrintJob(_id) {},
		async reissuePrintJob(_id, _reason) {
			return { id: 'lj_mock', status: { name: 'CREATED' } };
		},
	};
	const lulu = new LuluFulfillmentService({
		http: luluHttp,
		webhookSecret: process.env.LULU_WEBHOOK_SECRET ?? 'test-webhook-secret',
	});
	_deps = { lulu };
	return _deps;
}

export const POST: RequestHandler = async ({ request }) => {
	const rawBody = await request.text();
	const sigHeader = request.headers.get('Lulu-Signature');
	const wDeps = __getLuluWebhookApiDeps();
	const orderDeps = __getOrderApiDeps();

	const sigOk = await wDeps.lulu.verifyWebhookSignature(rawBody, sigHeader);
	if (!sigOk) {
		return json({ error: 'invalid_signature' }, { status: 401 });
	}

	let event;
	try {
		event = wDeps.lulu.parseWebhookEvent(rawBody);
	} catch (e) {
		return json({ error: 'malformed_payload', message: (e as Error).message }, { status: 400 });
	}

	const order = await orderDeps.store.getByLuluJob(event.data.printJobId);
	if (!order) {
		// Not an order we know about — ack 200 so Lulu does not retry forever.
		return json({ ok: true, ignored: 'unknown_lulu_job' });
	}

	const targetState = luluStatusToOrderState(event.data.status);
	if (!targetState) {
		return json({ ok: true, ignored: 'unmapped_status', status: event.data.status });
	}
	if (targetState === order.state) {
		return json({ ok: true, ignored: 'no_state_change' });
	}

	try {
		const patch: Partial<typeof order> = {};
		if (event.data.trackingUrl) patch.trackingUrl = event.data.trackingUrl;
		await orderDeps.lifecycle.transition(order.id, targetState, 'lulu', {
			reason: `lulu_webhook:${event.topic}`,
			meta: { rawStatus: event.data.status },
			patch,
		});
		return json({ ok: true, transitioned: targetState });
	} catch (e) {
		if (e instanceof OrderLifecycleError) {
			return json({ error: e.reason }, { status: 409 });
		}
		throw e;
	}
};
