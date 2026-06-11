// tests/fulfillment/sqlite-order-store.test.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createSqliteStores,
	sqliteAvailable,
	type Order,
	type QualityClaim,
	type SqliteStores,
	type TransitionLogEntry,
} from '$lib/services/fulfillment';
import type DatabaseConstructor from 'better-sqlite3';
import { makeOrder } from './fixtures';

type RawDatabase = DatabaseConstructor.Database;

const require = createRequire(import.meta.url);
const sqliteDescribe = sqliteAvailable() ? describe : describe.skip;
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

sqliteDescribe('SqliteOrderStore', () => {
	it('put/get roundtrips the full serialized order', async () => {
		const stores = openStores();
		try {
			const order = makeOrder({
				id: 'ord_roundtrip',
				stripePaymentIntentId: 'pi_roundtrip',
				luluJobId: 'lj_roundtrip',
				trackingUrl: 'https://track.example/1',
			});
			await stores.orderStore.put(order);
			await expect(stores.orderStore.get(order.id)).resolves.toEqual(order);
		} finally {
			stores.close();
		}
	});

	it('get returns undefined for an unknown order id', async () => {
		const stores = openStores();
		try {
			await expect(stores.orderStore.get('ord_missing')).resolves.toBeUndefined();
		} finally {
			stores.close();
		}
	});

	it('put twice keeps one order row and the latest lookup columns', async () => {
		const stores = openStores();
		try {
			const order = makeOrder({
				id: 'ord_update',
				state: 'pending_payment',
				updatedAt: 1_700_000_000_000,
				stripePaymentIntentId: 'pi_old',
			});
			await stores.orderStore.put(order);
			const updated = {
				...order,
				state: 'paid' as const,
				updatedAt: order.updatedAt + 1000,
				stripePaymentIntentId: 'pi_new',
			};
			await stores.orderStore.put(updated);

			await expect(stores.orderStore.get(order.id)).resolves.toEqual(updated);
			expect(readScalar(stores.dbPath, 'SELECT count(*) AS value FROM orders WHERE id = ?', order.id)).toBe(1);
			expect(readScalar(stores.dbPath, 'SELECT updated_at AS value FROM orders WHERE id = ?', order.id)).toBe(
				updated.updatedAt,
			);
			await expect(stores.orderStore.getByStripePaymentIntent('pi_new')).resolves.toEqual(updated);
			await expect(stores.orderStore.getByStripePaymentIntent('pi_old')).resolves.toBeUndefined();
		} finally {
			stores.close();
		}
	});

	it('listByParent returns only orders for the requested parent email', async () => {
		const stores = openStores();
		try {
			const eli = makeOrder({ id: 'ord_eli', parentEmail: 'eli@example.com', updatedAt: 1 });
			const zoe = makeOrder({ id: 'ord_zoe', parentEmail: 'zoe@example.com', updatedAt: 2 });
			const eli2 = makeOrder({ id: 'ord_eli_2', parentEmail: 'eli@example.com', updatedAt: 3 });
			await stores.orderStore.put(eli);
			await stores.orderStore.put(zoe);
			await stores.orderStore.put(eli2);

			const ids = (await stores.orderStore.listByParent('eli@example.com')).map((order) => order.id);
			expect(ids).toEqual(['ord_eli', 'ord_eli_2']);
		} finally {
			stores.close();
		}
	});

	it('getByStripePaymentIntent finds the matching order', async () => {
		const stores = openStores();
		try {
			const order = makeOrder({ id: 'ord_stripe', stripePaymentIntentId: 'pi_match' });
			await stores.orderStore.put(order);
			await stores.orderStore.put(makeOrder({ id: 'ord_other', stripePaymentIntentId: 'pi_other' }));
			await expect(stores.orderStore.getByStripePaymentIntent('pi_match')).resolves.toEqual(order);
		} finally {
			stores.close();
		}
	});

	it('getByLuluJob finds the matching order', async () => {
		const stores = openStores();
		try {
			const order = makeOrder({ id: 'ord_lulu', luluJobId: 'lj_match' });
			await stores.orderStore.put(order);
			await stores.orderStore.put(makeOrder({ id: 'ord_other', luluJobId: 'lj_other' }));
			await expect(stores.orderStore.getByLuluJob('lj_match')).resolves.toEqual(order);
		} finally {
			stores.close();
		}
	});

	it('persists transition rows and replaces them on re-put', async () => {
		const stores = openStores();
		try {
			const order = makeOrder({ id: 'ord_transitions' });
			await stores.orderStore.put(order);
			expect(transitionCount(stores.dbPath, order.id)).toBe(1);

			const paid = appendTransition(order, {
				from: 'pending_payment',
				to: 'paid',
				at: order.updatedAt + 1000,
				actor: 'system',
				reason: 'stripe_payment_intent_succeeded',
			});
			await stores.orderStore.put(paid);
			expect(transitionCount(stores.dbPath, order.id)).toBe(2);

			await stores.orderStore.put({ ...paid, transitions: [paid.transitions[0]], updatedAt: paid.updatedAt + 1 });
			expect(transitionCount(stores.dbPath, order.id)).toBe(1);
		} finally {
			stores.close();
		}
	});

	it('rolls back the order upsert when a transition constraint fails', async () => {
		const stores = openStores();
		try {
			const original = makeOrder({ id: 'ord_atomic', updatedAt: 1_700_000_000_000 });
			await stores.orderStore.put(original);
			const invalidTransition = {
				from: 'pending_payment',
				to: null,
				at: original.updatedAt + 1000,
				actor: 'system',
			} as unknown as TransitionLogEntry;
			const invalid: Order = {
				...original,
				state: 'paid',
				updatedAt: original.updatedAt + 1000,
				transitions: [...original.transitions, invalidTransition],
			};

			await expect(stores.orderStore.put(invalid)).rejects.toThrow();
			await expect(stores.orderStore.get(original.id)).resolves.toEqual(original);
			expect(transitionCount(stores.dbPath, original.id)).toBe(original.transitions.length);
		} finally {
			stores.close();
		}
	});

	it('persists orders across close and reopen on the same db path', async () => {
		const dbPath = tempDbPath();
		const first = openStores(dbPath);
		const order = makeOrder({ id: 'ord_restart' });
		await first.orderStore.put(order);
		first.close();

		const second = openStores(dbPath);
		try {
			await expect(second.orderStore.get(order.id)).resolves.toEqual(order);
		} finally {
			second.close();
		}
	});

	it('enables WAL journal mode', () => {
		const stores = openStores();
		try {
			expect(readPragma(stores.dbPath, 'journal_mode')).toBe('wal');
		} finally {
			stores.close();
		}
	});

	it('auto-creates nested directories for the db path', () => {
		const base = tempDir();
		const dbPath = join(base, 'one', 'two', 'orders.db');
		const stores = openStores(dbPath);
		try {
			expect(dirname(stores.dbPath)).toBe(join(base, 'one', 'two'));
			expect(readScalar(stores.dbPath, 'SELECT count(*) AS value FROM schema_meta')).toBe(1);
		} finally {
			stores.close();
		}
	});

	it('honors ORDER_DB_PATH from injected env', () => {
		const dbPath = tempDbPath();
		const stores = createSqliteStores({ env: { ORDER_DB_PATH: dbPath } });
		expect(stores).not.toBeNull();
		try {
			expect(stores?.dbPath).toBe(dbPath);
			expect(readScalar(dbPath, 'SELECT count(*) AS value FROM schema_meta')).toBe(1);
		} finally {
			stores?.close();
		}
	});

	it('roundtrips quality claims', async () => {
		const stores = openStores();
		try {
			const claim = makeClaim({ id: 'claim_roundtrip', decision: 'pending' });
			await stores.qualityClaimStore.put(claim);
			await expect(stores.qualityClaimStore.get(claim.id)).resolves.toEqual(claim);
		} finally {
			stores.close();
		}
	});

	it('maps quality claim status to claim.decision and lists only pending claims', async () => {
		const stores = openStores();
		try {
			const pending = makeClaim({ id: 'claim_pending', decision: 'pending', claimTs: 10 });
			const approved = makeClaim({
				id: 'claim_approved',
				decision: 'approved_reprint',
				decisionAt: 20,
			});
			await stores.qualityClaimStore.put(pending);
			await stores.qualityClaimStore.put(approved);

			const pendingIds = (await stores.qualityClaimStore.listPending()).map((claim) => claim.id);
			expect(pendingIds).toEqual(['claim_pending']);
			expect(readText(stores.dbPath, 'SELECT status AS value FROM quality_claims WHERE id = ?', approved.id)).toBe(
				'approved_reprint',
			);
		} finally {
			stores.close();
		}
	});
});

function openStores(dbPath = tempDbPath()): SqliteStores {
	const stores = createSqliteStores({ dbPath });
	if (!stores) throw new Error('better-sqlite3 unavailable in sqlite-order-store test');
	return stores;
}

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'sw-orderstore-'));
	tempDirs.push(dir);
	return dir;
}

function tempDbPath(): string {
	return join(tempDir(), 'orders.db');
}

function openRaw(dbPath: string): RawDatabase {
	const Database = require('better-sqlite3') as typeof DatabaseConstructor;
	return new Database(dbPath);
}

function readScalar(dbPath: string, sql: string, ...params: unknown[]): number {
	const db = openRaw(dbPath);
	try {
		const row = db.prepare(sql).get(...params) as { value: number };
		return row.value;
	} finally {
		db.close();
	}
}

function readText(dbPath: string, sql: string, ...params: unknown[]): string {
	const db = openRaw(dbPath);
	try {
		const row = db.prepare(sql).get(...params) as { value: string };
		return row.value;
	} finally {
		db.close();
	}
}

function readPragma(dbPath: string, name: string): string {
	const db = openRaw(dbPath);
	try {
		return db.pragma(name, { simple: true }) as string;
	} finally {
		db.close();
	}
}

function transitionCount(dbPath: string, orderId: string): number {
	return readScalar(dbPath, 'SELECT count(*) AS value FROM transitions WHERE order_id = ?', orderId);
}

function appendTransition(order: Order, entry: TransitionLogEntry): Order {
	return {
		...order,
		state: entry.to,
		updatedAt: entry.at,
		transitions: [...order.transitions, entry],
	};
}

function makeClaim(overrides: Partial<QualityClaim> = {}): QualityClaim {
	return {
		id: 'claim_test',
		orderId: 'ord_test_1',
		category: 'defect',
		photoUrls: ['https://example.com/photo.jpg'],
		parentText: 'The cover is damaged.',
		claimTs: 1_700_000_000_000,
		decision: 'pending',
		...overrides,
	};
}
