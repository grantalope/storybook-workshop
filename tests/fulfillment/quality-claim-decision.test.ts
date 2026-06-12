// tests/fulfillment/quality-claim-decision.test.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env as privateEnv } from '$env/dynamic/private';
import {
	createSqliteStores,
	InMemoryOrderStore,
	InMemoryQualityClaimStore,
	sqliteAvailable,
	type FulfillmentOrderStore,
	type Order,
	type QualityClaim,
	type QualityClaimStore,
	type SqliteStores,
} from '$lib/services/fulfillment';
import { POST as claimPOST } from '../../src/routes/api/quality-claim/+server';
import { POST as decisionPOST } from '../../src/routes/api/quality-claim/[id]/decision/+server';
import { callPost } from './api-helpers';
import { createMockStripe, makeOrder } from './fixtures';
import { wireFulfillmentDeps } from './wireFulfillmentDeps';

const OPS_TOKEN = 'ops_secret_test';
const tempDirs: string[] = [];

interface StoreHarness {
	name: string;
	store: FulfillmentOrderStore;
	claimStore: QualityClaimStore;
	close(): void;
}

const storeVariants: Array<{ name: string; open: () => StoreHarness }> = [
	{
		name: 'in-memory',
		open: () => ({
			name: 'in-memory',
			store: new InMemoryOrderStore(),
			claimStore: new InMemoryQualityClaimStore(),
			close() {},
		}),
	},
];

if (sqliteAvailable()) {
	storeVariants.push({
		name: 'sqlite',
		open: () => {
			const stores = openSqliteStores();
			return {
				name: 'sqlite',
				store: stores.orderStore,
				claimStore: stores.qualityClaimStore,
				close: stores.close,
			};
		},
	});
}

const memoryVariant = storeVariants[0]!;

beforeEach(() => {
	setOpsToken(OPS_TOKEN);
});

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
	delete privateEnv.OPS_API_TOKEN;
});

describe('POST /api/quality-claim/[id]/decision auth', () => {
	it('401s when OPS_API_TOKEN is absent or mismatched', async () => {
		const harness = wireRefund(memoryVariant.open());
		try {
			await seedOrderAndClaim(harness, 'ord_auth', 'claim_auth');

			delete privateEnv.OPS_API_TOKEN;
			const absent = await postDecision('claim_auth', OPS_TOKEN);
			expect(absent.status).toBe(401);

			setOpsToken(OPS_TOKEN);
			const mismatch = await postDecision('claim_auth', 'wrong_token');
			expect(mismatch.status).toBe(401);
		} finally {
			harness.close();
		}
	});
});

for (const variant of storeVariants) {
	describe(`POST /api/quality-claim/[id]/decision refunds (${variant.name})`, () => {
		it('executes an approved refund once and replays without a second Stripe call', async () => {
			const harness = wireRefund(variant.open());
			try {
				await seedOrderAndClaim(harness, 'ord_refund_once', 'claim_refund_once');

				const first = await postDecision('claim_refund_once');
				const afterFirstClaim = await harness.claimStore.get('claim_refund_once');
				const afterFirstOrder = await harness.store.get('ord_refund_once');
				const replay = await postDecision('claim_refund_once');
				const refundCalls = harness.stripeHttp.calls.filter((call) => call.method === 'refund');
				const ledger = await harness.store.getRefundLedgerEntry(
					'ord_refund_once',
					'claim_refund_once',
					'quality_claim',
				);

				expect(first.status).toBe(200);
				expect(first.data.ok).toBe(true);
				expect(first.data.alreadyExecuted).toBe(false);
				expect(replay.status).toBe(200);
				expect(replay.data.alreadyExecuted).toBe(true);
				expect(refundCalls).toHaveLength(1);
				expect(refundCalls[0]?.args).toEqual({ piId: 'pi_ord_refund_once', amountCents: 777 });
				expect(refundCalls[0]?.idempotencyKey).toBe(
					'order:ord_refund_once:claim:claim_refund_once:refund:777',
				);
				expect(ledger?.status).toBe('succeeded');
				expect(ledger?.stripeRefundId).toMatch(/^re_/);
				expect(ledger?.idempotencyKey).toBe(
					'order:ord_refund_once:claim:claim_refund_once:refund:777',
				);
				expect(afterFirstClaim?.decision).toBe('approved_refund');
				expect(afterFirstOrder?.state).toBe('paid');
				expect(afterFirstOrder?.transitions.at(-1)).toMatchObject({
					from: 'paid',
					to: 'paid',
					actor: 'ops',
					reason: 'ops_refund_approved',
				});
			} finally {
				harness.close();
			}
		});

		it('marks the ledger failed, keeps the claim pending, and does not retry replayed failures', async () => {
			const harness = wireRefund(variant.open(), { failRefund: true });
			try {
				await seedOrderAndClaim(harness, 'ord_refund_fail', 'claim_refund_fail');

				const first = await postDecision('claim_refund_fail');
				const replay = await postDecision('claim_refund_fail');
				const refundCalls = harness.stripeHttp.calls.filter((call) => call.method === 'refund');
				const claim = await harness.claimStore.get('claim_refund_fail');
				const ledger = await harness.store.getRefundLedgerEntry(
					'ord_refund_fail',
					'claim_refund_fail',
					'quality_claim',
				);

				expect(first.status).toBe(502);
				expect(first.data.error).toBe('refund_failed');
				expect(replay.status).toBe(502);
				expect(replay.data.alreadyFailed).toBe(true);
				expect(refundCalls).toHaveLength(1);
				expect(ledger?.status).toBe('failed');
				expect(ledger?.errorMessage).toBe('stripe down');
				expect(claim?.decision).toBe('approved_refund_pending');
			} finally {
				harness.close();
			}
		});
	});
}

describe('POST /api/quality-claim parent submit', () => {
	it('ignores any parent-supplied refund decision fields', async () => {
		const harness = wireRefund(memoryVariant.open());
		try {
			await harness.store.put(makePaidOrder('ord_parent_submit'));
			const response = await callPost(claimPOST, {
				body: {
					orderId: 'ord_parent_submit',
					category: 'defect',
					photoUrls: ['https://example.com/photo.jpg'],
					parentText: 'The cover arrived scratched.',
					decision: 'approved_refund',
					amountCents: 777,
				},
			});
			const refundCalls = harness.stripeHttp.calls.filter((call) => call.method === 'refund');

			expect(response.status).toBe(200);
			expect(response.data.decision).toBe('pending');
			expect(refundCalls).toHaveLength(0);
		} finally {
			harness.close();
		}
	});
});

function wireRefund(harness: StoreHarness, opts: { failRefund?: boolean } = {}) {
	const stripeHttp = createMockStripe();
	if (opts.failRefund) {
		stripeHttp.refund = async (piId, amountCents, idempotencyKey) => {
			stripeHttp.calls.push({ method: 'refund', args: { piId, amountCents }, idempotencyKey });
			throw new Error('stripe down');
		};
	}
	wireFulfillmentDeps({
		store: harness.store,
		claimStore: harness.claimStore,
		stripeHttp,
		stripeWebhookSecret: 'whsec_test',
	});
	return { ...harness, stripeHttp };
}

async function seedOrderAndClaim(
	harness: StoreHarness,
	orderId: string,
	claimId: string,
): Promise<void> {
	await harness.store.put(makePaidOrder(orderId));
	await harness.claimStore.put(makeClaim({ id: claimId, orderId }));
}

function makePaidOrder(id: string): Order {
	const base = makeOrder({
		id,
		stripePaymentIntentId: `pi_${id}`,
		state: 'paid',
		updatedAt: 1_700_000_001_000,
	});
	return {
		...base,
		transitions: [
			base.transitions[0]!,
			{
				from: 'pending_payment' as const,
				to: 'paid' as const,
				at: 1_700_000_001_000,
				actor: 'system' as const,
				reason: 'stripe_payment_intent_succeeded',
			},
		],
	};
}

function makeClaim(overrides: Partial<QualityClaim> = {}): QualityClaim {
	return {
		id: 'claim_test',
		orderId: 'ord_test',
		category: 'defect',
		photoUrls: ['https://example.com/photo.jpg'],
		parentText: 'The cover is damaged.',
		claimTs: 1_700_000_002_000,
		decision: 'pending',
		...overrides,
	};
}

function postDecision(claimId: string, token = OPS_TOKEN) {
	return callPost(decisionPOST, {
		params: { id: claimId },
		headers: { authorization: `Bearer ${token}` },
		body: { decision: 'approved_refund', amountCents: 777 },
	});
}

function setOpsToken(token: string): void {
	privateEnv.OPS_API_TOKEN = token;
}

function openSqliteStores(): SqliteStores {
	const stores = createSqliteStores({ dbPath: tempDbPath() });
	if (!stores) throw new Error('better-sqlite3 unavailable in quality-claim-decision test');
	return stores;
}

function tempDbPath(): string {
	return join(tempDir(), 'orders.db');
}

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'sw-refund-decision-'));
	tempDirs.push(dir);
	return dir;
}
