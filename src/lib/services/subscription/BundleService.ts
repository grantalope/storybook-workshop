// @graph-layer: private
// @rationale: private (per-recipient prepaid bundle ledger — billing PII tier)
//
// src/routes/dashboard/services/storybook-workshop/subscription/BundleService.ts
//
// One-time prepaid 3/6/12/24-book bundles. Spec §6.4 pricing:
//   3-book  : $79.99
//   6-book  : $149.99
//   12-book : $279.99 (~22% discount)
//   24-book : $559.98 (linear extension of 12 × 2 — same per-book cost)
//
// On purchase: single Stripe charge + create Bundle + materialize N
// pre-scheduled delivery slots so AutopilotDrafter picks them up.

import type {
	Bundle,
	BundleLength,
	BundlePriceCents,
	BundleStatus,
	Cadence,
	CreateBundleOpts,
	Format,
	PaymentProvider,
} from './types';
import { MS_PER_DAY, nextCadenceAt } from './SubscriptionService';

// ---------------------------------------------------------------------------
// Pricing (spec §6.4)
// ---------------------------------------------------------------------------

/** Frozen one-time prepaid bundle pricing. */
export const BUNDLE_PRICES: readonly BundlePriceCents[] = Object.freeze([
	{ bookCount: 3, prepaidCents: 7999 },
	{ bookCount: 6, prepaidCents: 14999 },
	{ bookCount: 12, prepaidCents: 27999 },
	{ bookCount: 24, prepaidCents: 55998 },
]);

/** Lookup cents for a bundle length. */
export function bundleCentsFor(bookCount: BundleLength): number {
	const row = BUNDLE_PRICES.find((b) => b.bookCount === bookCount);
	if (!row) throw new Error(`BundleService: no pricing for bookCount=${bookCount}`);
	return row.prepaidCents;
}

/** Compute scheduled delivery timestamps for a bundle (N slots, one per cadence interval). */
export function materializeSlots(startAt: number, bookCount: number, cadence: Cadence): number[] {
	const slots: number[] = [];
	let t = startAt;
	for (let i = 0; i < bookCount; i++) {
		slots.push(t);
		t = nextCadenceAt(t, cadence);
	}
	return slots;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface BundleServiceOpts {
	payment: PaymentProvider;
	nowSource?: () => number;
	idGen?: () => string;
}

export class BundleService {
	private _store = new Map<string, Bundle>();
	private _payment: PaymentProvider;
	private _now: () => number;
	private _idGen: () => string;

	constructor(opts: BundleServiceOpts) {
		this._payment = opts.payment;
		this._now = opts.nowSource ?? (() => Date.now());
		this._idGen = opts.idGen ?? defaultIdGen;
	}

	/**
	 * Create a bundle: one-time Stripe charge, then materialize N delivery
	 * slots on the cadence interval. No auto-renew.
	 */
	async create(opts: CreateBundleOpts): Promise<Bundle> {
		validateEmail(opts.recipientParentEmail);
		const prepaidCents = bundleCentsFor(opts.bookCount);
		const id = `bundle_${this._idGen()}`;
		const now = this._now();
		const startAt = opts.startAt ?? now;

		const { stripePaymentIntentId } = await this._payment.createOneTimeCharge({
			amountCents: prepaidCents,
			customerEmail: opts.recipientParentEmail,
			metadata: {
				bundleId: id,
				bookCount: String(opts.bookCount),
				cadence: opts.cadence,
				format: opts.format,
			},
		});

		const bundle: Bundle = {
			id,
			recipientParentEmail: opts.recipientParentEmail,
			cadence: opts.cadence,
			format: opts.format,
			bookCount: opts.bookCount,
			prepaidCents,
			stripePaymentIntentId,
			status: 'active',
			giverEmail: opts.giverEmail,
			createdAt: now,
			consumed: 0,
			scheduledSlots: materializeSlots(startAt, opts.bookCount, opts.cadence),
		};
		this._store.set(id, bundle);
		return bundle;
	}

	get(id: string): Bundle | undefined {
		return this._store.get(id);
	}

	listByRecipient(email: string): Bundle[] {
		const out: Bundle[] = [];
		for (const b of this._store.values()) {
			if (b.recipientParentEmail === email) out.push(b);
		}
		return out;
	}

	/** Mark one slot consumed. When `consumed === bookCount`, status flips to 'exhausted'. */
	consumeOneSlot(id: string): Bundle {
		const bundle = this._store.get(id);
		if (!bundle) throw new Error(`BundleService: unknown bundle ${id}`);
		if (bundle.status !== 'active') {
			throw new Error(`BundleService: bundle ${id} status=${bundle.status}`);
		}
		bundle.consumed += 1;
		if (bundle.consumed >= bundle.bookCount) {
			bundle.status = 'exhausted';
		}
		return bundle;
	}

	/** Cancel bundle pre-redemption (gift-flow not-yet-claimed path). */
	cancel(id: string): Bundle {
		const bundle = this._store.get(id);
		if (!bundle) throw new Error(`BundleService: unknown bundle ${id}`);
		bundle.status = 'cancelled';
		return bundle;
	}

	__testInsert(b: Bundle): void {
		this._store.set(b.id, b);
	}

	snapshot(): { count: number; statuses: Record<BundleStatus, number>; totalCentsCollected: number } {
		const statuses: Record<BundleStatus, number> = {
			active: 0,
			exhausted: 0,
			cancelled: 0,
			pending_redeem: 0,
		};
		let totalCentsCollected = 0;
		for (const b of this._store.values()) {
			statuses[b.status] += 1;
			if (b.status === 'active' || b.status === 'exhausted') {
				totalCentsCollected += b.prepaidCents;
			}
		}
		return { count: this._store.size, statuses, totalCentsCollected };
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateEmail(email: string): void {
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error(`BundleService: invalid email "${email}"`);
	}
}

let _idCounter = 0;
function defaultIdGen(): string {
	_idCounter += 1;
	return `${Date.now().toString(36)}_${_idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}
