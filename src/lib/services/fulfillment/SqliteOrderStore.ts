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
import type {
	ApplyStripeWebhookEventOnceInput,
	BeginRefundOnceInput,
	CompleteRefundInput,
	FailRefundInput,
	FulfillmentOrderStore,
	Order,
	QualityClaim,
	QualityClaimStore,
	RefundLedgerEntry,
	RefundLedgerResult,
	RefundResult,
	StripeWebhookApplyResult,
	TransitionLogEntry,
} from './types';

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
	orderStore: FulfillmentOrderStore;
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

interface RefundLedgerRow {
	orderId: string;
	claimId: string;
	refundKind: string;
	amountCents: number;
	currency: string;
	status: RefundResult['status'];
	stripeRefundId: string | null;
	stripePaymentIntentId: string;
	idempotencyKey: string;
	errorMessage: string | null;
	responseJson: string | null;
	createdAt: number;
	updatedAt: number;
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

const V2_DDL_SQL = `
CREATE TABLE IF NOT EXISTS processed_webhook_events (
	event_id TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	payment_intent_id TEXT,
	order_id TEXT,
	outcome TEXT NOT NULL,
	reason TEXT,
	processed_at INTEGER NOT NULL,
	FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_order_id
	ON processed_webhook_events(order_id);
CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_payment_intent_id
	ON processed_webhook_events(payment_intent_id);

CREATE TABLE IF NOT EXISTS refund_ledger (
	order_id TEXT NOT NULL,
	claim_id TEXT NOT NULL,
	refund_kind TEXT NOT NULL,
	amount_cents INTEGER NOT NULL,
	currency TEXT NOT NULL,
	status TEXT NOT NULL,
	stripe_refund_id TEXT,
	stripe_payment_intent_id TEXT,
	idempotency_key TEXT NOT NULL,
	error_message TEXT,
	response_json TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (order_id, claim_id, refund_kind),
	FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refund_ledger_status ON refund_ledger(status);
CREATE INDEX IF NOT EXISTS idx_refund_ledger_claim_id ON refund_ledger(claim_id);
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

const INSERT_WEBHOOK_EVENT_SQL = `
INSERT OR IGNORE INTO processed_webhook_events (
	event_id,
	type,
	payment_intent_id,
	outcome,
	processed_at
)
VALUES (?, ?, ?, 'processing', ?)`;

const UPDATE_WEBHOOK_EVENT_SQL = `
UPDATE processed_webhook_events
SET order_id = ?, outcome = ?, reason = ?
WHERE event_id = ?`;

const INSERT_REFUND_LEDGER_SQL = `
INSERT OR IGNORE INTO refund_ledger (
	order_id,
	claim_id,
	refund_kind,
	amount_cents,
	currency,
	status,
	stripe_payment_intent_id,
	idempotency_key,
	created_at,
	updated_at
)
VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`;

const SELECT_REFUND_LEDGER_SQL = `
SELECT
	order_id AS orderId,
	claim_id AS claimId,
	refund_kind AS refundKind,
	amount_cents AS amountCents,
	currency,
	status,
	stripe_refund_id AS stripeRefundId,
	stripe_payment_intent_id AS stripePaymentIntentId,
	idempotency_key AS idempotencyKey,
	error_message AS errorMessage,
	response_json AS responseJson,
	created_at AS createdAt,
	updated_at AS updatedAt
FROM refund_ledger
WHERE order_id = ? AND claim_id = ? AND refund_kind = ?`;

const COMPLETE_REFUND_LEDGER_SQL = `
UPDATE refund_ledger
SET
	status = ?,
	stripe_refund_id = ?,
	stripe_payment_intent_id = ?,
	error_message = NULL,
	response_json = ?,
	updated_at = ?
WHERE order_id = ? AND claim_id = ? AND refund_kind = ?`;

const FAIL_REFUND_LEDGER_SQL = `
UPDATE refund_ledger
SET
	status = 'failed',
	error_message = ?,
	response_json = NULL,
	updated_at = ?
WHERE order_id = ? AND claim_id = ? AND refund_kind = ?`;

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

export class SqliteOrderStore implements FulfillmentOrderStore {
	private readonly putTxn: (order: Order) => void;
	private readonly applyWebhookTxn: (
		input: ApplyStripeWebhookEventOnceInput,
	) => StripeWebhookApplyResult;
	private readonly beginRefundTxn: (input: BeginRefundOnceInput) => RefundLedgerResult;
	private readonly completeRefundTxn: (input: CompleteRefundInput) => RefundLedgerEntry;
	private readonly failRefundTxn: (input: FailRefundInput) => RefundLedgerEntry;
	private readonly getByIdStmt;
	private readonly listByParentStmt;
	private readonly getByStripeStmt;
	private readonly getByLuluStmt;
	private readonly getRefundLedgerStmt;

	constructor(db: SqliteDatabase) {
		const upsertOrder = db.prepare(UPSERT_ORDER_SQL);
		const deleteTransitions = db.prepare(DELETE_TRANSITIONS_SQL);
		const insertTransition = db.prepare(INSERT_TRANSITION_SQL);
		const insertWebhookEvent = db.prepare(INSERT_WEBHOOK_EVENT_SQL);
		const updateWebhookEvent = db.prepare(UPDATE_WEBHOOK_EVENT_SQL);
		const insertRefundLedger = db.prepare(INSERT_REFUND_LEDGER_SQL);
		const completeRefundLedger = db.prepare(COMPLETE_REFUND_LEDGER_SQL);
		const failRefundLedger = db.prepare(FAIL_REFUND_LEDGER_SQL);
		const writeOrder = (order: Order) => {
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
		};
		this.getByIdStmt = db.prepare(SELECT_ORDER_BY_ID_SQL);
		this.listByParentStmt = db.prepare(SELECT_ORDERS_BY_PARENT_SQL);
		this.getByStripeStmt = db.prepare(SELECT_ORDER_BY_STRIPE_SQL);
		this.getByLuluStmt = db.prepare(SELECT_ORDER_BY_LULU_SQL);
		this.getRefundLedgerStmt = db.prepare(SELECT_REFUND_LEDGER_SQL);
		this.putTxn = db.transaction((order: Order) => {
			writeOrder(order);
		});
		this.applyWebhookTxn = db.transaction((input: ApplyStripeWebhookEventOnceInput): StripeWebhookApplyResult => {
			const inserted = insertWebhookEvent.run(
				input.eventId,
				input.eventType,
				input.paymentIntentId,
				input.at,
			);
			if (inserted.changes === 0) {
				return { outcome: 'duplicate' };
			}

			const row = this.getByStripeStmt.get(input.paymentIntentId) as JsonRow | undefined;
			if (!row) {
				updateWebhookEvent.run(null, 'ignored', 'unknown_payment_intent', input.eventId);
				return { outcome: 'ignored', reason: 'unknown_payment_intent' };
			}

			const order = parseOrder(row);
			if (input.expectedState && order.state !== input.expectedState) {
				updateWebhookEvent.run(order.id, 'ignored', 'state_mismatch', input.eventId);
				return {
					outcome: 'ignored',
					reason: 'state_mismatch',
					order,
					currentState: order.state,
				};
			}

			const to = input.toState ?? order.state;
			const entry: TransitionLogEntry = {
				from: order.state,
				to,
				at: input.at,
				actor: input.actor,
				reason: input.reason,
				meta: input.meta,
			};
			const next: Order = {
				...order,
				state: to,
				transitions: [...order.transitions, entry],
				updatedAt: input.at,
			};

			writeOrder(next);
			updateWebhookEvent.run(order.id, 'applied', null, input.eventId);
			return {
				outcome: 'applied',
				order: next,
				previousState: order.state,
				currentState: next.state,
			};
		});
		this.beginRefundTxn = db.transaction((input: BeginRefundOnceInput): RefundLedgerResult => {
			const inserted = insertRefundLedger.run(
				input.orderId,
				input.claimId,
				input.refundKind,
				input.amountCents,
				input.currency,
				input.stripePaymentIntentId,
				input.idempotencyKey,
				input.at,
				input.at,
			);
			const entry = this.readRefundLedgerEntry(input.orderId, input.claimId, input.refundKind);
			if (!entry) throw new Error('refund ledger insert failed');
			return { outcome: inserted.changes === 0 ? 'existing' : 'started', entry };
		});
		this.completeRefundTxn = db.transaction((input: CompleteRefundInput): RefundLedgerEntry => {
			const updated = completeRefundLedger.run(
				input.result.status,
				input.result.id,
				input.result.paymentIntentId,
				JSON.stringify(input.result),
				input.at,
				input.orderId,
				input.claimId,
				input.refundKind,
			);
			if (updated.changes === 0) throw new Error('refund ledger entry not found');
			const entry = this.readRefundLedgerEntry(input.orderId, input.claimId, input.refundKind);
			if (!entry) throw new Error('refund ledger update failed');
			return entry;
		});
		this.failRefundTxn = db.transaction((input: FailRefundInput): RefundLedgerEntry => {
			const updated = failRefundLedger.run(
				input.errorMessage,
				input.at,
				input.orderId,
				input.claimId,
				input.refundKind,
			);
			if (updated.changes === 0) throw new Error('refund ledger entry not found');
			const entry = this.readRefundLedgerEntry(input.orderId, input.claimId, input.refundKind);
			if (!entry) throw new Error('refund ledger update failed');
			return entry;
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

	async applyStripeWebhookEventOnce(
		input: ApplyStripeWebhookEventOnceInput,
	): Promise<StripeWebhookApplyResult> {
		return this.applyWebhookTxn(input);
	}

	async beginRefundOnce(input: BeginRefundOnceInput): Promise<RefundLedgerResult> {
		return this.beginRefundTxn(input);
	}

	async completeRefund(input: CompleteRefundInput): Promise<RefundLedgerEntry> {
		return this.completeRefundTxn(input);
	}

	async failRefund(input: FailRefundInput): Promise<RefundLedgerEntry> {
		return this.failRefundTxn(input);
	}

	async getRefundLedgerEntry(
		orderId: string,
		claimId: string,
		refundKind: string,
	): Promise<RefundLedgerEntry | undefined> {
		return this.readRefundLedgerEntry(orderId, claimId, refundKind);
	}

	private readRefundLedgerEntry(
		orderId: string,
		claimId: string,
		refundKind: string,
	): RefundLedgerEntry | undefined {
		const row = this.getRefundLedgerStmt.get(orderId, claimId, refundKind) as
			| RefundLedgerRow
			| undefined;
		return row ? parseRefundLedgerEntry(row) : undefined;
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
		if (version > 2) {
			throw new Error(`SqliteOrderStore: database schema version ${version} is newer than supported v2`);
		}
		if (version === 0) {
			db.exec(V1_DDL_SQL);
		}
		if (version < 2) {
			db.exec(V2_DDL_SQL);
			db.prepare(UPSERT_VERSION_SQL).run('version', '2');
		}
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

function parseRefundLedgerEntry(row: RefundLedgerRow): RefundLedgerEntry {
	return {
		orderId: row.orderId,
		claimId: row.claimId,
		refundKind: row.refundKind,
		amountCents: row.amountCents,
		currency: row.currency,
		status: row.status,
		stripeRefundId: row.stripeRefundId ?? undefined,
		stripePaymentIntentId: row.stripePaymentIntentId,
		idempotencyKey: row.idempotencyKey,
		errorMessage: row.errorMessage ?? undefined,
		response: row.responseJson ? (JSON.parse(row.responseJson) as RefundResult) : undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
