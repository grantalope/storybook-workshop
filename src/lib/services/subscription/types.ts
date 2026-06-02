// @graph-layer: private
// @rationale: private (per-user / per-recipient subscription state — billing PII tier)
//
// src/routes/dashboard/services/storybook-workshop/subscription/types.ts
//
// Canonical type surface for the Storybook Workshop subscription engine
// (Wave 2 / Goal #9). Subscription / Bundle / Gift / SeriesTheme + the
// supporting Cadence / Format / Pricing types.
//
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §6.4
// Goal: docs/superpowers/goals/2026-05-24-storybook-workshop-subscription-engine.md

// ---------------------------------------------------------------------------
// Cadence + format
// ---------------------------------------------------------------------------

/** Subscription cadence per spec §6.4 (4 tiers). */
export type Cadence = 'quarterly' | 'monthly' | 'biweekly' | 'weekly';

/** Print/digital format per spec §6.4 pricing table. */
export type Format = 'hardcover' | 'softcover' | 'bedtime';

/** Status machine for an active recurring or prepaid subscription. */
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'expired';

/**
 * Billing mode:
 * - `recurring`: stripe `Subscription` charges parent every cadence interval.
 * - `prepaid_bundle`: one-time lump charge, fixed N books across cadence.
 */
export type BillingMode = 'recurring' | 'prepaid_bundle';

/** Bundle size — pre-priced + tested (24 is linear-extended in MVP). */
export type BundleLength = 3 | 6 | 12 | 24;

// ---------------------------------------------------------------------------
// Pricing (per spec §6.4, monthly cents)
// ---------------------------------------------------------------------------

/** Pre-tax per-month cents for a (cadence, format) combo. */
export interface PriceCents {
	cadence: Cadence;
	format: Format;
	monthlyCents: number;
}

/** Frozen Stripe Price ID reference. Real IDs assigned in ops runbook. */
export interface StripePriceRef {
	cadence: Cadence;
	format: Format;
	billingMode: BillingMode;
	priceId: string;
}

/** Bundle pricing per spec §6.4 (one-time charge). */
export interface BundlePriceCents {
	bookCount: BundleLength;
	prepaidCents: number;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export interface Subscription {
	id: string;
	recipientParentEmail: string;
	kidId?: string;
	cadence: Cadence;
	format: Format;
	status: SubscriptionStatus;
	billingMode: BillingMode;
	/** Set when billingMode === 'recurring'. */
	stripeSubscriptionId?: string;
	/** Set when billingMode === 'prepaid_bundle'. */
	prepaidBundleId?: string;
	startedAt: number;
	/** Wall-clock ms of the next scheduled book delivery. */
	nextBookAt: number;
	/** Optional grandma gift attribution. */
	giverEmail?: string;
	/** Whether the autopilot lane is enabled for this sub. Defaults to true for series subscriptions. */
	autopilotEnabled: boolean;
	/** Optional themed-series binding. When set, autopilot pulls themes from `SeriesThemeRegistry`. */
	seriesThemeId?: string;
	/** Books produced so far. Increments on each `markBookDelivered()`. */
	booksDelivered: number;
	/** Consecutive skip-a-month count. Capped at 3 (spec §6.4 — soft cap to prevent indefinite pause). */
	consecutiveSkips: number;
	/** Optional active autopilot draft IDs (for weekly batch — array; for other cadences — length 0 or 1). */
	activeDraftIds: string[];
}

export interface CreateSubscriptionOpts {
	recipientParentEmail: string;
	kidId?: string;
	cadence: Cadence;
	format: Format;
	billingMode: BillingMode;
	autopilotEnabled?: boolean;
	seriesThemeId?: string;
	giverEmail?: string;
	startAt?: number;
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

export type BundleStatus = 'active' | 'exhausted' | 'cancelled' | 'pending_redeem';

export interface Bundle {
	id: string;
	recipientParentEmail: string;
	format: Format;
	cadence: Cadence;
	bookCount: BundleLength;
	prepaidCents: number;
	stripePaymentIntentId: string;
	status: BundleStatus;
	giverEmail?: string;
	createdAt: number;
	/** Number of books drawn from the bundle so far. */
	consumed: number;
	/** Pre-scheduled delivery slots (absolute ms timestamps). Length === bookCount. */
	scheduledSlots: number[];
}

export interface CreateBundleOpts {
	recipientParentEmail: string;
	cadence: Cadence;
	format: Format;
	bookCount: BundleLength;
	giverEmail?: string;
	startAt?: number;
}

// ---------------------------------------------------------------------------
// Gift
// ---------------------------------------------------------------------------

export type GiftStatus = 'pending_redeem' | 'redeemed' | 'expired' | 'cancelled';

export interface Gift {
	id: string;
	/** Recipient parent's email — that's who claims the gift via redeem code. */
	recipientParentEmail: string;
	recipientName: string;
	cadence: Cadence;
	format: Format;
	/** Null when gift is a recurring sub (no fixed length). */
	bundleLength: BundleLength | null;
	startDate: number;
	/** Free-text card from giver, appears on each book's dedication page. */
	cardFromGiver: string;
	giverName: string;
	giverEmail: string;
	stripeCheckoutId: string;
	/** Single-use redeem code shared with the recipient parent. */
	redeemCode: string;
	createdAt: number;
	redeemedAt?: number;
	/** Once redeemed, the subscription/bundle this gift instantiated. */
	subscriptionId?: string;
	bundleId?: string;
	status: GiftStatus;
}

export interface CreateGiftOpts {
	recipientParentEmail: string;
	recipientName: string;
	cadence: Cadence;
	format: Format;
	bundleLength: BundleLength | null;
	startDate: number;
	cardFromGiver: string;
	giverName: string;
	giverEmail: string;
}

/**
 * What `GiftFlowService.buildDedicationOverride(giftId)` emits for the
 * book-assembler pipeline. Workshop authoring composites this into the
 * dedication page underneath the parent's own dedication line.
 */
export interface GiftDedicationOverride {
	giftId: string;
	cardFromGiver: string;
	giverName: string;
	recipientName: string;
}

// ---------------------------------------------------------------------------
// SeriesTheme (named autopilot series)
// ---------------------------------------------------------------------------

/**
 * Opaque themed-content id. The author / theme catalog provides
 * the mapping to actual `themeId` / `occasion` strings.
 */
export type ThemeId = string;

export interface SeriesTheme {
	id: string;
	name: string;
	description: string;
	/** Exactly 12 themed content slots, in cadence order. */
	themes: ThemeId[];
}

// ---------------------------------------------------------------------------
// Autopilot draft
// ---------------------------------------------------------------------------

export type AutopilotDraftStatus =
	| 'pending_approval'
	| 'approved'
	| 'redo_requested'
	| 'theme_swapped'
	| 'defaulted'
	| 'shipped';

export interface AutopilotDraft {
	id: string;
	subscriptionId: string;
	themeId: ThemeId;
	/** When the draft was created (workshop auto-author returned). */
	draftedAt: number;
	/** Wall-clock ms — past this, draft transitions to 'defaulted' without shipping. */
	approvalDeadline: number;
	status: AutopilotDraftStatus;
	approvedAt?: number;
	defaultedAt?: number;
	/** Stub: workshop's preview-link shortcode. */
	previewShortcode: string;
}

export interface AutopilotApproveOpts {
	subscriptionId: string;
	draftId: string;
	action: 'approve' | 'redo' | 'swap_theme';
	/** When action='swap_theme', the replacement themeId. */
	newThemeId?: ThemeId;
}

// ---------------------------------------------------------------------------
// Birthday cron
// ---------------------------------------------------------------------------

export interface KidBirthdayProfile {
	kidId: string;
	parentEmail: string;
	/** Optional registered grandparent receiver. */
	grandparentEmail?: string;
	birthdayMonth: number; // 1..12
	birthdayDay: number; // 1..31
	kidName: string;
	/** Has the parent opted-in to birthday-cron emails? */
	optedIn: boolean;
}

export interface BirthdayCronTickResult {
	processed: number;
	emailsSent: number;
	skippedAsIdempotent: number;
	notOptedIn: number;
}

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------

export interface ReferralClick {
	shortcode: string;
	clickedAt: number;
}

export interface ReferralConversion {
	shortcode: string;
	convertedAt: number;
	/** Stripe/payment identity of the resulting purchase. */
	paymentId: string;
	/** Cents value of the purchase — drives credit calc if needed. */
	purchaseCents: number;
	/** Was this a gift purchase by a grandparent? */
	isGiftPurchase: boolean;
}

export interface ReferralCredit {
	shortcode: string;
	originatingParentEmail: string;
	creditCents: number;
	awardedAt: number;
	paymentId: string;
}

// ---------------------------------------------------------------------------
// Payment provider (typed cross-dep — fulfillment owns real impl)
// ---------------------------------------------------------------------------

/**
 * Minimal Stripe provider surface used by subscription + bundle + gift services.
 *
 * The fulfillment sibling worktree (`feat/storybook-workshop-fulfillment`)
 * owns the real Stripe SDK adapter. Production constructor wiring will swap
 * the mock in tests for the real impl. Cross-dep methods documented:
 *
 * - `createSubscription({priceId, customerEmail, metadata})` → Stripe sub id.
 * - `cancelSubscription(stripeSubscriptionId)` → cancel at period end.
 * - `createOneTimeCharge({amountCents, customerEmail, metadata})` → PaymentIntent id.
 * - `createGiftCheckoutSession({mode, ...})` → checkout session id (for grandma's flow).
 * - `validatePromo(promoCode)` → typed by fulfillment goal; stubbed type-only here.
 * - `refund(paymentIntentId, amountCents?)` → typed by fulfillment goal; stubbed type-only.
 *
 * The mock provider in tests returns deterministic fake IDs; production
 * binding is a 1-line swap.
 */
export interface PaymentProvider {
	createSubscription(opts: {
		priceId: string;
		customerEmail: string;
		metadata?: Record<string, string>;
	}): Promise<{ stripeSubscriptionId: string }>;
	cancelSubscription(stripeSubscriptionId: string): Promise<void>;
	createOneTimeCharge(opts: {
		amountCents: number;
		customerEmail: string;
		metadata?: Record<string, string>;
	}): Promise<{ stripePaymentIntentId: string }>;
	createGiftCheckoutSession(opts: {
		mode: 'subscription' | 'payment';
		amountCents?: number;
		priceId?: string;
		giverEmail: string;
		metadata: Record<string, string>;
	}): Promise<{ stripeCheckoutId: string }>;
}

// ---------------------------------------------------------------------------
// Mailer provider (typed cross-dep — marketing-funnel owns real impl)
// ---------------------------------------------------------------------------

export type MailKind =
	| 'gift_purchase_giver_receipt'
	| 'gift_purchase_recipient_invite'
	| 'autopilot_draft_ready'
	| 'autopilot_default_no_ship'
	| 'birthday_six_weeks_pre'
	| 'subscription_skipped'
	| 'subscription_cancelled'
	| 'referral_credit_awarded';

export interface MailerProvider {
	send(opts: {
		to: string;
		kind: MailKind;
		variables: Record<string, string>;
	}): Promise<{ messageId: string }>;
}

// ---------------------------------------------------------------------------
// Author hook (typed cross-dep — story-author goal owns real impl)
// ---------------------------------------------------------------------------

/**
 * Minimal slice of `StoryAuthorService.author` that autopilot needs.
 * Returns the preview shortcode the parent uses to view the draft.
 */
export interface StoryAuthorHook {
	authorDraft(opts: {
		subscriptionId: string;
		kidId?: string;
		themeId: ThemeId;
		format: Format;
	}): Promise<{ previewShortcode: string }>;
}

// ---------------------------------------------------------------------------
// Periodic scheduler (typed cross-dep — cognition kernel owns real impl)
// ---------------------------------------------------------------------------

/**
 * Minimal slice of `cognitionEngine.schedulePeriodic` used by AutopilotDrafter.
 * Per CLAUDE.md kernel rule 1: no raw setInterval.
 */
export interface PeriodicScheduler {
	schedulePeriodic(
		name: string,
		fn: () => Promise<void> | void,
		opts: { intervalMs: number; immediate?: boolean }
	): { cancel(): void };
}
