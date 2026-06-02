// @graph-layer: private
// @rationale: private (gift purchase records contain giver + recipient PII)
//
// src/routes/dashboard/services/storybook-workshop/subscription/GiftFlowService.ts
//
// Grandma's gift purchase flow (spec §6.4 / §8.4 + §8.5).
//
// Flow:
// 1. Grandma fills /gift form (recipient + cadence + format + length + start date + card).
// 2. Stripe checkout session created (recurring OR prepaid mode).
// 3. On success: Gift entity created, redeem code shared.
// 4. Recipient parent email "Grandma gifted Eli a 12-month series" + redeem link.
// 5. Recipient redeems → kid profile setup → links Gift to Subscription/Bundle.
// 6. `buildDedicationOverride(giftId)` emits card-from-giver for every book's dedication page.

import type {
	BundleLength,
	Cadence,
	CreateGiftOpts,
	Format,
	Gift,
	GiftDedicationOverride,
	GiftStatus,
	MailerProvider,
	PaymentProvider,
	Subscription,
} from './types';
import type { BundleService } from './BundleService';
import { bundleCentsFor } from './BundleService';
import type { SubscriptionService } from './SubscriptionService';
import { stripePriceIdFor } from './SubscriptionService';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface GiftFlowServiceOpts {
	payment: PaymentProvider;
	mailer: MailerProvider;
	subscriptions: SubscriptionService;
	bundles: BundleService;
	nowSource?: () => number;
	idGen?: () => string;
	redeemCodeGen?: () => string;
}

export class GiftFlowService {
	private _store = new Map<string, Gift>();
	/** Reverse-index for redeem code → giftId lookups. */
	private _byRedeemCode = new Map<string, string>();
	private _payment: PaymentProvider;
	private _mailer: MailerProvider;
	private _subs: SubscriptionService;
	private _bundles: BundleService;
	private _now: () => number;
	private _idGen: () => string;
	private _redeemCodeGen: () => string;

	constructor(opts: GiftFlowServiceOpts) {
		this._payment = opts.payment;
		this._mailer = opts.mailer;
		this._subs = opts.subscriptions;
		this._bundles = opts.bundles;
		this._now = opts.nowSource ?? (() => Date.now());
		this._idGen = opts.idGen ?? defaultIdGen;
		this._redeemCodeGen = opts.redeemCodeGen ?? defaultRedeemCodeGen;
	}

	/**
	 * Create a gift via Stripe checkout. Mode is determined by `bundleLength`:
	 * - `null` → recurring subscription gift.
	 * - `3|6|12|24` → prepaid bundle gift (lump sum charge).
	 */
	async createGift(opts: CreateGiftOpts): Promise<Gift> {
		validateEmail(opts.recipientParentEmail);
		validateEmail(opts.giverEmail);
		validateCardFromGiver(opts.cardFromGiver);

		const id = `gift_${this._idGen()}`;
		const redeemCode = this._uniqueRedeemCode();
		const now = this._now();

		// Build stripe checkout session
		const isBundle = opts.bundleLength !== null;
		const { stripeCheckoutId } = await this._payment.createGiftCheckoutSession({
			mode: isBundle ? 'payment' : 'subscription',
			amountCents: isBundle ? bundleCentsFor(opts.bundleLength as BundleLength) : undefined,
			priceId: isBundle ? undefined : stripePriceIdFor(opts.cadence, opts.format, 'recurring'),
			giverEmail: opts.giverEmail,
			metadata: {
				giftId: id,
				redeemCode,
				cadence: opts.cadence,
				format: opts.format,
				bundleLength: opts.bundleLength === null ? 'open' : String(opts.bundleLength),
			},
		});

		const gift: Gift = {
			id,
			recipientParentEmail: opts.recipientParentEmail,
			recipientName: opts.recipientName,
			cadence: opts.cadence,
			format: opts.format,
			bundleLength: opts.bundleLength,
			startDate: opts.startDate,
			cardFromGiver: opts.cardFromGiver,
			giverName: opts.giverName,
			giverEmail: opts.giverEmail,
			stripeCheckoutId,
			redeemCode,
			createdAt: now,
			status: 'pending_redeem',
		};
		this._store.set(id, gift);
		this._byRedeemCode.set(redeemCode, id);

		// Fire-and-forget transactional emails
		await this._mailer.send({
			to: opts.giverEmail,
			kind: 'gift_purchase_giver_receipt',
			variables: {
				giverName: opts.giverName,
				recipientName: opts.recipientName,
				redeemCode,
				lengthLabel: opts.bundleLength === null ? 'open-ended subscription' : `${opts.bundleLength}-book bundle`,
			},
		});
		await this._mailer.send({
			to: opts.recipientParentEmail,
			kind: 'gift_purchase_recipient_invite',
			variables: {
				giverName: opts.giverName,
				recipientName: opts.recipientName,
				redeemCode,
				cadence: opts.cadence,
				format: opts.format,
			},
		});

		return gift;
	}

	get(id: string): Gift | undefined {
		return this._store.get(id);
	}

	getByRedeemCode(code: string): Gift | undefined {
		const id = this._byRedeemCode.get(code);
		return id ? this._store.get(id) : undefined;
	}

	/**
	 * Recipient parent claims the gift by entering the redeem code.
	 * - For a recurring gift: creates Subscription bound to gift's
	 *   recipientParentEmail / kidId (kidId still pending until parent sets up).
	 * - For a prepaid bundle gift: creates Bundle.
	 *
	 * Returns the resulting subscription or bundle id.
	 */
	async redeem(opts: { redeemCode: string; kidId?: string }): Promise<{
		giftId: string;
		subscriptionId?: string;
		bundleId?: string;
	}> {
		const gift = this.getByRedeemCode(opts.redeemCode);
		if (!gift) throw new Error(`GiftFlowService: invalid redeem code`);
		if (gift.status !== 'pending_redeem') {
			throw new Error(`GiftFlowService: gift ${gift.id} status=${gift.status}`);
		}

		const isBundle = gift.bundleLength !== null;
		let subscriptionId: string | undefined;
		let bundleId: string | undefined;

		if (isBundle) {
			const bundle = await this._bundles.create({
				recipientParentEmail: gift.recipientParentEmail,
				cadence: gift.cadence,
				format: gift.format,
				bookCount: gift.bundleLength as BundleLength,
				giverEmail: gift.giverEmail,
				startAt: gift.startDate,
			});
			bundleId = bundle.id;
			gift.bundleId = bundleId;
		} else {
			const sub: Subscription = await this._subs.create({
				recipientParentEmail: gift.recipientParentEmail,
				kidId: opts.kidId,
				cadence: gift.cadence,
				format: gift.format,
				billingMode: 'recurring',
				autopilotEnabled: true,
				giverEmail: gift.giverEmail,
				startAt: gift.startDate,
			});
			subscriptionId = sub.id;
			gift.subscriptionId = subscriptionId;
		}

		gift.status = 'redeemed';
		gift.redeemedAt = this._now();
		return { giftId: gift.id, subscriptionId, bundleId };
	}

	/**
	 * Build the dedication-page override for a gift. The workshop authoring
	 * pipeline composites this into every book's dedication page.
	 *
	 * Cross-call: BookAssembler.dedicationPagePng is rendered by the
	 * workshop's S5 station; this method only emits the structured
	 * override — the actual PNG composition happens upstream.
	 */
	buildDedicationOverride(giftId: string): GiftDedicationOverride | undefined {
		const gift = this._store.get(giftId);
		if (!gift) return undefined;
		return {
			giftId: gift.id,
			cardFromGiver: gift.cardFromGiver,
			giverName: gift.giverName,
			recipientName: gift.recipientName,
		};
	}

	/** Mark a gift cancelled (pre-redeem). */
	cancel(id: string): Gift {
		const gift = this._store.get(id);
		if (!gift) throw new Error(`GiftFlowService: unknown gift ${id}`);
		gift.status = 'cancelled';
		return gift;
	}

	__testInsert(g: Gift): void {
		this._store.set(g.id, g);
		this._byRedeemCode.set(g.redeemCode, g.id);
	}

	private _uniqueRedeemCode(): string {
		// Bounded retry on collision — collisions vanishingly improbable but defended.
		for (let i = 0; i < 100; i++) {
			const code = this._redeemCodeGen();
			if (!this._byRedeemCode.has(code)) return code;
		}
		throw new Error(`GiftFlowService: failed to mint unique redeem code after 100 tries`);
	}

	snapshot(): {
		count: number;
		statuses: Record<GiftStatus, number>;
	} {
		const statuses: Record<GiftStatus, number> = {
			pending_redeem: 0,
			redeemed: 0,
			expired: 0,
			cancelled: 0,
		};
		for (const g of this._store.values()) statuses[g.status] += 1;
		return { count: this._store.size, statuses };
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateEmail(email: string): void {
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error(`GiftFlowService: invalid email "${email}"`);
	}
}

function validateCardFromGiver(card: string): void {
	if (typeof card !== 'string') {
		throw new Error(`GiftFlowService: card must be a string`);
	}
	// Soft cap: card-from-giver fits on a dedication page line block.
	if (card.length > 500) {
		throw new Error(`GiftFlowService: card text exceeds 500 chars (got ${card.length})`);
	}
}

let _idCounter = 0;
function defaultIdGen(): string {
	_idCounter += 1;
	return `${Date.now().toString(36)}_${_idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
function defaultRedeemCodeGen(): string {
	// 10-char alphanumeric — ~50 bits of entropy
	let out = '';
	for (let i = 0; i < 10; i++) {
		out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	}
	return out;
}
