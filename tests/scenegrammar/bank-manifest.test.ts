import { describe, expect, it } from 'vitest';

import {
	coverageReport,
	findAsset,
	loadBankManifest,
} from '$lib/services/scenegrammar';
import type { BankAssetQuery } from '$lib/services/scenegrammar';

const manifestJson = {
	version: 1,
	bankRoot: '/bank',
	entries: [
		{
			assetId: 'bg-1',
			layer: 'A',
			styleId: 'opaque-style',
			locale: 'forest',
			beatMood: 'setup',
			file: 'bg-1.png',
			seed: 11,
			generatedAtIso: '2026-06-11T00:00:00.000Z',
		},
		{
			assetId: 'hero-1',
			layer: 'B',
			styleId: 'opaque-style',
			archetypeId: 'hero-fox',
			poseClass: 'walking',
			file: 'hero-1.png',
			seed: 12,
			qcSimilarity: 0.93,
			generatedAtIso: '2026-06-11T00:00:00.000Z',
		},
	],
};

describe('scenegrammar bank manifest store', () => {
	it('loads a valid manifest structurally', () => {
		const manifest = loadBankManifest(manifestJson);
		expect(manifest.version).toBe(1);
		expect(manifest.entries).toHaveLength(2);
		expect(manifest.entries[1].qcSimilarity).toBe(0.93);
	});

	it('throws with the offending path for malformed entries', () => {
		const malformed = {
			version: 1,
			bankRoot: '/bank',
			entries: [{ assetId: 'missing-file', layer: 'A', styleId: 's', seed: 1, generatedAtIso: 'iso' }],
		};
		expect(() => loadBankManifest(malformed)).toThrow(/entries\[0\]\.file/);
	});

	it('finds assets by exact defined query fields', () => {
		const manifest = loadBankManifest(manifestJson);
		const query: BankAssetQuery = {
			layer: 'B',
			styleId: 'opaque-style',
			archetypeId: 'hero-fox',
			poseClass: 'walking',
		};
		expect(findAsset(manifest, query)?.assetId).toBe('hero-1');
	});

	it('returns null on exact-match miss', () => {
		const manifest = loadBankManifest(manifestJson);
		expect(findAsset(manifest, { layer: 'B', styleId: 'opaque-style', archetypeId: 'missing' })).toBeNull();
	});

	it('reports coverage ratio and missing queries', () => {
		const manifest = loadBankManifest(manifestJson);
		const covered: BankAssetQuery = { layer: 'A', styleId: 'opaque-style', locale: 'forest', beatMood: 'setup' };
		const missing: BankAssetQuery = { layer: 'C', styleId: 'opaque-style', propId: 'lantern' };
		const report = coverageReport(manifest, [covered, missing]);
		expect(report.covered).toBe(1);
		expect(report.coverageRatio).toBe(0.5);
		expect(report.missing).toEqual([missing]);
	});
});
