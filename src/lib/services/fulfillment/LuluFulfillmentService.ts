// @graph-layer: private
// @rationale: private (Lulu Direct print-job + shipping-cost client; OAuth2 creds + parent shipping address)
//
// src/lib/services/fulfillment/LuluFulfillmentService.ts
//
// Lulu Direct REST API client. Wraps OAuth2 client-credentials JWT acquisition,
// print-job creation, status polling, cancellation, reissue (for reprints),
// and inbound webhook signature verification (HMAC-SHA256).
//
// All network IO is delegated to an injectable LuluHttpClient — tests pass
// a deterministic in-memory mock; production picks the default fetch-based
// impl (createFetchLuluHttpClient).
//
// Spec: docs/specs/2026-05-24-design.md §5.2 + §5.4 + §5.5

import type {
	LuluHttpClient,
	LuluOAuthToken,
	LuluPrintJobRequest,
	LuluPrintJobResponse,
	LuluShippingCostRequest,
	LuluShippingCostResponse,
	LuluWebhookEvent,
	Order,
	ShipSpeed,
	ShippingAddress,
	ShippingOption,
	FulfillmentEnv,
} from './types';
import { FORMAT_SPECS } from './types';
import type { BookFormat } from '$lib/services/assemble/types';

export interface LuluServiceOpts {
	http: LuluHttpClient;
	/** Override webhook secret. Defaults to env.luluWebhookSecret. */
	webhookSecret?: string;
	nowSource?: () => number;
}

export class LuluFulfillmentService {
	private _http: LuluHttpClient;
	private _webhookSecret: string;
	private _now: () => number;

	constructor(opts: LuluServiceOpts & { webhookSecret: string }) {
		this._http = opts.http;
		this._webhookSecret = opts.webhookSecret;
		this._now = opts.nowSource ?? (() => Date.now());
	}

	/** Live shipping quote per spec §5.2 step 2. */
	async getShippingQuote(
		address: ShippingAddress,
		format: BookFormat,
		pages: number,
		currency = 'USD',
	): Promise<ShippingOption[]> {
		const spec = FORMAT_SPECS[format];
		const req: LuluShippingCostRequest = {
			lineItems: [{ podPackageId: spec.podPackageId, pageCount: pages, quantity: 1 }],
			shippingAddress: address,
			currency,
		};
		const res = await this._http.getShippingCost(req);
		return res.options.map((o) => ({
			name: o.name,
			shipSpeed: o.shipSpeed,
			costCents: Math.round(parseFloat(o.costExclTax) * 100),
			currency: o.currency,
			etaDays: Math.round((o.etaMin + o.etaMax) / 2),
			luluShippingLevel: o.shippingLevel,
		}));
	}

	/** Create a Lulu print-job. Caller persists the returned jobId on the Order. */
	async createPrintJob(
		order: Order,
		pdfSourceUrl: string,
		coverPdfSourceUrl: string,
	): Promise<LuluPrintJobResponse> {
		const spec = FORMAT_SPECS[order.format];
		const req: LuluPrintJobRequest = {
			contactEmail: order.parentEmail,
			externalId: order.id,
			lineItems: [
				{
					externalId: `${order.id}-item-1`,
					printableNormalization: {
						cover: { sourceUrl: coverPdfSourceUrl },
						interior: { sourceUrl: pdfSourceUrl },
						podPackageId: spec.podPackageId,
					},
					quantity: 1,
					title: `Storybook for ${order.kidId}`,
				},
			],
			shippingAddress: order.shippingAddress,
			shippingLevel: order.shippingOption.luluShippingLevel,
		};
		return this._http.createPrintJob(req);
	}

	async getOrderStatus(
		luluJobId: string,
	): Promise<LuluPrintJobResponse & { trackingUrl?: string }> {
		return this._http.getPrintJob(luluJobId);
	}

	async cancelPrintJob(luluJobId: string): Promise<void> {
		return this._http.cancelPrintJob(luluJobId);
	}

	async reissuePrintJob(luluJobId: string, reason: string): Promise<LuluPrintJobResponse> {
		return this._http.reissuePrintJob(luluJobId, reason);
	}

	/**
	 * Verify an inbound Lulu webhook signature. Algorithm: HMAC-SHA256 over
	 * the raw request body keyed by webhook secret; constant-time hex compare.
	 *
	 * Header shape: `Lulu-Signature: sha256=<hex>`.
	 */
	async verifyWebhookSignature(rawBody: string, header: string | null): Promise<boolean> {
		if (!header) return false;
		const m = /^sha256=([a-f0-9]+)$/i.exec(header.trim());
		if (!m) return false;
		const provided = m[1].toLowerCase();
		const computed = await hmacSha256Hex(this._webhookSecret, rawBody);
		return constantTimeEqual(provided, computed.toLowerCase());
	}

	/** Parse + lightly validate a Lulu webhook body. Throws on malformed shape. */
	parseWebhookEvent(rawBody: string): LuluWebhookEvent {
		const obj = JSON.parse(rawBody) as unknown;
		if (
			typeof obj !== 'object' ||
			obj === null ||
			typeof (obj as { topic?: unknown }).topic !== 'string' ||
			typeof (obj as { data?: unknown }).data !== 'object' ||
			(obj as { data: unknown }).data === null
		) {
			throw new Error('LuluWebhook: malformed payload');
		}
		const d = (obj as { data: { printJobId?: unknown; status?: unknown } }).data;
		if (typeof d.printJobId !== 'string' || typeof d.status !== 'string') {
			throw new Error('LuluWebhook: missing printJobId or status');
		}
		return obj as LuluWebhookEvent;
	}
}

// ---------------------------------------------------------------------------
// HMAC helpers (Web Crypto API — works in Node 18+ via globalThis.crypto polyfill)
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
// Default fetch-based LuluHttpClient (production wiring)
// ---------------------------------------------------------------------------

export interface FetchLuluHttpClientOpts {
	clientId: string;
	clientSecret: string;
	apiBase: string;
	fetchImpl?: typeof fetch;
	nowSource?: () => number;
}

/**
 * Default Lulu HTTP client. Caches OAuth2 token in module-scoped state per
 * instance. Production reads creds from FulfillmentEnv at boot.
 *
 * NOT exercised by unit tests — tests pass an in-memory LuluHttpClient mock
 * directly. The real HTTP shape is covered by a manual sandbox smoke run
 * before launch (per goal Done criteria).
 */
export function createFetchLuluHttpClient(opts: FetchLuluHttpClientOpts): LuluHttpClient {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const now = opts.nowSource ?? (() => Date.now());
	let cached: LuluOAuthToken | null = null;

	async function getAccessToken(): Promise<LuluOAuthToken> {
		const t = now();
		if (cached && cached.expiresAt - 60_000 > t) return cached;
		const body = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: opts.clientId,
			client_secret: opts.clientSecret,
		}).toString();
		const res = await fetchImpl(`${opts.apiBase}/auth/realms/glasstree/protocol/openid-connect/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
		});
		if (!res.ok) throw new Error(`Lulu OAuth failed: ${res.status}`);
		const data = (await res.json()) as { access_token: string; expires_in: number };
		cached = {
			accessToken: data.access_token,
			expiresAt: t + data.expires_in * 1000,
		};
		return cached;
	}

	async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
		const tok = await getAccessToken();
		const headers = {
			...(init?.headers ?? {}),
			Authorization: `Bearer ${tok.accessToken}`,
			'Content-Type': 'application/json',
		};
		return fetchImpl(`${opts.apiBase}${path}`, { ...init, headers });
	}

	return {
		getAccessToken,
		async getShippingCost(req) {
			const res = await authedFetch('/print-shipping-options/', {
				method: 'POST',
				body: JSON.stringify(req),
			});
			if (!res.ok) throw new Error(`Lulu shipping-cost failed: ${res.status}`);
			return (await res.json()) as LuluShippingCostResponse;
		},
		async createPrintJob(req) {
			const res = await authedFetch('/print-jobs/', {
				method: 'POST',
				body: JSON.stringify(req),
			});
			if (!res.ok) throw new Error(`Lulu createPrintJob failed: ${res.status}`);
			return (await res.json()) as LuluPrintJobResponse;
		},
		async getPrintJob(id) {
			const res = await authedFetch(`/print-jobs/${id}/`);
			if (!res.ok) throw new Error(`Lulu getPrintJob failed: ${res.status}`);
			return (await res.json()) as LuluPrintJobResponse & { trackingUrl?: string };
		},
		async cancelPrintJob(id) {
			const res = await authedFetch(`/print-jobs/${id}/status/`, {
				method: 'PUT',
				body: JSON.stringify({ name: 'CANCELED' }),
			});
			if (!res.ok) throw new Error(`Lulu cancelPrintJob failed: ${res.status}`);
		},
		async reissuePrintJob(id, reason) {
			const res = await authedFetch(`/print-jobs/${id}/reissue/`, {
				method: 'POST',
				body: JSON.stringify({ reason }),
			});
			if (!res.ok) throw new Error(`Lulu reissuePrintJob failed: ${res.status}`);
			return (await res.json()) as LuluPrintJobResponse;
		},
	};
}

/** Convenience constructor wired from env. */
export function createLuluService(env: FulfillmentEnv): LuluFulfillmentService {
	const http = createFetchLuluHttpClient({
		clientId: env.luluClientId,
		clientSecret: env.luluClientSecret,
		apiBase: env.luluApiBase,
	});
	return new LuluFulfillmentService({ http, webhookSecret: env.luluWebhookSecret });
}

// Silence unused-import in some bundler configs:
void {} as unknown as ShipSpeed;
