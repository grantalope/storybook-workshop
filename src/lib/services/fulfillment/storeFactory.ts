// @graph-layer: private
// @rationale: private (fulfillment persistence default wiring)
//
// src/lib/services/fulfillment/storeFactory.ts

import {
	createSqliteStores,
	type SqliteStoreOptions,
	type SqliteStores,
} from './SqliteOrderStore';
import { InMemoryOrderStore } from './OrderLifecycleService';
import { InMemoryQualityClaimStore } from './QualityGuaranteeHandler';
import type { QualityClaimStore, WebhookOrderStore } from './types';

export type StoreRuntime = 'node-prod' | 'vitest' | 'browser';

export interface DefaultFulfillmentStores {
	orderStore: WebhookOrderStore;
	qualityClaimStore: QualityClaimStore;
	kind: 'sqlite' | 'memory';
	close(): void;
	dbPath?: string;
}

export interface DefaultFulfillmentStoreOptions extends SqliteStoreOptions {
	runtime?: StoreRuntime;
}

const SQLITE_UNAVAILABLE_WARNING =
	'[fulfillment] better-sqlite3 unavailable — orders are NOT durable';

export function detectStoreRuntime(env = processEnvSafe()): StoreRuntime {
	const useImportMeta = arguments.length === 0;
	if (
		isTruthy(env.VITEST) ||
		isTruthy(env.TEST) ||
		env.NODE_ENV === 'test' ||
		(useImportMeta && importMetaTest())
	) {
		return 'vitest';
	}
	if (!hasNodeProcess()) return 'browser';
	return 'node-prod';
}

export function createDefaultFulfillmentStores(
	opts: DefaultFulfillmentStoreOptions = {},
): DefaultFulfillmentStores {
	const runtime = opts.runtime ?? detectStoreRuntime(opts.env);
	if (runtime !== 'node-prod') return createMemoryStores();

	const stores = createSqliteStores({
		...opts,
		suppressUnavailableWarning: true,
	});
	if (stores) return createSqliteResult(stores);

	const warn = opts.warn ?? console.warn;
	warn(SQLITE_UNAVAILABLE_WARNING);
	return createMemoryStores();
}

function createSqliteResult(stores: SqliteStores): DefaultFulfillmentStores {
	return {
		orderStore: stores.orderStore,
		qualityClaimStore: stores.qualityClaimStore,
		kind: 'sqlite',
		close: stores.close,
		dbPath: stores.dbPath,
	};
}

function createMemoryStores(): DefaultFulfillmentStores {
	return {
		orderStore: new InMemoryOrderStore(),
		qualityClaimStore: new InMemoryQualityClaimStore(),
		kind: 'memory',
		close() {},
	};
}

function processEnvSafe(): Record<string, string | undefined> {
	return typeof process !== 'undefined' ? process.env : {};
}

function hasNodeProcess(): boolean {
	return (
		typeof process !== 'undefined' &&
		typeof process.versions === 'object' &&
		typeof process.versions.node === 'string'
	);
}

function importMetaTest(): boolean {
	const meta = import.meta as ImportMeta & { env?: Record<string, unknown> };
	return isTruthy(meta.env?.TEST);
}

function isTruthy(value: unknown): boolean {
	return value === true || value === 'true' || value === '1';
}
