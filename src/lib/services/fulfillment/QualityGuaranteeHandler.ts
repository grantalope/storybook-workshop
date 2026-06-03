// @graph-layer: private
// @rationale: private (parent-side defect claim processing — billing PII tier)
//
// src/lib/services/fulfillment/QualityGuaranteeHandler.ts
//
// Decision logic for quality-guarantee claims per spec §5.5 + §5.7.
//
// Key invariants:
//  - 30-day window from delivery for all categories.
//  - `wrong_content` claims are auto-rejected when the order's PDF hash
//    matches what the parent approved at the Station-6 consent gate — that
//    gate is the contractual moment "I approved this content."
//  - `lost_transit` auto-approves a reprint when the order is past expected
//    delivery and no delivered transition exists.
//  - `defect` + `color_off` are ops-review (status `pending`) by default;
//    ops dashboard surfaces them. Photo evidence is required by spec.
//
// The handler does NOT execute the reprint or refund itself — it returns a
// decision; the caller composes ReprintCoordinator / Stripe refund per
// decision. Decoupling keeps the handler pure + replayable.

import type {
	Order,
	OrderStore,
	QualityClaim,
	QualityClaimCategory,
	QualityClaimDecision,
	QualityClaimStore,
} from './types';

export const CLAIM_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days post-delivery

export interface QualityHandlerOpts {
	orderStore: OrderStore;
	claimStore: QualityClaimStore;
	nowSource?: () => number;
	/** Override for testing — number of days past shipped before lost-transit auto-approves. */
	lostTransitDaysThreshold?: number;
}

export interface DecisionOutcome {
	decision: QualityClaimDecision;
	reason: string;
	shouldReprint: boolean;
	shouldRefund: boolean;
}

export class QualityGuaranteeHandler {
	private _orders: OrderStore;
	private _claims: QualityClaimStore;
	private _now: () => number;
	private _lostThresholdMs: number;

	constructor(opts: QualityHandlerOpts) {
		this._orders = opts.orderStore;
		this._claims = opts.claimStore;
		this._now = opts.nowSource ?? (() => Date.now());
		this._lostThresholdMs = (opts.lostTransitDaysThreshold ?? 30) * 24 * 60 * 60 * 1000;
	}

	/**
	 * Submit a new claim. Persists in `pending` then runs the decision
	 * function. Returns the claim with its decision applied.
	 */
	async submit(input: {
		id: string;
		orderId: string;
		category: QualityClaimCategory;
		photoUrls: string[];
		parentText: string;
	}): Promise<QualityClaim> {
		const claim: QualityClaim = {
			id: input.id,
			orderId: input.orderId,
			category: input.category,
			photoUrls: input.photoUrls,
			parentText: input.parentText,
			claimTs: this._now(),
			decision: 'pending',
		};
		await this._claims.put(claim);
		const outcome = await this.decide(claim);
		const decided: QualityClaim = {
			...claim,
			decision: outcome.decision,
			decisionReason: outcome.reason,
			decisionAt: this._now(),
		};
		await this._claims.put(decided);
		return decided;
	}

	/**
	 * Pure decision function — given a claim, return the decision outcome.
	 * Does not mutate stores. Callable for replay + cross-validation.
	 */
	async decide(claim: QualityClaim): Promise<DecisionOutcome> {
		const order = await this._orders.get(claim.orderId);
		if (!order) {
			return {
				decision: 'rejected',
				reason: 'order_not_found',
				shouldReprint: false,
				shouldRefund: false,
			};
		}

		// Window check (delivery-anchored when available; shipping-anchored fallback)
		const anchor =
			lastTransitionAt(order, 'delivered') ??
			lastTransitionAt(order, 'shipped') ??
			order.createdAt;
		if (this._now() - anchor > CLAIM_WINDOW_MS) {
			return {
				decision: 'rejected',
				reason: 'past_30_day_window',
				shouldReprint: false,
				shouldRefund: false,
			};
		}

		// Photo evidence required for defect categories per spec §5.7
		const needsPhotos: QualityClaimCategory[] = ['defect', 'color_off'];
		if (needsPhotos.includes(claim.category) && claim.photoUrls.length === 0) {
			return {
				decision: 'rejected',
				reason: 'missing_photo_evidence',
				shouldReprint: false,
				shouldRefund: false,
			};
		}

		switch (claim.category) {
			case 'wrong_content': {
				// The Station-6 consent gate captured a pdfHash — if the
				// claim's order pdfHash matches the consent record, the
				// parent contractually approved this content pre-charge.
				const consentHash = order.consentLog.pdfHash;
				if (consentHash && order.pdfHash && consentHash === order.pdfHash) {
					return {
						decision: 'rejected',
						reason: 'content_matches_parent_consent',
						shouldReprint: false,
						shouldRefund: false,
					};
				}
				// Otherwise (data drift / shouldn't happen) approve reprint
				return {
					decision: 'approved_reprint',
					reason: 'wrong_content_no_consent_match',
					shouldReprint: true,
					shouldRefund: false,
				};
			}
			case 'lost_transit': {
				const shippedAt = lastTransitionAt(order, 'shipped');
				const deliveredAt = lastTransitionAt(order, 'delivered');
				if (deliveredAt !== null) {
					return {
						decision: 'rejected',
						reason: 'order_already_delivered',
						shouldReprint: false,
						shouldRefund: false,
					};
				}
				if (shippedAt !== null && this._now() - shippedAt > this._lostThresholdMs) {
					return {
						decision: 'approved_reprint',
						reason: 'past_expected_delivery_no_delivered_event',
						shouldReprint: true,
						shouldRefund: false,
					};
				}
				return {
					decision: 'pending',
					reason: 'too_early_to_declare_lost',
					shouldReprint: false,
					shouldRefund: false,
				};
			}
			case 'defect':
			case 'color_off': {
				// Ops review path — spec §5.7 says parent picks reprint OR
				// refund, so we leave `pending` until ops triages.
				return {
					decision: 'pending',
					reason: 'awaiting_ops_review',
					shouldReprint: false,
					shouldRefund: false,
				};
			}
		}
	}

	async getClaim(id: string): Promise<QualityClaim | undefined> {
		return this._claims.get(id);
	}

	async listPending(): Promise<QualityClaim[]> {
		return this._claims.listPending();
	}
}

function lastTransitionAt(order: Order, to: Order['state']): number | null {
	for (let i = order.transitions.length - 1; i >= 0; i--) {
		if (order.transitions[i].to === to) return order.transitions[i].at;
	}
	return null;
}

// ---------------------------------------------------------------------------
// In-memory QualityClaimStore for browser + tests
// ---------------------------------------------------------------------------

export class InMemoryQualityClaimStore implements QualityClaimStore {
	private _map = new Map<string, QualityClaim>();

	async get(id: string): Promise<QualityClaim | undefined> {
		return this._map.get(id);
	}
	async put(claim: QualityClaim): Promise<void> {
		this._map.set(claim.id, { ...claim });
	}
	async listPending(): Promise<QualityClaim[]> {
		const out: QualityClaim[] = [];
		for (const c of this._map.values()) if (c.decision === 'pending') out.push(c);
		return out;
	}
}
