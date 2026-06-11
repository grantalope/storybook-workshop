// tests/fulfillment/store-factory.test.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createDefaultFulfillmentStores,
	createSqliteStores,
	detectStoreRuntime,
	sqliteAvailable,
} from '$lib/services/fulfillment';

const tempDirs: string[] = [];
const sqliteIt = sqliteAvailable() ? it : it.skip;

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('fulfillment store factory', () => {
	it('detects vitest and keeps default stores in memory without warnings', () => {
		const warnings: string[] = [];
		expect(detectStoreRuntime()).toBe('vitest');

		const stores = createDefaultFulfillmentStores({ warn: (message) => warnings.push(message) });
		try {
			expect(stores.kind).toBe('memory');
			expect(warnings).toEqual([]);
		} finally {
			stores.close();
		}
	});

	it('treats an injected non-test env as node production when process is present', () => {
		expect(detectStoreRuntime({ NODE_ENV: 'production' })).toBe('node-prod');
	});

	sqliteIt('uses sqlite stores in node-prod when better-sqlite3 is available', () => {
		const stores = createDefaultFulfillmentStores({
			runtime: 'node-prod',
			dbPath: tempDbPath(),
		});
		try {
			expect(stores.kind).toBe('sqlite');
			expect(stores.dbPath).toMatch(/orders\.db$/);
		} finally {
			stores.close();
		}
	});

	it('falls back to memory and warns exactly once when sqlite is unavailable', () => {
		const warnings: string[] = [];
		const stores = createDefaultFulfillmentStores({
			runtime: 'node-prod',
			sqlite: null,
			warn: (message) => warnings.push(message),
		});
		try {
			expect(stores.kind).toBe('memory');
			expect(warnings).toEqual([
				'[fulfillment] better-sqlite3 unavailable — orders are NOT durable',
			]);
		} finally {
			stores.close();
		}
	});

	it('direct sqlite creation reports the native-load reason when unavailable', () => {
		const warnings: string[] = [];
		const stores = createSqliteStores({
			dbPath: tempDbPath(),
			sqlite: null,
			warn: (message) => warnings.push(message),
		});

		expect(stores).toBeNull();
		expect(warnings).toEqual([
			'[fulfillment] better-sqlite3 unavailable: forced unavailable by caller',
		]);
	});
});

function tempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'sw-store-factory-'));
	tempDirs.push(dir);
	return join(dir, 'orders.db');
}
