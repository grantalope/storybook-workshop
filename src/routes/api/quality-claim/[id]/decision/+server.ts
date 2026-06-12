// src/routes/api/quality-claim/[id]/decision/+server.ts
//
// Ops-only quality-claim decisions. Parent claim submit remains separate and
// cannot self-approve refunds.

import { json, type RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import {
	isRefundLedgerStore,
	type Order,
	type RefundLedgerEntry,
	type RefundResult,
} from '$lib/services/fulfillment';
import { __getOrderApiDeps } from '../../../order/+server';
import { __getQualityApiDeps } from '../../+server';

interface DecisionBody {
	decision?: unknown;
	amountCents?: unknown;
	refundKind?: unknown;
}

const DEFAULT_REFUND_KIND = 'quality_claim';

export const POST: RequestHandler = async ({ request, params }) => {
	if (!isAuthorized(request)) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	const claimId = params.id;
	if (!claimId) return json({ error: 'missing_claim_id' }, { status: 400 });

	let body: DecisionBody;
	try {
		body = (await request.json()) as DecisionBody;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	if (body.decision !== 'approved_refund') {
		return json({ error: 'invalid_decision', decision: body.decision }, { status: 400 });
	}
	if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
		return json({ error: 'invalid_refund_amount' }, { status: 400 });
	}

	const refundKind = normalizeRefundKind(body.refundKind);
	if (!refundKind) return json({ error: 'invalid_refund_kind' }, { status: 400 });

	const orderDeps = __getOrderApiDeps();
	const qualityDeps = __getQualityApiDeps();
	const store = orderDeps.store;
	if (!isRefundLedgerStore(store)) {
		return json({ error: 'refund_ledger_store_missing_capability' }, { status: 500 });
	}

	const claim = await qualityDeps.claimStore.get(claimId);
	if (!claim) return json({ error: 'claim_not_found' }, { status: 404 });

	const order = await store.get(claim.orderId);
	if (!order) return json({ error: 'order_not_found' }, { status: 404 });
	if (!order.stripePaymentIntentId) {
		return json({ error: 'missing_payment_intent' }, { status: 409 });
	}

	const amountCents = body.amountCents as number;
	const idempotencyKey = refundIdempotencyKey(order.id, claim.id, amountCents);
	const started = await store.beginRefundOnce({
		orderId: order.id,
		claimId: claim.id,
		refundKind,
		amountCents,
		currency: order.shippingOption.currency,
		stripePaymentIntentId: order.stripePaymentIntentId,
		idempotencyKey,
		at: orderDeps.nowSource(),
	});

	if (started.outcome === 'existing') {
		return existingRefundResponse(started.entry);
	}

	const pendingAt = orderDeps.nowSource();
	const pendingClaim = {
		...claim,
		decision: 'approved_refund_pending' as const,
		decisionReason: 'stripe_refund_pending',
		decisionAt: pendingAt,
	};
	await qualityDeps.claimStore.put(pendingClaim);

	let result: RefundResult;
	try {
		result = await orderDeps.stripe.refund(
			order.stripePaymentIntentId,
			amountCents,
			idempotencyKey,
		);
	} catch (e) {
		const failed = await store.failRefund({
			orderId: order.id,
			claimId: claim.id,
			refundKind,
			errorMessage: messageOf(e),
			at: orderDeps.nowSource(),
		});
		await qualityDeps.claimStore.put({
			...pendingClaim,
			decisionReason: 'stripe_refund_failed',
			decisionAt: failed.updatedAt,
		});
		return json({ error: 'refund_failed', message: messageOf(e), refund: failed }, { status: 502 });
	}

	const settledAt = orderDeps.nowSource();
	if (result.status === 'failed') {
		const failed = await store.failRefund({
			orderId: order.id,
			claimId: claim.id,
			refundKind,
			errorMessage: 'Stripe refund returned failed',
			at: settledAt,
		});
		await qualityDeps.claimStore.put({
			...pendingClaim,
			decisionReason: 'stripe_refund_failed',
			decisionAt: settledAt,
		});
		return json({ error: 'refund_failed', refund: failed }, { status: 502 });
	}

	const completed = await store.completeRefund({
		orderId: order.id,
		claimId: claim.id,
		refundKind,
		result,
		at: settledAt,
	});

	if (result.status === 'pending') {
		await qualityDeps.claimStore.put({
			...pendingClaim,
			decisionReason: 'stripe_refund_pending',
			decisionAt: settledAt,
		});
		return json({ ok: true, alreadyExecuted: false, refund: completed });
	}

	const audited = await appendRefundAuditTransition(store, order, completed, settledAt);
	await qualityDeps.claimStore.put({
		...pendingClaim,
		decision: 'approved_refund',
		decisionReason: 'stripe_refund_succeeded',
		decisionAt: settledAt,
	});
	return json({ ok: true, alreadyExecuted: false, refund: completed, orderState: audited.state });
};

function isAuthorized(request: Request): boolean {
	const expected = opsToken();
	if (!expected) return false;
	const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
	const prefix = 'Bearer ';
	if (!header?.startsWith(prefix)) return false;
	return header.slice(prefix.length) === expected;
}

function opsToken(): string | null {
	const token = (privateEnv as Record<string, string | undefined>).OPS_API_TOKEN;
	return token && token.trim().length > 0 ? token : null;
}

function normalizeRefundKind(value: unknown): string | null {
	if (value === undefined || value === null) return DEFAULT_REFUND_KIND;
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function refundIdempotencyKey(orderId: string, claimId: string, amountCents: number): string {
	return `order:${orderId}:claim:${claimId}:refund:${amountCents}`;
}

function existingRefundResponse(entry: RefundLedgerEntry): Response {
	if (entry.status === 'succeeded') {
		return json({ ok: true, alreadyExecuted: true, refund: entry });
	}
	if (entry.status === 'pending') {
		return json({ ok: true, alreadyPending: true, refund: entry });
	}
	return json({ error: 'refund_failed', alreadyFailed: true, refund: entry }, { status: 502 });
}

async function appendRefundAuditTransition(
	store: { get(id: string): Promise<Order | undefined>; put(order: Order): Promise<void> },
	order: Order,
	refund: RefundLedgerEntry,
	at: number,
): Promise<Order> {
	const latest = (await store.get(order.id)) ?? order;
	const audited: Order = {
		...latest,
		transitions: [
			...latest.transitions,
			{
				from: latest.state,
				to: latest.state,
				at,
				actor: 'ops',
				reason: 'ops_refund_approved',
				meta: {
					claimId: refund.claimId,
					refundKind: refund.refundKind,
					amountCents: refund.amountCents,
					currency: refund.currency,
					paymentIntentId: refund.stripePaymentIntentId,
					stripeRefundId: refund.stripeRefundId,
					idempotencyKey: refund.idempotencyKey,
				},
			},
		],
		updatedAt: at,
	};
	await store.put(audited);
	return audited;
}

function messageOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
