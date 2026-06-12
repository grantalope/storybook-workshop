// tests/fulfillment/fixtures.ts
//
// Shared mocks/helpers for the fulfillment test suite.

import type {
	ConsentLogEntry,
	LuluHttpClient,
	LuluPrintJobRequest,
	LuluPrintJobResponse,
	LuluShippingCostRequest,
	LuluShippingCostResponse,
	Order,
	ShippingAddress,
	ShippingOption,
	StripeHttpClient,
	CreatePaymentIntentOpts,
	PaymentIntent,
	RefundResult,
} from '$lib/services/fulfillment';

// ---------------------------------------------------------------------------
// Address fixture
// ---------------------------------------------------------------------------

export function makeAddress(overrides: Partial<ShippingAddress> = {}): ShippingAddress {
	return {
		name: 'Test Parent',
		line1: '123 Main St',
		city: 'Portland',
		region: 'OR',
		postcode: '97205',
		country: 'US',
		...overrides,
	};
}

export function makeShippingOption(overrides: Partial<ShippingOption> = {}): ShippingOption {
	return {
		name: 'Ground',
		shipSpeed: 'ground',
		costCents: 899,
		currency: 'USD',
		etaDays: 5,
		luluShippingLevel: 'GROUND',
		...overrides,
	};
}

export function makeConsent(overrides: Partial<ConsentLogEntry> = {}): ConsentLogEntry {
	return {
		reviewedSpreads: true,
		understandsNonRefundable: true,
		pdfHash: 'sha256-deadbeef-cafe',
		timestampMs: 1_700_000_000_000,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Lulu HTTP mock
// ---------------------------------------------------------------------------

export interface MockLuluCall {
	method: 'getAccessToken' | 'getShippingCost' | 'createPrintJob' | 'getPrintJob' | 'cancelPrintJob' | 'reissuePrintJob';
	args: unknown;
}

export function createMockLulu(): LuluHttpClient & {
	calls: MockLuluCall[];
	tokenCalls: number;
	setShippingResponse(opts: LuluShippingCostResponse): void;
	setCreateJobResponse(opts: LuluPrintJobResponse): void;
	setReissueJobResponse(opts: LuluPrintJobResponse): void;
	failNext(method: string, err?: Error): void;
} {
	const calls: MockLuluCall[] = [];
	let tokenCalls = 0;
	let shippingResp: LuluShippingCostResponse = {
		options: [
			{
				shippingLevel: 'MAIL',
				shipSpeed: 'mail',
				name: 'Standard',
				costExclTax: '4.99',
				currency: 'USD',
				etaMin: 7,
				etaMax: 14,
			},
		],
	};
	let createResp: LuluPrintJobResponse = { id: 'lj_mock_1', status: { name: 'CREATED' } };
	let reissueResp: LuluPrintJobResponse = { id: 'lj_reissue_1', status: { name: 'CREATED' } };
	const failures = new Map<string, Error>();
	let cachedToken: { accessToken: string; expiresAt: number } | null = null;

	return {
		get calls() {
			return calls;
		},
		get tokenCalls() {
			return tokenCalls;
		},
		setShippingResponse(r) {
			shippingResp = r;
		},
		setCreateJobResponse(r) {
			createResp = r;
		},
		setReissueJobResponse(r) {
			reissueResp = r;
		},
		failNext(method, err) {
			failures.set(method, err ?? new Error(`mock ${method} failure`));
		},
		async getAccessToken() {
			tokenCalls += 1;
			if (failures.has('getAccessToken')) {
				const e = failures.get('getAccessToken')!;
				failures.delete('getAccessToken');
				throw e;
			}
			if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken;
			cachedToken = { accessToken: `tok_${tokenCalls}`, expiresAt: Date.now() + 3_600_000 };
			return cachedToken;
		},
		async getShippingCost(req: LuluShippingCostRequest) {
			calls.push({ method: 'getShippingCost', args: req });
			if (failures.has('getShippingCost')) {
				const e = failures.get('getShippingCost')!;
				failures.delete('getShippingCost');
				throw e;
			}
			return shippingResp;
		},
		async createPrintJob(req: LuluPrintJobRequest) {
			calls.push({ method: 'createPrintJob', args: req });
			if (failures.has('createPrintJob')) {
				const e = failures.get('createPrintJob')!;
				failures.delete('createPrintJob');
				throw e;
			}
			return createResp;
		},
		async getPrintJob(id) {
			calls.push({ method: 'getPrintJob', args: id });
			return { id, status: { name: 'CREATED' } };
		},
		async cancelPrintJob(id) {
			calls.push({ method: 'cancelPrintJob', args: id });
			if (failures.has('cancelPrintJob')) {
				const e = failures.get('cancelPrintJob')!;
				failures.delete('cancelPrintJob');
				throw e;
			}
		},
		async reissuePrintJob(id, reason) {
			calls.push({ method: 'reissuePrintJob', args: { id, reason } });
			if (failures.has('reissuePrintJob')) {
				const e = failures.get('reissuePrintJob')!;
				failures.delete('reissuePrintJob');
				throw e;
			}
			return reissueResp;
		},
	};
}

// ---------------------------------------------------------------------------
// Stripe HTTP mock
// ---------------------------------------------------------------------------

export interface MockStripeCall {
	method: 'createPaymentIntent' | 'getPaymentIntent' | 'refund';
	args: unknown;
	idempotencyKey?: string;
}

export function createMockStripe(): StripeHttpClient & {
	calls: MockStripeCall[];
	idempotencyKeys: string[];
} {
	const calls: MockStripeCall[] = [];
	const idempotencyKeys: string[] = [];
	let counter = 0;
	const intents = new Map<string, PaymentIntent>();

	return {
		get calls() {
			return calls;
		},
		get idempotencyKeys() {
			return idempotencyKeys;
		},
		async createPaymentIntent(opts: CreatePaymentIntentOpts, idempotencyKey: string) {
			calls.push({ method: 'createPaymentIntent', args: opts, idempotencyKey });
			idempotencyKeys.push(idempotencyKey);
			const existing = [...intents.values()].find((pi) => pi.id === `pi_for_${opts.orderId}`);
			if (existing) return existing;
			counter += 1;
			const pi: PaymentIntent = {
				id: `pi_for_${opts.orderId}`,
				clientSecret: `pi_for_${opts.orderId}_secret_${counter}`,
				status: 'requires_payment_method',
				amountCents: opts.amountCents,
				currency: opts.currency,
			};
			intents.set(pi.id, pi);
			return pi;
		},
		async getPaymentIntent(id: string) {
			calls.push({ method: 'getPaymentIntent', args: id });
			return (
				intents.get(id) ?? {
					id,
					clientSecret: `${id}_secret`,
					status: 'requires_payment_method' as const,
					amountCents: 0,
					currency: 'USD',
				}
			);
		},
		async refund(piId, amountCents, idempotencyKey): Promise<RefundResult> {
			calls.push({ method: 'refund', args: { piId, amountCents }, idempotencyKey });
			if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
			counter += 1;
			return {
				id: `re_${counter}`,
				paymentIntentId: piId,
				amountCents: amountCents ?? 0,
				status: 'succeeded',
			};
		},
	};
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function makeClock(start = 1_700_000_000_000) {
	let t = start;
	return {
		now: () => t,
		advanceMs: (ms: number) => {
			t += ms;
		},
		set: (next: number) => {
			t = next;
		},
	};
}

export function makeIdGen(prefix = 'id'): () => string {
	let n = 0;
	return () => {
		n += 1;
		return `${prefix}_${n}`;
	};
}

// ---------------------------------------------------------------------------
// HMAC helper (for webhook signature test fixtures)
// ---------------------------------------------------------------------------

export async function hmacHex(secret: string, body: string): Promise<string> {
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

// ---------------------------------------------------------------------------
// Order factory
// ---------------------------------------------------------------------------

export function makeOrder(overrides: Partial<Order> = {}): Order {
	const now = 1_700_000_000_000;
	return {
		id: 'ord_test_1',
		kidId: 'kid_1',
		bookId: 'book_1',
		parentEmail: 'parent@example.com',
		format: 'hardcover-8x8',
		pages: 40,
		pdfHash: 'sha256-deadbeef-cafe',
		shippingAddress: makeAddress(),
		shippingOption: makeShippingOption(),
		bookCostCents: 2999,
		state: 'pending_payment',
		transitions: [
			{ from: null, to: 'pending_payment', at: now, actor: 'system', reason: 'order_created' },
		],
		consentLog: makeConsent(),
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}
