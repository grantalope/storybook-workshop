// @graph-layer: private
// @rationale: private (per-user / per-recipient subscription state — billing PII tier)
//
// src/routes/dashboard/services/storybook-workshop/subscription/SubscriptionService.ts
//
// Subscription lifecycle: create / skip-a-month / cancel for recurring +
// prepaid subscriptions. Stripe sub creation delegated to PaymentProvider
// (real adapter lands via fulfillment goal cross-wire).
//
// Spec §6.4 pricing tiers + cadence + skip-a-month + cancel-anytime.

import type {
	BillingMode,
	Cadence,
	CreateSubscriptionOpts,
	Format,
	PaymentProvider,
	PriceCents,
	StripePriceRef,
	Subscription,
	SubscriptionStatus,
} from './types';

// ---------------------------------------------------------------------------
// Pricing catalog (spec §6.4)
// ---------------------------------------------------------------------------

/**
 * Per-month pre-tax cents for every (cadence, format) cell of the spec table.
 *
 * Frozen — these are the launch prices. Changes require an ops migration
 * (new Stripe Price IDs); never mutate this constant in code.
 */
export const PRICING_CATALOG: readonly PriceCents[] = Object.freeze([
	// Quarterly
	{ cadence: 'quarterly', format: 'hardcover', monthlyCents: 1399 },
	{ cadence: 'quarterly', format: 'softcover', monthlyCents: 999 },
	{ cadence: 'quarterly', format: 'bedtime', monthlyCents: 799 },
	// Monthly (flagship)
	{ cadence: 'monthly', format: 'hardcover', monthlyCents: 2999 },
	{ cadence: 'monthly', format: 'softcover', monthlyCents: 1999 },
	{ cadence: 'monthly', format: 'bedtime', monthlyCents: 1499 },
	// Bi-weekly
	{ cadence: 'biweekly', format: 'hardcover', monthlyCents: 5499 },
	{ cadence: 'biweekly', format: 'softcover', monthlyCents: 3699 },
	{ cadence: 'biweekly', format: 'bedtime', monthlyCents: 2699 },
	// Weekly
	{ cadence: 'weekly', format: 'hardcover', monthlyCents: 9999 },
	{ cadence: 'weekly', format: 'softcover', monthlyCents: 6999 },
	{ cadence: 'weekly', format: 'bedtime', monthlyCents: 4999 },
]);

/**
 * Stripe Price IDs are configured in the ops runbook; this is the
 * deterministic-fake-id catalog the mock provider keys off. Production
 * adapter swaps to real `price_…` IDs.
 */
export const STRIPE_PRICE_CATALOG: readonly StripePriceRef[] = Object.freeze(
	PRICING_CATALOG.flatMap((p) => [
		{
			cadence: p.cadence,
			format: p.format,
			billingMode: 'recurring' as BillingMode,
			priceId: `price_${p.cadence}_${p.format}_recurring`,
		},
	])
);

/** Look up monthly cents for (cadence, format). Throws on miss. */
export function priceCentsFor(cadence: Cadence, format: Format): number {
	const row = PRICING_CATALOG.find((p) => p.cadence === cadence && p.format === format);
	if (!row) throw new Error(`SubscriptionService: no pricing for ${cadence}/${format}`);
	return row.monthlyCents;
}

/** Look up Stripe Price ID for (cadence, format, billingMode). */
export function stripePriceIdFor(
	cadence: Cadence,
	format: Format,
	billingMode: BillingMode
): string {
	const row = STRIPE_PRICE_CATALOG.find(
		(p) => p.cadence === cadence && p.format === format && p.billingMode === billingMode
	);
	if (!row) {
		throw new Error(
			`SubscriptionService: no Stripe price for ${cadence}/${format}/${billingMode}`
		);
	}
	return row.priceId;
}

// ---------------------------------------------------------------------------
// Cadence → interval days
// ---------------------------------------------------------------------------

/** Calendar days between deliveries for each cadence. */
const CADENCE_INTERVAL_DAYS: Record<Cadence, number> = Object.freeze({
	weekly: 7,
	biweekly: 14,
	monthly: 30,
	quarterly: 90,
});

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Add one cadence-interval to a timestamp. */
export function nextCadenceAt(ts: number, cadence: Cadence): number {
	return ts + CADENCE_INTERVAL_DAYS[cadence] * MS_PER_DAY;
}

/** Max consecutive skips before a subscription requires explicit cancel. */
export const MAX_CONSECUTIVE_SKIPS = 3;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SubscriptionServiceOpts {
	payment: PaymentProvider;
	nowSource?: () => number;
	/** Deterministic id generator for tests. Default: random. */
	idGen?: () => string;
}

export class SubscriptionService {
	private _store = new Map<string, Subscription>();
	private _payment: PaymentProvider;
	private _now: () => number;
	private _idGen: () => string;

	constructor(opts: SubscriptionServiceOpts) {
		this._payment = opts.payment;
		this._now = opts.nowSource ?? (() => Date.now());
		this._idGen = opts.idGen ?? defaultIdGen;
	}

	/**
	 * Create a recurring or prepaid subscription. For prepaid bundles the
	 * caller should use `BundleService` directly — this method only creates
	 * a subscription envelope; the bundle binding (if any) is set by the
	 * caller via the bundle service.
	 */
	async create(opts: CreateSubscriptionOpts): Promise<Subscription> {
		validateEmail(opts.recipientParentEmail);
		const id = `sub_${this._idGen()}`;
		const now = this._now();
		const startAt = opts.startAt ?? now;
		const sub: Subscription = {
			id,
			recipientParentEmail: opts.recipientParentEmail,
			kidId: opts.kidId,
			cadence: opts.cadence,
			format: opts.format,
			status: 'active',
			billingMode: opts.billingMode,
			startedAt: startAt,
			nextBookAt: startAt,
			giverEmail: opts.giverEmail,
			autopilotEnabled: opts.autopilotEnabled ?? true,
			seriesThemeId: opts.seriesThemeId,
			booksDelivered: 0,
			consecutiveSkips: 0,
			activeDraftIds: [],
		};
		if (opts.billingMode === 'recurring') {
			const priceId = stripePriceIdFor(opts.cadence, opts.format, 'recurring');
			const { stripeSubscriptionId } = await this._payment.createSubscription({
				priceId,
				customerEmail: opts.recipientParentEmail,
				metadata: {
					subscriptionId: id,
					cadence: opts.cadence,
					format: opts.format,
				},
			});
			sub.stripeSubscriptionId = stripeSubscriptionId;
		}
		this._store.set(id, sub);
		return sub;
	}

	/** Get by id; undefined when not found. */
	get(id: string): Subscription | undefined {
		return this._store.get(id);
	}

	/** List by recipient parent email. */
	listByRecipient(email: string): Subscription[] {
		const out: Subscription[] = [];
		for (const sub of this._store.values()) {
			if (sub.recipientParentEmail === email) out.push(sub);
		}
		return out;
	}

	/**
	 * Skip-a-month: mark current scheduled book as skipped + move nextBookAt
	 * forward one cadence interval. No refund (per spec §6.4).
	 *
	 * Capped at MAX_CONSECUTIVE_SKIPS consecutive — beyond that, parent must
	 * cancel or unpause (deliver next book) explicitly.
	 */
	skip(id: string): Subscription {
		const sub = this._requireActive(id);
		if (sub.consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
			throw new Error(
				`SubscriptionService: subscription ${id} at MAX_CONSECUTIVE_SKIPS (${MAX_CONSECUTIVE_SKIPS}); cancel or unpause first.`
			);
		}
		sub.nextBookAt = nextCadenceAt(sub.nextBookAt, sub.cadence);
		sub.consecutiveSkips += 1;
		return sub;
	}

	/**
	 * Cancel: mark cancelled, books-to-date stay with kid. For recurring,
	 * also cancels the Stripe subscription. No prepay refund (spec §6.5).
	 */
	async cancel(id: string): Promise<Subscription> {
		const sub = this._requireActive(id);
		sub.status = 'cancelled';
		if (sub.billingMode === 'recurring' && sub.stripeSubscriptionId) {
			await this._payment.cancelSubscription(sub.stripeSubscriptionId);
		}
		return sub;
	}

	/**
	 * Mark a book delivered. Increments `booksDelivered`, resets
	 * `consecutiveSkips` (skip counter only counts *consecutive* skips), and
	 * advances `nextBookAt` by one cadence interval.
	 */
	markBookDelivered(id: string): Subscription {
		const sub = this._requireActive(id);
		sub.booksDelivered += 1;
		sub.consecutiveSkips = 0;
		sub.nextBookAt = nextCadenceAt(sub.nextBookAt, sub.cadence);
		return sub;
	}

	/** Bind a prepaid bundle to this subscription. */
	bindPrepaidBundle(id: string, bundleId: string): Subscription {
		const sub = this._requireActive(id);
		if (sub.billingMode !== 'prepaid_bundle') {
			throw new Error(
				`SubscriptionService: cannot bind bundle to recurring subscription ${id}`
			);
		}
		sub.prepaidBundleId = bundleId;
		return sub;
	}

	/** Pause (e.g. parent requested temporary hold). */
	pause(id: string): Subscription {
		const sub = this._requireActive(id);
		sub.status = 'paused';
		return sub;
	}

	/** Resume from pause. */
	resume(id: string): Subscription {
		const sub = this._store.get(id);
		if (!sub) throw new Error(`SubscriptionService: unknown subscription ${id}`);
		if (sub.status !== 'paused') {
			throw new Error(`SubscriptionService: subscription ${id} is not paused (status=${sub.status})`);
		}
		sub.status = 'active';
		return sub;
	}

	/**
	 * Internal helper — throws when sub isn't found or isn't active.
	 * `paused` is NOT active for the purposes of mutating ops (skip / deliver).
	 */
	private _requireActive(id: string): Subscription {
		const sub = this._store.get(id);
		if (!sub) throw new Error(`SubscriptionService: unknown subscription ${id}`);
		if (sub.status !== 'active') {
			throw new Error(`SubscriptionService: subscription ${id} status=${sub.status}`);
		}
		return sub;
	}

	/** Test helper — register an externally-built subscription. */
	__testInsert(sub: Subscription): void {
		this._store.set(sub.id, sub);
	}

	/** Snapshot for /debug surfaces. */
	snapshot(): { count: number; statuses: Record<SubscriptionStatus, number> } {
		const statuses: Record<SubscriptionStatus, number> = {
			active: 0,
			paused: 0,
			cancelled: 0,
			expired: 0,
		};
		for (const sub of this._store.values()) statuses[sub.status] += 1;
		return { count: this._store.size, statuses };
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateEmail(email: string): void {
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error(`SubscriptionService: invalid email "${email}"`);
	}
}

let _idCounter = 0;
function defaultIdGen(): string {
	_idCounter += 1;
	const random = Math.random().toString(36).slice(2, 8);
	return `${Date.now().toString(36)}_${_idCounter}_${random}`;
}
