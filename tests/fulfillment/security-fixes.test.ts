/**
 * Security regression tests — 2026-06-03 review findings.
 *
 * - CRITICAL: price tampering via client-supplied bookCostCents.
 * - HIGH: missing auth / attacker-controlled parentEmail.
 *
 * These tests verify the order endpoint refuses tampering attempts AND
 * computes price authoritatively server-side from priceForBook(format,pages).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { POST as orderPost, __setOrderApiDeps } from "../../src/routes/api/order/+server";
import {
	OrderLifecycleService,
	StripeCheckoutService,
	InMemoryOrderStore,
	type StripeHttpClient,
} from "$lib/services/fulfillment";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeMockStripeHttp(): { http: StripeHttpClient; created: { amountCents: number }[] } {
	const created: { amountCents: number }[] = [];
	const http: StripeHttpClient = {
		async createPaymentIntent(opts) {
			created.push({ amountCents: opts.amountCents });
			return {
				id: `pi_${created.length}`,
				clientSecret: `pi_${created.length}_secret`,
				status: "requires_payment_method",
				amountCents: opts.amountCents,
				currency: opts.currency,
			};
		},
		async getPaymentIntent(id) {
			return { id, clientSecret: `${id}_secret`, status: "succeeded", amountCents: 0, currency: "USD" };
		},
		async refund(paymentIntentId) {
			return { id: `re_${paymentIntentId}`, paymentIntentId, amountCents: 0, status: "succeeded" };
		},
	};
	return { http, created };
}

function setupDeps() {
	const store = new InMemoryOrderStore();
	const { http, created } = makeMockStripeHttp();
	const lifecycle = new OrderLifecycleService({ store });
	const stripe = new StripeCheckoutService({ http, webhookSecret: "test-webhook-secret" });
	__setOrderApiDeps({
		lifecycle,
		stripe,
		store,
		idGen: () => `ord_test_${Math.random().toString(36).slice(2, 10)}`,
		nowSource: () => 1_700_000_000_000,
	});
	return { store, created };
}

function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}): Request {
	return new Request("http://localhost/api/order", {
		method: "POST",
		headers: { "content-type": "application/json", ...extraHeaders },
		body: JSON.stringify(body),
	});
}

const VALID_BODY = {
	kidId: "kid_eli",
	bookId: "book_xyz",
	parentEmail: "parent@example.com",
	format: "hardcover-8x8",
	pages: 24,
	pdfHash: "abc12345678",
	shippingAddress: {
		name: "Test Parent",
		line1: "1 Test Way",
		city: "Brooklyn",
		region: "NY",
		postcode: "11201",
		country: "US",
	},
	shippingOption: {
		name: "Mail",
		shipSpeed: "mail",
		costCents: 599,
		currency: "USD",
		etaDays: 7,
	},
	consentLog: {
		reviewedSpreads: true,
		understandsNonRefundable: true,
		consentedAt: Date.now(),
		pdfHashAtConsent: "abc12345678",
	},
};

// ─── env management ──────────────────────────────────────────────────────────

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_BYPASS = process.env.STORYBOOK_DEV_BYPASS_AUTH;

afterEach(() => {
	process.env.NODE_ENV = ORIGINAL_NODE_ENV;
	process.env.STORYBOOK_DEV_BYPASS_AUTH = ORIGINAL_BYPASS;
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("SECURITY: server-side pricing (CRITICAL price-tampering fix)", () => {
	beforeEach(() => setupDeps());

	it("server computes bookCostCents from priceForBook — client value IGNORED when matching", async () => {
		const { created } = setupDeps();
		const body = { ...VALID_BODY, bookCostCents: 2999 };
		const res = await orderPost({ request: makeRequest(body), locals: {} } as never);
		expect(res.status).toBe(200);
		// 2999 (server flagship price) + 599 (shipping) = 3598
		expect(created[0]?.amountCents).toBe(3598);
	});

	it("server computes bookCostCents when client OMITS the field (server is authoritative)", async () => {
		const { created } = setupDeps();
		const body = { ...VALID_BODY };
		delete (body as Partial<typeof VALID_BODY>).bookCostCents;
		const res = await orderPost({ request: makeRequest(body), locals: {} } as never);
		expect(res.status).toBe(200);
		expect(created[0]?.amountCents).toBe(3598);
	});

	it("REJECTS client price tampering — bookCostCents=50 vs server=2999 → 400 price_mismatch", async () => {
		const { created } = setupDeps();
		const tampered = { ...VALID_BODY, bookCostCents: 50 };
		const res = await orderPost({ request: makeRequest(tampered), locals: {} } as never);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("price_mismatch");
		expect(body.serverPriceCents).toBe(2999);
		expect(created).toHaveLength(0); // no Stripe call attempted
	});

	it("REJECTS client overcharge attempt — bookCostCents=99999 vs server=2999 → 400", async () => {
		const { created } = setupDeps();
		const tampered = { ...VALID_BODY, bookCostCents: 99999 };
		const res = await orderPost({ request: makeRequest(tampered), locals: {} } as never);
		expect(res.status).toBe(400);
		expect(created).toHaveLength(0);
	});

	it("server rejects (format, pages) combos with no price entry — saddlestitch saga", async () => {
		setupDeps();
		const invalid = { ...VALID_BODY, format: "saddlestitch-8x8" as const, pages: 48 };
		const res = await orderPost({ request: makeRequest(invalid), locals: {} } as never);
		// saddlestitch maxPages=48 passes FORMAT_SPECS — pricing then rejects saga tier
		expect(res.status).toBe(400);
	});
});

describe("SECURITY: auth required (HIGH unauthenticated-order fix)", () => {
	beforeEach(() => setupDeps());

	it("returns 401 auth_required when no session + dev-bypass disabled", async () => {
		const { created } = setupDeps();
		delete process.env.STORYBOOK_DEV_BYPASS_AUTH;
		process.env.NODE_ENV = "test";
		const res = await orderPost({
			request: makeRequest(VALID_BODY),
			locals: {},
		} as never);
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("auth_required");
		expect(created).toHaveLength(0);
	});

	it("returns 500 auth_bypass_misconfigured in production with dev-bypass set", async () => {
		const { created } = setupDeps();
		process.env.NODE_ENV = "production";
		process.env.STORYBOOK_DEV_BYPASS_AUTH = "1";
		const res = await orderPost({
			request: makeRequest(VALID_BODY),
			locals: {},
		} as never);
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error).toBe("auth_bypass_misconfigured");
		expect(created).toHaveLength(0);
	});

	it("prefers locals.user.email over body.parentEmail (session always wins)", async () => {
		const { store } = setupDeps();
		const res = await orderPost({
			request: makeRequest(VALID_BODY),
			locals: {
				user: { email: "session-only@example.com", parentId: "p_1" },
			},
		} as never);
		expect(res.status).toBe(200);
		const json = await res.json();
		const stored = await store.get(json.orderId);
		expect(stored?.parentEmail).toBe("session-only@example.com");
		// body parentEmail was "parent@example.com" — must be ignored
	});

	it("accepts body.parentEmail in dev bypass mode (with loud warning)", async () => {
		const { store } = setupDeps();
		process.env.STORYBOOK_DEV_BYPASS_AUTH = "1";
		const res = await orderPost({
			request: makeRequest(VALID_BODY),
			locals: {},
		} as never);
		expect(res.status).toBe(200);
		const json = await res.json();
		const stored = await store.get(json.orderId);
		expect(stored?.parentEmail).toBe("parent@example.com");
	});

	it("rejects malformed parentEmail even in dev bypass mode", async () => {
		setupDeps();
		const bad = { ...VALID_BODY, parentEmail: "not-an-email" };
		const res = await orderPost({ request: makeRequest(bad), locals: {} } as never);
		expect(res.status).toBe(401);
	});
});
