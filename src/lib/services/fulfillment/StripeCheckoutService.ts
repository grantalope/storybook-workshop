// @graph-layer: private
// @rationale: private (PaymentIntent + refund — billing PII tier)
//
// src/lib/services/fulfillment/StripeCheckoutService.ts
//
// Stripe PaymentIntent + refund client. Like LuluFulfillmentService, wraps
// network IO behind an injectable StripeHttpClient interface; tests pass
// an in-memory mock, production wires the default fetch-based impl.
//
// PaymentIntent creation enables automatic Stripe Tax (US sales tax + EU VAT)
// when `automatic_tax: { enabled: true }` is set and the customer's shipping
// address is forwarded. Idempotency key derived from order id so retries
// don't double-charge.
//
// Stripe webhook signature verification is included here (same crypto
// primitive as the Lulu webhook verifier).
//
// Spec: docs/specs/2026-05-24-design.md §5.2 + §5.4

import type {
	CreatePaymentIntentOpts,
	PaymentIntent,
	RefundResult,
	StripeHttpClient,
	StripeWebhookEvent,
	FulfillmentEnv,
} from './types';

export interface StripeServiceOpts {
	http: StripeHttpClient;
	/** Webhook secret used to verify Stripe `Stripe-Signature` header. */
	webhookSecret: string;
	nowSource?: () => number;
}

export class StripeCheckoutService {
	private _http: StripeHttpClient;
	private _webhookSecret: string;
	private _now: () => number;

	constructor(opts: StripeServiceOpts) {
		this._http = opts.http;
		this._webhookSecret = opts.webhookSecret;
		this._now = opts.nowSource ?? (() => Date.now());
	}

	/**
	 * Create a PaymentIntent. Idempotency key `order:{orderId}:create-payment`
	 * means repeated calls with the same order id return the same intent.
	 */
	async createPaymentIntent(opts: CreatePaymentIntentOpts): Promise<PaymentIntent> {
		if (!opts.orderId) throw new Error('Stripe: orderId required');
		if (opts.amountCents < 50) throw new Error('Stripe: amount below minimum (50 cents)');
		if (!opts.parentEmail) throw new Error('Stripe: parentEmail required');
		const idempotencyKey = `order:${opts.orderId}:create-payment`;
		return this._http.createPaymentIntent(opts, idempotencyKey);
	}

	async getPaymentIntent(id: string): Promise<PaymentIntent> {
		return this._http.getPaymentIntent(id);
	}

	/** Issue a refund. `amountCents` undefined = full refund. */
	async refund(paymentIntentId: string, amountCents?: number): Promise<RefundResult> {
		if (!paymentIntentId) throw new Error('Stripe: paymentIntentId required');
		if (amountCents !== undefined && amountCents <= 0) {
			throw new Error('Stripe: refund amount must be positive');
		}
		return this._http.refund(paymentIntentId, amountCents);
	}

	/**
	 * Verify a Stripe `Stripe-Signature: t=<ts>,v1=<hex>` header against the
	 * raw body. Mirrors `stripe.webhooks.constructEvent` algorithm without
	 * pulling in the Stripe SDK.
	 */
	async verifyWebhookSignature(
		rawBody: string,
		signatureHeader: string | null,
		toleranceSec = 300,
	): Promise<boolean> {
		if (!signatureHeader) return false;
		const parts = signatureHeader.split(',').map((s) => s.trim());
		const t = parts.find((p) => p.startsWith('t='))?.slice(2);
		const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
		if (!t || !v1) return false;
		const ts = parseInt(t, 10);
		if (!Number.isFinite(ts)) return false;
		const ageSec = Math.abs(Math.floor(this._now() / 1000) - ts);
		if (ageSec > toleranceSec) return false;
		const signed = `${t}.${rawBody}`;
		const computed = await hmacSha256Hex(this._webhookSecret, signed);
		return constantTimeEqual(computed.toLowerCase(), v1.toLowerCase());
	}

	parseWebhookEvent(rawBody: string): StripeWebhookEvent {
		const obj = JSON.parse(rawBody) as unknown;
		if (
			typeof obj !== 'object' ||
			obj === null ||
			typeof (obj as { id?: unknown }).id !== 'string' ||
			typeof (obj as { type?: unknown }).type !== 'string' ||
			typeof (obj as { data?: unknown }).data !== 'object'
		) {
			throw new Error('Stripe webhook: malformed payload');
		}
		return obj as StripeWebhookEvent;
	}
}

// ---------------------------------------------------------------------------
// HMAC helpers (shared with Lulu but kept local to avoid cross-imports)
// ---------------------------------------------------------------------------

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

// ---------------------------------------------------------------------------
// Default fetch-based StripeHttpClient
// ---------------------------------------------------------------------------

export interface FetchStripeHttpClientOpts {
	secretKey: string;
	fetchImpl?: typeof fetch;
	apiBase?: string; // default https://api.stripe.com/v1
}

/**
 * Default Stripe HTTP client. Form-encodes per Stripe REST conventions.
 * NOT exercised by unit tests — tests pass an in-memory StripeHttpClient
 * mock directly. Sandbox smoke run validates the real HTTP shape.
 */
export function createFetchStripeHttpClient(
	opts: FetchStripeHttpClientOpts,
): StripeHttpClient {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const apiBase = opts.apiBase ?? 'https://api.stripe.com/v1';

	function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
		return {
			Authorization: `Bearer ${opts.secretKey}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			...extra,
		};
	}

	function flatten(form: Record<string, unknown>, prefix = ''): string {
		const parts: string[] = [];
		for (const [k, v] of Object.entries(form)) {
			const key = prefix ? `${prefix}[${k}]` : k;
			if (v === undefined || v === null) continue;
			if (typeof v === 'object' && !Array.isArray(v)) {
				parts.push(flatten(v as Record<string, unknown>, key));
			} else {
				parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
			}
		}
		return parts.filter(Boolean).join('&');
	}

	return {
		async createPaymentIntent(o, idempotencyKey) {
			const form: Record<string, unknown> = {
				amount: o.amountCents,
				currency: o.currency.toLowerCase(),
				receipt_email: o.parentEmail,
				automatic_tax: { enabled: true },
				shipping: {
					name: o.shippingAddress.name,
					address: {
						line1: o.shippingAddress.line1,
						line2: o.shippingAddress.line2 ?? '',
						city: o.shippingAddress.city,
						state: o.shippingAddress.region,
						postal_code: o.shippingAddress.postcode,
						country: o.shippingAddress.country,
					},
				},
				metadata: { orderId: o.orderId, ...(o.metadata ?? {}) },
			};
			const res = await fetchImpl(`${apiBase}/payment_intents`, {
				method: 'POST',
				headers: authHeaders({ 'Idempotency-Key': idempotencyKey }),
				body: flatten(form),
			});
			if (!res.ok) throw new Error(`Stripe createPaymentIntent: ${res.status}`);
			const data = (await res.json()) as {
				id: string;
				client_secret: string;
				status: PaymentIntent['status'];
				amount: number;
				currency: string;
			};
			return {
				id: data.id,
				clientSecret: data.client_secret,
				status: data.status,
				amountCents: data.amount,
				currency: data.currency.toUpperCase(),
			};
		},
		async getPaymentIntent(id) {
			const res = await fetchImpl(`${apiBase}/payment_intents/${id}`, {
				headers: authHeaders(),
			});
			if (!res.ok) throw new Error(`Stripe getPaymentIntent: ${res.status}`);
			const data = (await res.json()) as {
				id: string;
				client_secret: string;
				status: PaymentIntent['status'];
				amount: number;
				currency: string;
			};
			return {
				id: data.id,
				clientSecret: data.client_secret,
				status: data.status,
				amountCents: data.amount,
				currency: data.currency.toUpperCase(),
			};
		},
		async refund(paymentIntentId, amountCents) {
			const form: Record<string, unknown> = { payment_intent: paymentIntentId };
			if (amountCents !== undefined) form.amount = amountCents;
			const res = await fetchImpl(`${apiBase}/refunds`, {
				method: 'POST',
				headers: authHeaders(),
				body: flatten(form),
			});
			if (!res.ok) throw new Error(`Stripe refund: ${res.status}`);
			const data = (await res.json()) as {
				id: string;
				payment_intent: string;
				amount: number;
				status: RefundResult['status'];
			};
			return {
				id: data.id,
				paymentIntentId: data.payment_intent,
				amountCents: data.amount,
				status: data.status,
			};
		},
	};
}

/** Convenience constructor wired from env. */
export function createStripeService(env: FulfillmentEnv): StripeCheckoutService {
	const http = createFetchStripeHttpClient({ secretKey: env.stripeSecretKey });
	return new StripeCheckoutService({ http, webhookSecret: env.stripeWebhookSecret });
}
