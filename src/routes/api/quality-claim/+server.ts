// src/routes/api/quality-claim/+server.ts
//
// POST: submit a parent quality claim.
//   Body: { orderId, category, photoUrls, parentText }
//   Returns: { claimId, decision, reason, shouldReprint }
// GET: list pending claims (ops view).

import { json, type RequestHandler } from '@sveltejs/kit';
import {
	QualityGuaranteeHandler,
	InMemoryQualityClaimStore,
	type QualityClaimCategory,
} from '$lib/services/fulfillment';
import { __getOrderApiDeps } from '../order/+server';
import { secureRandomString } from '$lib/services/subscription/secureRandom';

interface QualityApiDeps {
	handler: QualityGuaranteeHandler;
	claimStore: InMemoryQualityClaimStore;
	idGen: () => string;
}

let _deps: QualityApiDeps | null = null;

const _QUALITY_CLAIM_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function _secureQualityClaimIdGen(): string {
	return `claim_${secureRandomString(10, _QUALITY_CLAIM_ID_ALPHABET)}`;
}

export function __setQualityApiDeps(deps: QualityApiDeps): void {
	_deps = deps;
}

export function __getQualityApiDeps(): QualityApiDeps {
	if (_deps) return _deps;
	const claimStore = new InMemoryQualityClaimStore();
	const orderDeps = __getOrderApiDeps();
	const handler = new QualityGuaranteeHandler({
		orderStore: orderDeps.store,
		claimStore,
	});
	_deps = {
		handler,
		claimStore,
		idGen: _secureQualityClaimIdGen,
	};
	return _deps;
}

interface ClaimBody {
	orderId: string;
	category: QualityClaimCategory;
	photoUrls?: string[];
	parentText?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: ClaimBody;
	try {
		body = (await request.json()) as ClaimBody;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}
	if (!body.orderId) return json({ error: 'missing_orderId' }, { status: 400 });
	const cats: QualityClaimCategory[] = ['defect', 'wrong_content', 'lost_transit', 'color_off'];
	if (!cats.includes(body.category)) {
		return json({ error: 'invalid_category', category: body.category }, { status: 400 });
	}
	const deps = __getQualityApiDeps();
	const claim = await deps.handler.submit({
		id: deps.idGen(),
		orderId: body.orderId,
		category: body.category,
		photoUrls: body.photoUrls ?? [],
		parentText: body.parentText ?? '',
	});
	return json({
		claimId: claim.id,
		decision: claim.decision,
		reason: claim.decisionReason,
	});
};

export const GET: RequestHandler = async () => {
	const deps = __getQualityApiDeps();
	const pending = await deps.handler.listPending();
	return json({ pending });
};
