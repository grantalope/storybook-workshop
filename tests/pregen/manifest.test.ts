import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	buildManifest,
	coverageReport,
	scanSidecars,
	writeManifestAndReport,
} from '../../scripts/pregen/lib/manifest.mjs';

async function tempDir() {
	return mkdtemp(join(tmpdir(), 'pregen-manifest-'));
}

async function mkdtemp(prefix: string) {
	const { mkdtemp: realMkdtemp } = await import('node:fs/promises');
	return realMkdtemp(prefix);
}

async function writeSidecar(bank: string, entry: Record<string, unknown>) {
	const file = join(bank, `${entry.assetId as string}.png.json`);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(entry, null, 2)}\n`);
}

describe('pregen manifest builder', () => {
	it('scans sidecars into a sorted manifest with layer counts', async () => {
		const bank = await tempDir();
		try {
			await writeSidecar(bank, {
				assetId: 'propC/lantern/s1',
				layer: 'C',
				styleId: 's1',
				propId: 'lantern',
				file: 'propC/lantern/s1.png',
				seed: 2,
				generatedAtIso: '2026-06-11T00:00:00.000Z',
			});
			await writeSidecar(bank, {
				assetId: 'plateA/forest/setup/s1',
				layer: 'A',
				styleId: 's1',
				locale: 'forest',
				beatMood: 'setup',
				file: 'plateA/forest/setup/s1.png',
				seed: 1,
				generatedAtIso: '2026-06-11T00:00:00.000Z',
			});

			const manifest = buildManifest(bank, await scanSidecars(bank));
			expect(manifest.entries.map((entry) => entry.assetId)).toEqual([
				'plateA/forest/setup/s1',
				'propC/lantern/s1',
			]);
			const report = coverageReport(manifest.entries, manifest.entries);
			expect(report.perLayer.A.present).toBe(1);
			expect(report.perLayer.C.present).toBe(1);
			expect(report.coverageRatio).toBe(1);
		} finally {
			await rm(bank, { recursive: true, force: true });
		}
	});

	it('reports exact missing entries and returns exit code 1 for incomplete banks', async () => {
		const bank = await tempDir();
		try {
			const present = {
				assetId: 'plateA/forest/setup/s1',
				layer: 'A',
				styleId: 's1',
				locale: 'forest',
				beatMood: 'setup',
				file: 'plateA/forest/setup/s1.png',
				seed: 1,
				generatedAtIso: '2026-06-11T00:00:00.000Z',
			};
			const missing = {
				assetId: 'propC/lantern/s1',
				layer: 'C',
				styleId: 's1',
				propId: 'lantern',
			};
			await writeSidecar(bank, present);

			const exact = coverageReport([present], [present, missing]);
			expect(exact.coverageRatio).toBe(0.5);
			expect(exact.missing).toEqual([missing]);

			const result = await writeManifestAndReport({ bank, styles: ['s1'] });
			expect(result.exitCode).toBe(1);
			const written = JSON.parse(await readFile(join(bank, 'coverage-report.json'), 'utf8'));
			expect(written.coverageRatio).toBeLessThan(1);
			expect(written.missing.some((entry: { assetId: string }) => entry.assetId === 'propC/lantern/s1'))
				.toBe(true);
		} finally {
			await rm(bank, { recursive: true, force: true });
		}
	});
});
