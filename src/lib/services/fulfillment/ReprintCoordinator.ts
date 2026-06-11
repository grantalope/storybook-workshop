// @graph-layer: private
// @rationale: private (reprint coordinator wires reissue back into the lifecycle)
//
// src/lib/services/fulfillment/ReprintCoordinator.ts
//
// Reprint flow: when an approved-reprint quality claim fires (or ops manually
// requests a reissue), this coordinator:
//   1. Calls Lulu's reissue endpoint to mint a new print-job.
//   2. Creates a new Order in `paid` state linked to the original by
//      `reissueOfOrderId` (and back-links the original via `reissueOrderId`).
//   3. Persists both records.
//   4. The new order then proceeds through the normal lifecycle starting at
//      `paid` -> `submitted_to_lulu` (because Lulu already accepted the
//      reissue).
//
// Cost: per spec §5.5, the reprint cost is absorbed by the ~2% reprint
// reserve baked into the original unit price. We don't bill the parent for
// the reissue. Tracking the reserve-vs-actual is left for an ops dashboard.

import type {
	Order,
	OrderStore,
} from './types';
import type { LuluFulfillmentService } from './LuluFulfillmentService';
import type { OrderLifecycleService } from './OrderLifecycleService';
import { secureRandomString } from '$lib/services/subscription/secureRandom';

export interface ReprintCoordinatorOpts {
	lulu: LuluFulfillmentService;
	lifecycle: OrderLifecycleService;
	store: OrderStore;
	nowSource?: () => number;
	idGen?: () => string;
}

export interface ReprintResult {
	originalOrderId: string;
	reissueOrderId: string;
	luluJobId: string;
}

const REISSUE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function defaultIdGen(): string {
	return `reissue_${secureRandomString(10, REISSUE_ID_ALPHABET)}`;
}

export class ReprintCoordinator {
	private _lulu: LuluFulfillmentService;
	private _lifecycle: OrderLifecycleService;
	private _store: OrderStore;
	private _now: () => number;
	private _idGen: () => string;

	constructor(opts: ReprintCoordinatorOpts) {
		this._lulu = opts.lulu;
		this._lifecycle = opts.lifecycle;
		this._store = opts.store;
		this._now = opts.nowSource ?? (() => Date.now());
		this._idGen = opts.idGen ?? defaultIdGen;
	}

	/**
	 * Issue a reprint for `orderId`. The original must have a luluJobId
	 * (i.e. it actually went to Lulu). Throws otherwise.
	 */
	async reprint(orderId: string, reason: string): Promise<ReprintResult> {
		const original = await this._store.get(orderId);
		if (!original) throw new Error(`ReprintCoordinator: order ${orderId} not found`);
		if (!original.luluJobId) {
			throw new Error('ReprintCoordinator: original has no luluJobId (never submitted)');
		}
		if (original.reissueOrderId) {
			throw new Error(
				`ReprintCoordinator: order ${orderId} already reissued as ${original.reissueOrderId}`,
			);
		}

		const luluResp = await this._lulu.reissuePrintJob(original.luluJobId, reason);

		const newId = `ord_${this._idGen()}`;
		const now = this._now();
		const reissue: Order = {
			...original,
			id: newId,
			stripePaymentIntentId: undefined,
			luluJobId: luluResp.id,
			state: 'paid',
			transitions: [
				{
					from: null,
					to: 'pending_payment',
					at: now,
					actor: 'system',
					reason: 'reissue_envelope_created',
					meta: { originalOrderId: orderId },
				},
				{
					from: 'pending_payment',
					to: 'paid',
					at: now,
					actor: 'system',
					reason: 'reissue_no_parent_charge',
				},
				{
					from: 'paid',
					to: 'submitted_to_lulu',
					at: now,
					actor: 'system',
					reason: 'lulu_reissue_accepted',
					meta: { luluJobId: luluResp.id },
				},
			],
			createdAt: now,
			updatedAt: now,
			reissueOfOrderId: orderId,
			reissueOrderId: undefined,
			trackingUrl: undefined,
		};
		// Reissue jumps straight to submitted_to_lulu (Lulu already accepted).
		reissue.state = 'submitted_to_lulu';

		// Back-link the original
		const updatedOriginal: Order = {
			...original,
			reissueOrderId: newId,
			updatedAt: now,
		};

		await this._store.put(updatedOriginal);
		await this._store.put(reissue);

		// Fire onSubmitted handler for the reissue so downstream side-effects
		// (e.g. ops alert, email "your reprint is in progress") run.
		await this._lifecycle._fireHandler('submitted_to_lulu', reissue);

		return {
			originalOrderId: orderId,
			reissueOrderId: newId,
			luluJobId: luluResp.id,
		};
	}
}
