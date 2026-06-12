// tests/fulfillment/webhook-dedup.test.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createSqliteStores,
	InMemoryOrderStore,
	sqliteAvailable,
	type Order,
	type SqliteStores,
	type WebhookOrderStore,
} from '$lib/services/fulfillment';
import { POST as stripeWebhookPOST } from '../../src/routes/api/stripe-webhook/+server';
import { callPost } from './api-helpers';
import { hmacHex, makeClock, makeOrder } from './fixtures';
import { wireFulfillmentDeps } from './wireFulfillmentDeps';

const STRIPE_SECRET = 'whsec_test';
const tempDirs: string[] = [];

interface StoreHarness {
	name: string;
	store: WebhookOrderStore;
	close(): void;
}

const storeVariants: Array<{ name: string; open: () => StoreHarness }> = [
	{
		name: 'in-memory',
		open: () => ({
			name: 'in-memory',
			store: new InMemoryOrderStore(),
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
				close: stores.close,
			};
		},
	});
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const variant of storeVariants) {
	describe(`Stripe webhook dedup (${variant.name})`, () => {
		it('dedupes replayed handled event ids without changing transitions twice', async () => {
			for (const eventCase of handledEventCases()) {
				const harness = wireWebhook(variant.open());
				try {
					const order = makeOrder({
						id: `ord_${eventCase.eventId}`,
						stripePaymentIntentId: `pi_${eventCase.eventId}`,
					});
					await harness.store.put(order);

					const body = JSON.stringify(eventCase.event(order.stripePaymentIntentId!));
					const first = await postStripe(body, harness);
					const afterFirst = (await harness.store.get(order.id))!;
					const second = await postStripe(body, harness);
					const afterSecond = (await harness.store.get(order.id))!;

					expect(first.status).toBe(200);
					expect(first.data.outcome).toBe('applied');
					expect(second.status).toBe(200);
					expect(second.data.outcome).toBe('duplicate');
					expect(second.data.deduped).toBe(true);
					expect(afterSecond.state).toBe(eventCase.finalState);
					expect(afterSecond.transitions).toHaveLength(afterFirst.transitions.length);
				} finally {
					harness.close();
				}
			}
		});

		it('allows only one concurrent delivery of the same event id to apply', async () => {
			const harness = wireWebhook(variant.open());
			try {
				const order = makeOrder({
					id: 'ord_concurrent',
					stripePaymentIntentId: 'pi_concurrent',
				});
				await harness.store.put(order);
				const body = JSON.stringify({
					id: 'evt_concurrent_success',
					type: 'payment_intent.succeeded',
					data: { object: { id: order.stripePaymentIntentId } },
				});

				const [a, b] = await Promise.all([postStripe(body, harness), postStripe(body, harness)]);
				const outcomes = [a.data.outcome, b.data.outcome].sort();
				const updated = (await harness.store.get(order.id))!;

				expect([a.status, b.status]).toEqual([200, 200]);
				expect(outcomes).toEqual(['applied', 'duplicate']);
				expect(updated.state).toBe('paid');
				expect(updated.transitions).toHaveLength(2);
			} finally {
				harness.close();
			}
		});

		it('treats success/failure ordering conflicts as permanent 200 ignored outcomes', async () => {
			const successFirst = wireWebhook(variant.open());
			try {
				const order = makeOrder({ id: 'ord_success_first', stripePaymentIntentId: 'pi_ordering_1' });
				await successFirst.store.put(order);
				const success = eventBody('evt_success_first', 'payment_intent.succeeded', order.stripePaymentIntentId!);
				const failure = eventBody('evt_failure_second', 'payment_intent.payment_failed', order.stripePaymentIntentId!);

				expect((await postStripe(success, successFirst)).data.outcome).toBe('applied');
				const afterSuccess = (await successFirst.store.get(order.id))!;
				const ignored = await postStripe(failure, successFirst);
				const afterFailure = (await successFirst.store.get(order.id))!;

				expect(ignored.status).toBe(200);
				expect(ignored.data.outcome).toBe('ignored');
				expect(ignored.data.ignored).toBe('not_pending_payment');
				expect(ignored.data.state).toBe('paid');
				expect(afterFailure.transitions).toHaveLength(afterSuccess.transitions.length);
			} finally {
				successFirst.close();
			}

			const failureFirst = wireWebhook(variant.open());
			try {
				const order = makeOrder({ id: 'ord_failure_first', stripePaymentIntentId: 'pi_ordering_2' });
				await failureFirst.store.put(order);
				const failure = eventBody('evt_failure_first', 'payment_intent.payment_failed', order.stripePaymentIntentId!);
				const success = eventBody('evt_success_second', 'payment_intent.succeeded', order.stripePaymentIntentId!);

				expect((await postStripe(failure, failureFirst)).data.outcome).toBe('applied');
				const afterFailure = (await failureFirst.store.get(order.id))!;
				const ignored = await postStripe(success, failureFirst);
				const afterSuccess = (await failureFirst.store.get(order.id))!;

				expect(ignored.status).toBe(200);
				expect(ignored.data.outcome).toBe('ignored');
				expect(ignored.data.ignored).toBe('not_pending_payment');
				expect(ignored.data.state).toBe('failed_validation');
				expect(afterSuccess.transitions).toHaveLength(afterFailure.transitions.length);
			} finally {
				failureFirst.close();
			}
		});

		it('acks unknown local PaymentIntents as ignored and dedupes the replay', async () => {
			const harness = wireWebhook(variant.open());
			try {
				const body = eventBody('evt_unknown_pi', 'payment_intent.succeeded', 'pi_missing');

				const first = await postStripe(body, harness);
				const second = await postStripe(body, harness);

				expect(first.status).toBe(200);
				expect(first.data.outcome).toBe('ignored');
				expect(first.data.ignored).toBe('unknown_payment_intent');
				expect(second.status).toBe(200);
				expect(second.data.outcome).toBe('duplicate');
			} finally {
				harness.close();
			}
		});

		it('returns 200 ignored for unhandled valid signed event types', async () => {
			const harness = wireWebhook(variant.open());
			try {
				const body = JSON.stringify({
					id: 'evt_unhandled',
					type: 'customer.created',
					data: { object: { id: 'cus_1' } },
				});
				const result = await postStripe(body, harness);

				expect(result.status).toBe(200);
				expect(result.data.outcome).toBe('ignored');
				expect(result.data.ignored).toBe(true);
				expect(result.data.reason).toBe('unhandled_event_type');
			} finally {
				harness.close();
			}
		});

		it('keeps the signature ack matrix: 401 invalid signature, 400 malformed signed payload', async () => {
			const harness = wireWebhook(variant.open());
			try {
				const invalid = await callPost(stripeWebhookPOST, {
					rawBody: '{}',
					headers: { 'stripe-signature': 't=1,v1=bad' },
				});
				expect(invalid.status).toBe(401);

				const malformedBody = '{not json';
				const malformed = await callPost(stripeWebhookPOST, {
					rawBody: malformedBody,
					headers: { 'stripe-signature': await stripeSignature(malformedBody, harness) },
				});
				expect(malformed.status).toBe(400);
				expect(malformed.data.error).toBe('malformed_payload');
			} finally {
				harness.close();
			}
		});
	});
}

function wireWebhook(harness: StoreHarness): StoreHarness & { clock: ReturnType<typeof makeClock> } {
	const deps = wireFulfillmentDeps({
		store: harness.store,
		stripeWebhookSecret: STRIPE_SECRET,
	});
	return { ...harness, clock: deps.clock };
}

function handledEventCases(): Array<{
	eventId: string;
	finalState: Order['state'];
	event: (paymentIntentId: string) => unknown;
}> {
	return [
		{
			eventId: 'success_replay',
			finalState: 'paid',
			event: (paymentIntentId) => ({
				id: 'evt_success_replay',
				type: 'payment_intent.succeeded',
				data: { object: { id: paymentIntentId } },
			}),
		},
		{
			eventId: 'failure_replay',
			finalState: 'failed_validation',
			event: (paymentIntentId) => ({
				id: 'evt_failure_replay',
				type: 'payment_intent.payment_failed',
				data: { object: { id: paymentIntentId } },
			}),
		},
		{
			eventId: 'refund_replay',
			finalState: 'pending_payment',
			event: (paymentIntentId) => ({
				id: 'evt_refund_replay',
				type: 'charge.refunded',
				data: { object: { id: 'ch_refund_replay', payment_intent: paymentIntentId } },
			}),
		},
	];
}

function eventBody(eventId: string, type: string, paymentIntentId: string): string {
	return JSON.stringify({
		id: eventId,
		type,
		data: { object: { id: paymentIntentId } },
	});
}

async function postStripe(
	body: string,
	harness: StoreHarness & { clock: ReturnType<typeof makeClock> },
) {
	return callPost(stripeWebhookPOST, {
		rawBody: body,
		headers: { 'stripe-signature': await stripeSignature(body, harness) },
	});
}

async function stripeSignature(
	body: string,
	harness: StoreHarness & { clock: ReturnType<typeof makeClock> },
): Promise<string> {
	const ts = Math.floor(harness.clock.now() / 1000);
	const sig = await hmacHex(STRIPE_SECRET, `${ts}.${body}`);
	return `t=${ts},v1=${sig}`;
}

function openSqliteStores(): SqliteStores {
	const stores = createSqliteStores({ dbPath: tempDbPath() });
	if (!stores) throw new Error('better-sqlite3 unavailable in webhook dedup test');
	return stores;
}

function tempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'sw-webhook-dedup-'));
	tempDirs.push(dir);
	return join(dir, 'orders.db');
}
