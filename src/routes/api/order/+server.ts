// src/routes/api/order/+server.ts
//
// POST: create a new order in pending_payment + create a Stripe PaymentIntent.
//   Body: { kidId, bookId, parentEmail, format, pages, pdfHash,
//           shippingAddress, shippingOption, bookCostCents, consentLog }
//   Returns: { orderId, clientSecret, paymentIntentId }
//
// Pre-Stripe sanity-checks: format known + pages within format min/max +
// shipping address validates. Fails fast (no payment attempt) on bad input.

import { json, type RequestHandler } from '@sveltejs/kit';
import {
	OrderLifecycleService,
	StripeCheckoutService,
	InMemoryOrderStore,
	validateShippingAddress,
	ShippingAddressError,
	FORMAT_SPECS,
	type ConsentLogEntry,
	type ShippingAddress,
	type ShippingOption,
	type StripeHttpClient,
	type Order,
	type FulfillmentEnv,
} from '$lib/services/fulfillment';
import { priceForBook, verifyClientPriceClaim } from '$lib/services/fulfillment/pricing';
import { resolveParentEmail } from '../../../hooks.server';
import { secureRandomString } from '$lib/services/subscription/secureRandom';
import type { BookFormat } from '$lib/services/assemble/types';

// SECURITY-PATCH-2026-06-03 — see docs/specs (price tampering CRITICAL + auth HIGH from 2026-06-03 review)

// ---------------------------------------------------------------------------
// Module-scoped server singletons. Injected mock providers used in tests via
// `__setOrderApiDeps`. Production wiring picks env-backed defaults at first call.
// ---------------------------------------------------------------------------

interface OrderApiDeps {
	lifecycle: OrderLifecycleService;
	stripe: StripeCheckoutService;
	store: InMemoryOrderStore;
	idGen: () => string;
	nowSource: () => number;
}

// CSPRNG-backed order-id generator. Replaces the prior Math.random()-based
// shape (blocker #3 in the 2026-06-03 adversarial review): order ids are
// the lookup key for /api/order, /api/order/:id, /api/quality-claim, so
// guessable ids let an attacker enumerate / replay other parents' orders.
// 8-char alphanumeric token over secureRandomString gives ~41-bit entropy
// (36 ^ 8 = 2^41) backed by Web Crypto getRandomValues -- well above the
// threshold for opportunistic enumeration.
const _ORDER_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function _secureOrderIdGen(): string {
	return `ord_${secureRandomString(8, _ORDER_ID_ALPHABET)}`;
}

let _deps: OrderApiDeps | null = null;

export function __setOrderApiDeps(deps: OrderApiDeps): void {
	_deps = deps;
}

export function __getOrderApiDeps(): OrderApiDeps {
	if (_deps) return _deps;
	// Default test-mode wiring: in-memory store + mock Stripe. Production
	// swap-in will replace this via __setOrderApiDeps from a server hook.
	const store = new InMemoryOrderStore();
	const stripeHttp: StripeHttpClient = createMockStripeHttp();
	const lifecycle = new OrderLifecycleService({ store });
	const stripe = new StripeCheckoutService({
		http: stripeHttp,
		webhookSecret: 'test-webhook-secret',
	});
	_deps = {
		lifecycle,
		stripe,
		store,
		idGen: _secureOrderIdGen,
		nowSource: () => Date.now(),
	};
	return _deps;
}

function createMockStripeHttp(): StripeHttpClient {
	// Default mock: returns a deterministic PaymentIntent shape. Real wiring
	// swaps in createFetchStripeHttpClient from the fulfillment barrel.
	let counter = 0;
	return {
		async createPaymentIntent(opts, _idempotencyKey) {
			counter += 1;
			return {
				id: `pi_test_${counter}`,
				clientSecret: `pi_test_${counter}_secret_xyz`,
				status: 'requires_payment_method',
				amountCents: opts.amountCents,
				currency: opts.currency,
			};
		},
		async getPaymentIntent(id) {
			return {
				id,
				clientSecret: `${id}_secret_xyz`,
				status: 'succeeded',
				amountCents: 0,
				currency: 'USD',
			};
		},
		async refund(paymentIntentId, amountCents) {
			return {
				id: `re_test_${counter++}`,
				paymentIntentId,
				amountCents: amountCents ?? 0,
				status: 'succeeded',
			};
		},
	};
}

interface CreateOrderBody {
	kidId: string;
	bookId: string;
	/** OPTIONAL: only used as a sanity-check vs server-computed price. Server price is authoritative. */
	parentEmail?: string;
	format: BookFormat;
	pages: number;
	pdfHash: string;
	shippingAddress: ShippingAddress;
	shippingOption: ShippingOption;
	/** OPTIONAL: sanity-check vs priceForBook(format, pages). NEVER used directly for charge. */
	bookCostCents?: number;
	consentLog: ConsentLogEntry;
}

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	let body: CreateOrderBody;
	try {
		body = (await request.json()) as CreateOrderBody;
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	// Required-field check
	const required: Array<keyof CreateOrderBody> = [
		'kidId',
		'bookId',
		'format',
		'pages',
		'pdfHash',
		'shippingAddress',
		'shippingOption',
		'consentLog',
	];
	// parentEmail + bookCostCents intentionally omitted — both are derived server-side
	for (const k of required) {
		if (body[k] === undefined || body[k] === null) {
			return json({ error: 'missing_field', field: k }, { status: 400 });
		}
	}

	// PDF / format sanity pre-Stripe
	const spec = FORMAT_SPECS[body.format];
	if (!spec) {
		return json({ error: 'unknown_format', format: body.format }, { status: 400 });
	}
	if (body.pages < spec.minPages || body.pages > spec.maxPages) {
		return json(
			{
				error: 'pages_out_of_range',
				min: spec.minPages,
				max: spec.maxPages,
				got: body.pages,
			},
			{ status: 400 },
		);
	}
	if (body.pages % spec.multiple !== 0) {
		return json(
			{ error: 'pages_not_multiple_of', multiple: spec.multiple, got: body.pages },
			{ status: 400 },
		);
	}
	if (!body.pdfHash || body.pdfHash.length < 8) {
		return json({ error: 'invalid_pdfHash' }, { status: 400 });
	}
	if (!body.consentLog.reviewedSpreads || !body.consentLog.understandsNonRefundable) {
		return json({ error: 'consent_required' }, { status: 400 });
	}

	// Address validation (throws on bad)
	try {
		validateShippingAddress(body.shippingAddress);
	} catch (e) {
		if (e instanceof ShippingAddressError) {
			return json({ error: 'invalid_address', field: e.field, reason: e.reason }, { status: 400 });
		}
		throw e;
	}


	// ---------------------------------------------------------------------
	// SECURITY: server-derived parent identity + price (2026-06-03 review).
	// ---------------------------------------------------------------------
	const parentResolution = resolveParentEmail(
		locals?.user ?? null,
		body.parentEmail,
		{
			NODE_ENV: typeof process !== 'undefined' ? process.env.NODE_ENV : undefined,
			STORYBOOK_DEV_BYPASS_AUTH:
				typeof process !== 'undefined' ? process.env.STORYBOOK_DEV_BYPASS_AUTH : undefined,
		},
	);
	if ('error' in parentResolution) {
		return json(
			{ error: parentResolution.error, hint: parentResolution.hint },
			{ status: parentResolution.error === 'auth_bypass_misconfigured' ? 500 : 401 },
		);
	}
	const parentEmail = parentResolution.email;

	// Server-side price — authoritative. Client-supplied bookCostCents is
	// accepted ONLY as a sanity-check value and must match if provided.
	let serverBookCostCents: number;
	try {
		serverBookCostCents = priceForBook(body.format, body.pages);
	} catch (e) {
		return json(
			{ error: 'unpriced_combo', reason: (e as Error).message },
			{ status: 400 },
		);
	}
	const priceMismatch = verifyClientPriceClaim(body.bookCostCents, serverBookCostCents);
	if (priceMismatch) {
		return json(
			{ error: 'price_mismatch', detail: priceMismatch, serverPriceCents: serverBookCostCents },
			{ status: 400 },
		);
	}

	const deps = __getOrderApiDeps();
	const orderId = deps.idGen();

	const order: Order = await deps.lifecycle.create({
		id: orderId,
		kidId: body.kidId,
		bookId: body.bookId,
		parentEmail,
		format: body.format,
		pages: body.pages,
		pdfHash: body.pdfHash,
		shippingAddress: body.shippingAddress,
		shippingOption: body.shippingOption,
		bookCostCents: serverBookCostCents,
		consentLog: body.consentLog,
	});

	const totalCents = serverBookCostCents + body.shippingOption.costCents;
	let pi;
	try {
		pi = await deps.stripe.createPaymentIntent({
			orderId,
			amountCents: totalCents,
			currency: body.shippingOption.currency,
			parentEmail,
			shippingAddress: body.shippingAddress,
			metadata: { kidId: body.kidId, bookId: body.bookId },
		});
	} catch (e) {
		return json({ error: 'stripe_error', message: (e as Error).message }, { status: 502 });
	}

	// Persist payment intent ref
	const updated: Order = { ...order, stripePaymentIntentId: pi.id };
	await deps.store.put(updated);

	return json({
		orderId,
		clientSecret: pi.clientSecret,
		paymentIntentId: pi.id,
		amountCents: pi.amountCents,
		currency: pi.currency,
	});
};

// Re-export env helper for the host server hook to swap in real impls
export function configureOrderApi(env: FulfillmentEnv): void {
	// Placeholder — real wiring lives in hooks.server.ts when deployed.
	void env;
}
