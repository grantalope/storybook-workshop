// @graph-layer: private
// @rationale: private (durable order + quality-claim persistence)
//
// src/lib/services/fulfillment/SqliteOrderStore.ts
//
// SQLite-backed OrderStore and QualityClaimStore implementations. The native
// dependency is loaded lazily so browser/test bundles can still import the
// fulfillment barrel when better-sqlite3 is not present.

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type DatabaseConstructor from 'better-sqlite3';
import type { Order, OrderStore, QualityClaim, QualityClaimStore } from './types';

type SqliteDatabase = DatabaseConstructor.Database;
type SqliteDatabaseConstructor = typeof DatabaseConstructor;

export interface SqliteStoreOptions {
	dbPath?: string;
	env?: Record<string, string | undefined>;
	sqlite?: SqliteDatabaseConstructor | null;
	warn?: (message: string) => void;
	suppressUnavailableWarning?: boolean;
}

export interface SqliteStores {
	orderStore: OrderStore;
	qualityClaimStore: QualityClaimStore;
	close(): void;
	dbPath: string;
}

interface JsonRow {
	json: string;
}

interface VersionRow {
	value: string;
}

const DEFAULT_DB_PATH = './data/orders.db';

const CREATE_SCHEMA_META_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
)`;

const V1_DDL_SQL = `
CREATE TABLE IF NOT EXISTS orders (
	id TEXT PRIMARY KEY,
	state TEXT NOT NULL,
	parent_email TEXT NOT NULL,
	stripe_payment_intent_id TEXT,
	lulu_job_id TEXT,
	json TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_parent_email ON orders(parent_email);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent_id ON orders(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_orders_lulu_job_id ON orders(lulu_job_id);

CREATE TABLE IF NOT EXISTS transitions (
	order_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	from_state TEXT,
	to_state TEXT NOT NULL,
	at INTEGER NOT NULL,
	json TEXT NOT NULL,
	PRIMARY KEY (order_id, seq),
	FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quality_claims (
	id TEXT PRIMARY KEY,
	order_id TEXT,
	status TEXT NOT NULL,
	json TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_claims_status ON quality_claims(status);
`;

const SELECT_VERSION_SQL = 'SELECT value FROM schema_meta WHERE key = ?';
const UPSERT_VERSION_SQL = `
INSERT INTO schema_meta (key, value)
VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

const UPSERT_ORDER_SQL = `
INSERT INTO orders (
	id,
	state,
	parent_email,
	stripe_payment_intent_id,
	lulu_job_id,
	json,
	updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
	state = excluded.state,
	parent_email = excluded.parent_email,
	stripe_payment_intent_id = excluded.stripe_payment_intent_id,
	lulu_job_id = excluded.lulu_job_id,
	json = excluded.json,
	updated_at = excluded.updated_at`;

const DELETE_TRANSITIONS_SQL = 'DELETE FROM transitions WHERE order_id = ?';
const INSERT_TRANSITION_SQL = `
INSERT INTO transitions (order_id, seq, from_state, to_state, at, json)
VALUES (?, ?, ?, ?, ?, ?)`;

const SELECT_ORDER_BY_ID_SQL = 'SELECT json FROM orders WHERE id = ?';
const SELECT_ORDERS_BY_PARENT_SQL =
	'SELECT json FROM orders WHERE parent_email = ? ORDER BY updated_at ASC, id ASC';
const SELECT_ORDER_BY_STRIPE_SQL =
	'SELECT json FROM orders WHERE stripe_payment_intent_id = ?';
const SELECT_ORDER_BY_LULU_SQL = 'SELECT json FROM orders WHERE lulu_job_id = ?';

const UPSERT_CLAIM_SQL = `
INSERT INTO quality_claims (id, order_id, status, json, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
	order_id = excluded.order_id,
	status = excluded.status,
	json = excluded.json,
	updated_at = excluded.updated_at`;

const SELECT_CLAIM_BY_ID_SQL = 'SELECT json FROM quality_claims WHERE id = ?';
const SELECT_PENDING_CLAIMS_SQL =
	"SELECT json FROM quality_claims WHERE status = 'pending' ORDER BY updated_at ASC, id ASC";

export function sqliteAvailable(): boolean {
	return loadSqliteModule().Database !== null;
}

export function createSqliteStores(opts: SqliteStoreOptions = {}): SqliteStores | null {
	const load = resolveSqliteModule(opts);
	if (!load.Database) {
		if (!opts.suppressUnavailableWarning) {
			const warn = opts.warn ?? console.warn;
			warn(`[fulfillment] better-sqlite3 unavailable: ${load.reason ?? 'unknown load failure'}`);
		}
		return null;
	}

	const env = opts.env ?? getProcessEnv();
	const dbPath = opts.dbPath ?? env.ORDER_DB_PATH ?? DEFAULT_DB_PATH;
	mkdirSync(dirname(dbPath), { recursive: true });

	const db = new load.Database(dbPath);
	let configured = false;
	try {
		configureDatabase(db);
		migrateDatabase(db);
		configured = true;
		return {
			orderStore: new SqliteOrderStore(db),
			qualityClaimStore: new SqliteQualityClaimStore(db),
			close: makeClose(db),
			dbPath,
		};
	} finally {
		if (!configured) {
			db.close();
		}
	}
}

export class SqliteOrderStore implements OrderStore {
	private readonly putTxn: (order: Order) => void;
	private readonly getByIdStmt;
	private readonly listByParentStmt;
	private readonly getByStripeStmt;
	private readonly getByLuluStmt;

	constructor(db: SqliteDatabase) {
		const upsertOrder = db.prepare(UPSERT_ORDER_SQL);
		const deleteTransitions = db.prepare(DELETE_TRANSITIONS_SQL);
		const insertTransition = db.prepare(INSERT_TRANSITION_SQL);
		this.getByIdStmt = db.prepare(SELECT_ORDER_BY_ID_SQL);
		this.listByParentStmt = db.prepare(SELECT_ORDERS_BY_PARENT_SQL);
		this.getByStripeStmt = db.prepare(SELECT_ORDER_BY_STRIPE_SQL);
		this.getByLuluStmt = db.prepare(SELECT_ORDER_BY_LULU_SQL);
		this.putTxn = db.transaction((order: Order) => {
			upsertOrder.run(
				order.id,
				order.state,
				order.parentEmail,
				order.stripePaymentIntentId ?? null,
				order.luluJobId ?? null,
				JSON.stringify(order),
				order.updatedAt,
			);
			deleteTransitions.run(order.id);
			order.transitions.forEach((entry, seq) => {
				insertTransition.run(
					order.id,
					seq,
					entry.from ?? null,
					entry.to,
					entry.at,
					JSON.stringify(entry),
				);
			});
		});
	}

	async get(id: string): Promise<Order | undefined> {
		const row = this.getByIdStmt.get(id) as JsonRow | undefined;
		return row ? parseOrder(row) : undefined;
	}

	async put(order: Order): Promise<void> {
		this.putTxn(order);
	}

	async listByParent(email: string): Promise<Order[]> {
		return (this.listByParentStmt.all(email) as JsonRow[]).map(parseOrder);
	}

	async getByStripePaymentIntent(id: string): Promise<Order | undefined> {
		const row = this.getByStripeStmt.get(id) as JsonRow | undefined;
		return row ? parseOrder(row) : undefined;
	}

	async getByLuluJob(id: string): Promise<Order | undefined> {
		const row = this.getByLuluStmt.get(id) as JsonRow | undefined;
		return row ? parseOrder(row) : undefined;
	}
}

export class SqliteQualityClaimStore implements QualityClaimStore {
	private readonly putTxn: (claim: QualityClaim) => void;
	private readonly getByIdStmt;
	private readonly listPendingStmt;

	constructor(db: SqliteDatabase) {
		const upsertClaim = db.prepare(UPSERT_CLAIM_SQL);
		this.getByIdStmt = db.prepare(SELECT_CLAIM_BY_ID_SQL);
		this.listPendingStmt = db.prepare(SELECT_PENDING_CLAIMS_SQL);
		this.putTxn = db.transaction((claim: QualityClaim) => {
			upsertClaim.run(
				claim.id,
				claim.orderId,
				claim.decision,
				JSON.stringify(claim),
				claim.decisionAt ?? claim.claimTs,
			);
		});
	}

	async get(id: string): Promise<QualityClaim | undefined> {
		const row = this.getByIdStmt.get(id) as JsonRow | undefined;
		return row ? parseClaim(row) : undefined;
	}

	async put(claim: QualityClaim): Promise<void> {
		this.putTxn(claim);
	}

	async listPending(): Promise<QualityClaim[]> {
		return (this.listPendingStmt.all() as JsonRow[]).map(parseClaim);
	}
}

function resolveSqliteModule(opts: SqliteStoreOptions): {
	Database: SqliteDatabaseConstructor | null;
	reason?: string;
} {
	if ('sqlite' in opts) {
		return opts.sqlite
			? { Database: opts.sqlite }
			: { Database: null, reason: 'forced unavailable by caller' };
	}
	return loadSqliteModule();
}

function loadSqliteModule(): { Database: SqliteDatabaseConstructor | null; reason?: string } {
	try {
		const require = createRequire(import.meta.url);
		const loaded = require('better-sqlite3') as
			| SqliteDatabaseConstructor
			| { default?: SqliteDatabaseConstructor };
		const Database =
			typeof loaded === 'function' ? loaded : typeof loaded.default === 'function' ? loaded.default : null;
		if (!Database) return { Database: null, reason: 'module did not export a database constructor' };
		return { Database };
	} catch (e) {
		return { Database: null, reason: e instanceof Error ? e.message : String(e) };
	}
}

function getProcessEnv(): Record<string, string | undefined> {
	return typeof process !== 'undefined' ? process.env : {};
}

function configureDatabase(db: SqliteDatabase): void {
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
}

function migrateDatabase(db: SqliteDatabase): void {
	const migrate = db.transaction(() => {
		db.exec(CREATE_SCHEMA_META_SQL);
		const versionRow = db.prepare(SELECT_VERSION_SQL).get('version') as VersionRow | undefined;
		const version = versionRow ? Number(versionRow.value) : 0;
		if (version > 1) {
			throw new Error(`SqliteOrderStore: database schema version ${version} is newer than supported v1`);
		}
		if (version === 1) return;
		db.exec(V1_DDL_SQL);
		db.prepare(UPSERT_VERSION_SQL).run('version', '1');
	});
	migrate();
}

function makeClose(db: SqliteDatabase): () => void {
	let closed = false;
	return () => {
		if (closed) return;
		closed = true;
		db.close();
	};
}

function parseOrder(row: JsonRow): Order {
	return JSON.parse(row.json) as Order;
}

function parseClaim(row: JsonRow): QualityClaim {
	return JSON.parse(row.json) as QualityClaim;
}
