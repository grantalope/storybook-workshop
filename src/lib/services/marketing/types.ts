// @graph-layer: private
// @rationale: private (parent email + lifecycle stage = behavioral PII tier)
//
// src/lib/services/marketing/types.ts
//
// Canonical type surface for the Storybook Workshop marketing-funnel
// subsystem (email gate + lifecycle automation + abandoned cart + referral
// + educational drip + promo codes).
//
// Spec: docs/specs/2026-05-24-design.md §8

// ---------------------------------------------------------------------------
// Email templates + lifecycle stages
// ---------------------------------------------------------------------------

/** All email templates the marketing funnel emits. */
export type EmailTemplate =
	| 'gate_unlock'
	| 'lifecycle_T0'
	| 'lifecycle_T1h'
	| 'lifecycle_T24h'
	| 'lifecycle_T72h'
	| 'lifecycle_T7d'
	| 'lifecycle_T14d'
	| 'lifecycle_T30d'
	| 'abandoned_cart_T1h'
	| 'abandoned_cart_T24h'
	| 'abandoned_cart_T72h'
	| 'birthday_6w'
	| 'edu_drip_weekly'
	| 'referral_credit_awarded';

/** Lifecycle stage of an email-gated contact. */
export type LifecycleStage =
	| 'gate_unlocked'
	| 'paid_print'
	| 'series_subscribed'
	| 'unsubscribed';

/** Three opt-out buckets — GDPR-clean per spec §8.2. */
export type UnsubscribeBucket = 'transactional' | 'marketing' | 'educational';

/** Tags applied to a CRM contact on gate-unlock. */
export interface CrmContactTags {
	kidAgeBand?: string;
	themePicked?: string;
	lengthTier?: string;
	/** Anonymized pillar archetype family (no PII). */
	pillarArchetypeFamily?: string;
}

/** CRM contact record — never includes kid photo or rendered book interior. */
export interface CrmContact {
	email: string;
	createdAt: number;
	lifecycleStage: LifecycleStage;
	tags: CrmContactTags;
	/** Per-bucket unsubscribe state. */
	unsubscribed: Record<UnsubscribeBucket, boolean>;
	/** Last shortcode the parent unlocked a gate on (drives lifecycle links). */
	lastShortcode?: string;
	/** Per-template last-send timestamp — drives idempotency in lifecycle tick. */
	templateLastSentAt: Partial<Record<EmailTemplate, number>>;
}

// ---------------------------------------------------------------------------
// CRM client interface (Resend default; Postmark drop-in)
// ---------------------------------------------------------------------------

/** Outbound message payload — provider-agnostic shape. */
export interface CrmSendOpts {
	template: EmailTemplate;
	to: string;
	vars: Record<string, string>;
	/** Tags used by the CRM provider for cohort reporting. */
	tags?: string[];
}

/** Result of a CRM send. */
export interface CrmSendResult {
	ok: boolean;
	providerMessageId?: string;
	/** Reason for failure (non-empty when ok=false). */
	error?: string;
}

/** Provider-agnostic CRM client interface — DEFAULT is ResendProvider stub. */
export interface CrmClient {
	send(opts: CrmSendOpts): Promise<CrmSendResult>;
}

// ---------------------------------------------------------------------------
// Email gate
// ---------------------------------------------------------------------------

export interface EmailGateRecordOpts {
	email: string;
	shortcode: string;
	kidAgeBand?: string;
	themePicked?: string;
	lengthTier?: string;
	pillarArchetypeFamily?: string;
}

export interface EmailGateResult {
	contact: CrmContact;
	cookieValue: string;
	/** True if this email was already recorded for this shortcode (idempotent). */
	reused: boolean;
}

// ---------------------------------------------------------------------------
// Abandoned cart
// ---------------------------------------------------------------------------

/** Tracked Station-7 draft that didn't convert. */
export interface AbandonedCart {
	parentEmail: string;
	kidId: string;
	bookId: string;
	abandonedAt: number;
	/** Anonymized snapshot of cart total at abandonment. */
	bookCostCents: number;
	/** Last template fired against this cart. */
	lastSentTemplate?: EmailTemplate;
	/** Set to true when parent eventually pays — terminates the recovery chain. */
	resolved: boolean;
}

/** Promo code minted alongside an abandoned-cart email. */
export interface AbandonedCartPromo {
	code: string;
	parentEmail: string;
	cartId: string;
	pctOff: number;
	createdAt: number;
}

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------

/** A click against a referral shortcode. */
export interface ReferralClickRecord {
	shortcode: string;
	clickedAt: number;
}

/** A conversion attributed to a referral shortcode. */
export interface ReferralConversionRecord {
	shortcode: string;
	originatingParentEmail: string;
	paymentId: string;
	purchaseCents: number;
	convertedAt: number;
	/** Whether grandparent path (drives $5 credit award). */
	isGrandparentPurchase: boolean;
}

/** Credit awarded to originating parent. */
export interface ReferralCreditRecord {
	shortcode: string;
	originatingParentEmail: string;
	creditCents: number;
	paymentId: string;
	awardedAt: number;
}

// ---------------------------------------------------------------------------
// Educational drip
// ---------------------------------------------------------------------------

/** Single entry in the educational-drip catalog. */
export interface EduDripEntry {
	id: string;
	/** Evidence knob it ties to (e.g. "personalized_hero", "story_grammar"). */
	knob: string;
	/** Citation, e.g. "Symons & Johnson 1997". */
	citation: string;
	/** Body copy used in `vars.body`. */
	body: string;
	/** Soft product CTA appended to the body. */
	productTie: string;
}

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

export type PromoType = 'first_time' | 'abandoned_cart' | 'birthday' | 'series_discount';

/** Promo code — single source of truth for validation + redemption. */
export interface PromoCode {
	code: string;
	type: PromoType;
	pctOff: number;
	/** Cap in cents — caller must apply min(pctOff*total, cents). undefined = uncapped. */
	maxDiscountCents?: number;
	createdAt: number;
	expiresAt?: number;
	usageCount: number;
	/** undefined = unlimited; 1 = one-time. */
	maxUsage?: number;
	/** Per-parent gate — undefined = open. */
	scopedToParentEmail?: string;
}

export interface PromoValidationResult {
	ok: boolean;
	code?: PromoCode;
	error?:
		| 'unknown'
		| 'expired'
		| 'exhausted'
		| 'wrong_parent'
		| 'already_used_in_order';
}

export interface PromoApplyResult {
	ok: boolean;
	discountCents: number;
	finalCents: number;
	error?: string;
}

// ---------------------------------------------------------------------------
// Lifecycle scheduler
// ---------------------------------------------------------------------------

/** Definition of one stop in the lifecycle schedule. */
export interface LifecycleStep {
	template: EmailTemplate;
	/** Milliseconds after gate_unlocked. */
	offsetMs: number;
}
