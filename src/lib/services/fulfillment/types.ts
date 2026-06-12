// @graph-layer: private
// @rationale: private (per-order billing PII + shipping address tier)
//
// src/lib/services/fulfillment/types.ts
//
// Canonical type surface for the Storybook Workshop fulfillment subsystem
// (Lulu Direct print + Stripe payments + quality-guarantee handling).
//
// Spec: docs/specs/2026-05-24-design.md §5
// Goal: docs/goals/2026-05-24-fulfillment.md

import type { BookFormat } from '$lib/services/assemble/types';

// ---------------------------------------------------------------------------
// Core order types
// ---------------------------------------------------------------------------

/** State machine values per spec §5.3. */
export type OrderState =
	| 'pending_payment'
	| 'paid'
	| 'submitted_to_lulu'
	| 'in_production'
	| 'shipped'
	| 'delivered'
	| 'cancelled_pre_production'
	| 'failed_validation'
	| 'lulu_error_recoverable'
	| 'lulu_error_terminal'
	| 'lost_in_transit';

/** Actor that triggered a transition (audit log). */
export type TransitionActor = 'system' | 'parent' | 'ops' | 'lulu';

/** Single audit-log entry. */
export interface TransitionLogEntry {
	from: OrderState | null;
	to: OrderState;
	at: number;
	actor: TransitionActor;
	reason?: string;
	meta?: Record<string, unknown>;
}

/** Parent's consent at Station 6 — replayed for wrong_content claim defense. */
export interface ConsentLogEntry {
	reviewedSpreads: boolean;
	understandsNonRefundable: boolean;
	pdfHash: string;
	timestampMs: number;
}

/** ISO-3166-1 alpha-2 country code (e.g. "US"). */
export type CountryCode = string;

/** Shipping destination — only crosses network at order create + Lulu submit. */
export interface ShippingAddress {
	name: string;
	line1: string;
	line2?: string;
	city: string;
	/** State / province / region. */
	region: string;
	postcode: string;
	/** ISO-3166-1 alpha-2. */
	country: CountryCode;
	/** Optional phone — required by some Lulu shipping methods. */
	phone?: string;
}

/** Lulu shipping options offered to the parent at checkout. */
export type ShipSpeed = 'mail' | 'priority' | 'express' | 'ground';

export interface ShippingOption {
	name: string;
	shipSpeed: ShipSpeed;
	/** Cost in lowest currency unit (cents). */
	costCents: number;
	/** ISO-4217 currency code. */
	currency: string;
	etaDays: number;
	/** Opaque Lulu shipping-level identifier (used for print-job create). */
	luluShippingLevel: string;
}

/** Quality-guarantee claim categories per spec §5.7. */
export type QualityClaimCategory = 'defect' | 'wrong_content' | 'lost_transit' | 'color_off';

/** Decision outcomes per spec §5.5 + §5.7. */
export type QualityClaimDecision =
	| 'pending'
	| 'approved_reprint'
	| 'approved_refund'
	| 'rejected';

/** Parent-submitted quality claim. */
export interface QualityClaim {
	id: string;
	orderId: string;
	category: QualityClaimCategory;
	photoUrls: string[];
	parentText: string;
	claimTs: number;
	decision: QualityClaimDecision;
	decisionReason?: string;
	decisionAt?: number;
	/** If approved_reprint, the new Lulu job id of the reissue. */
	reissueLuluJobId?: string;
}

/** Canonical order record. */
export interface Order {
	id: string;
	kidId: string;
	bookId: string;
	parentEmail: string;
	format: BookFormat;
	pages: number;
	/** SHA-256 hex of the assembled PDF — defends against wrong_content claims. */
	pdfHash: string;
	shippingAddress: ShippingAddress;
	shippingOption: ShippingOption;
	/** Pre-tax book cost in cents. */
	bookCostCents: number;
	/** Stripe PaymentIntent id (set during create). */
	stripePaymentIntentId?: string;
	/** Lulu print-job id (set on submission). */
	luluJobId?: string;
	state: OrderState;
	transitions: TransitionLogEntry[];
	consentLog: ConsentLogEntry;
	createdAt: number;
	updatedAt: number;
	/** Tracking link from Lulu when shipped. */
	trackingUrl?: string;
	/** If this order is a reissue, link to the original. */
	reissueOfOrderId?: string;
	/** If this order has been reissued, link to the reissue. */
	reissueOrderId?: string;
}

// ---------------------------------------------------------------------------
// Lulu HTTP boundary
// ---------------------------------------------------------------------------

export interface LuluOAuthToken {
	accessToken: string;
	expiresAt: number;
}

export interface LuluPrintJobRequest {
	contactEmail: string;
	externalId: string;
	lineItems: Array<{
		externalId: string;
		printableNormalization: {
			cover: { sourceUrl: string };
			interior: { sourceUrl: string };
			podPackageId: string;
		};
		quantity: number;
		title: string;
	}>;
	shippingAddress: ShippingAddress;
	shippingLevel: string;
}

export interface LuluPrintJobResponse {
	id: string;
	status: { name: string; message?: string };
}

export interface LuluShippingCostRequest {
	lineItems: Array<{ podPackageId: string; pageCount: number; quantity: number }>;
	shippingAddress: ShippingAddress;
	currency: string;
}

export interface LuluShippingCostResponse {
	options: Array<{
		shippingLevel: string;
		shipSpeed: ShipSpeed;
		name: string;
		costExclTax: string;
		currency: string;
		etaMin: number;
		etaMax: number;
	}>;
}

/** Injectable HTTP boundary — tests pass a mock; production wires fetch. */
export interface LuluHttpClient {
	/** OAuth2 client-credentials -> JWT. Implementation may cache. */
	getAccessToken(): Promise<LuluOAuthToken>;
	getShippingCost(req: LuluShippingCostRequest): Promise<LuluShippingCostResponse>;
	createPrintJob(req: LuluPrintJobRequest): Promise<LuluPrintJobResponse>;
	getPrintJob(luluJobId: string): Promise<LuluPrintJobResponse & { trackingUrl?: string }>;
	cancelPrintJob(luluJobId: string): Promise<void>;
	reissuePrintJob(luluJobId: string, reason: string): Promise<LuluPrintJobResponse>;
}

/** Lulu webhook payload subset we map to order transitions. */
export interface LuluWebhookEvent {
	topic: string;
	data: {
		printJobId: string;
		status: string;
		message?: string;
		trackingUrl?: string;
	};
}

// ---------------------------------------------------------------------------
// Stripe HTTP boundary
// ---------------------------------------------------------------------------

export interface CreatePaymentIntentOpts {
	orderId: string;
	amountCents: number;
	currency: string;
	parentEmail: string;
	shippingAddress: ShippingAddress;
	metadata?: Record<string, string>;
}

export interface PaymentIntent {
	id: string;
	clientSecret: string;
	status: 'requires_payment_method' | 'requires_confirmation' | 'succeeded' | 'canceled';
	amountCents: number;
	currency: string;
}

export interface RefundResult {
	id: string;
	paymentIntentId: string;
	amountCents: number;
	status: 'succeeded' | 'pending' | 'failed';
}

export interface StripeHttpClient {
	createPaymentIntent(opts: CreatePaymentIntentOpts, idempotencyKey: string): Promise<PaymentIntent>;
	getPaymentIntent(id: string): Promise<PaymentIntent>;
	refund(paymentIntentId: string, amountCents?: number): Promise<RefundResult>;
}

export interface StripeWebhookEvent {
	id: string;
	type:
		| 'payment_intent.succeeded'
		| 'payment_intent.payment_failed'
		| 'charge.refunded'
		| string;
	data: { object: { id: string; payment_intent?: string | null; metadata?: Record<string, string> } };
}

// ---------------------------------------------------------------------------
// Order persistence
// ---------------------------------------------------------------------------

export interface OrderStore {
	get(id: string): Promise<Order | undefined>;
	put(order: Order): Promise<void>;
	listByParent(email: string): Promise<Order[]>;
	getByStripePaymentIntent(id: string): Promise<Order | undefined>;
	getByLuluJob(id: string): Promise<Order | undefined>;
}

export interface ApplyStripeWebhookEventOnceInput {
	eventId: string;
	eventType: string;
	paymentIntentId: string;
	expectedState?: OrderState;
	toState?: OrderState;
	actor: TransitionActor;
	reason: string;
	meta?: Record<string, unknown>;
	at: number;
}

export type StripeWebhookApplyOutcome = 'applied' | 'duplicate' | 'ignored';

export interface StripeWebhookApplyResult {
	outcome: StripeWebhookApplyOutcome;
	reason?: 'unknown_payment_intent' | 'state_mismatch';
	order?: Order;
	previousState?: OrderState;
	currentState?: OrderState;
}

export interface WebhookOrderStore extends OrderStore {
	applyStripeWebhookEventOnce(
		input: ApplyStripeWebhookEventOnceInput,
	): Promise<StripeWebhookApplyResult>;
}

export function isWebhookOrderStore(store: OrderStore): store is WebhookOrderStore {
	return typeof (store as Partial<WebhookOrderStore>).applyStripeWebhookEventOnce === 'function';
}

export interface QualityClaimStore {
	get(id: string): Promise<QualityClaim | undefined>;
	put(claim: QualityClaim): Promise<void>;
	listPending(): Promise<QualityClaim[]>;
}

// ---------------------------------------------------------------------------
// Email provider
// ---------------------------------------------------------------------------

export type EmailEventName = 'paid' | 'printed' | 'shipped' | 'delivered' | 'failed' | 'refunded';

export interface EmailMessage {
	to: string;
	event: EmailEventName;
	order: Order;
}

export interface TransactionalEmailProvider {
	send(msg: EmailMessage): Promise<void>;
}

// ---------------------------------------------------------------------------
// Env / wiring
// ---------------------------------------------------------------------------

export interface FulfillmentEnv {
	luluClientId: string;
	luluClientSecret: string;
	luluApiBase: string;
	luluWebhookSecret: string;
	stripeSecretKey: string;
	stripeWebhookSecret: string;
	cancelWindowMs: number;
	currency: string;
}

export const DEFAULT_CANCEL_WINDOW_MS = 75 * 60 * 1000; // 75 minutes
export const DEFAULT_CURRENCY = 'USD';

// ---------------------------------------------------------------------------
// Format -> pod_package_id + page constraints (spec §5.1)
// ---------------------------------------------------------------------------

export interface FormatSpec {
	podPackageId: string;
	minPages: number;
	maxPages: number;
	multiple: number;
}

/** Lulu pod_package_id catalog for the 3 v1 formats. */
export const FORMAT_SPECS: Record<BookFormat, FormatSpec> = Object.freeze({
	'hardcover-8x8': {
		podPackageId: '0850X0850FCSTDCW080CW444GXX',
		minPages: 24,
		maxPages: 800,
		multiple: 2,
	},
	'softcover-8x8': {
		podPackageId: '0850X0850FCSTDPB080CW444GXX',
		minPages: 32,
		maxPages: 740,
		multiple: 2,
	},
	'saddlestitch-8x8': {
		podPackageId: '0850X0850FCSTDSS080CW444GXX',
		minPages: 4,
		maxPages: 48,
		multiple: 4,
	},
});

/** Map a Lulu status string to an OrderState; null = ignore. */
export function luluStatusToOrderState(status: string): OrderState | null {
	const s = status.toUpperCase();
	if (s === 'CREATED' || s === 'UNPAID' || s === 'PAYMENT_IN_PROGRESS') return 'submitted_to_lulu';
	if (s === 'PRODUCTION_READY' || s === 'IN_PRODUCTION' || s === 'PRINTED') return 'in_production';
	if (s === 'SHIPPED') return 'shipped';
	if (s === 'DELIVERED') return 'delivered';
	if (s === 'CANCELLED' || s === 'CANCELED') return 'cancelled_pre_production';
	if (s === 'REJECTED' || s === 'ERROR' || s === 'FAILED') return 'lulu_error_terminal';
	return null;
}
