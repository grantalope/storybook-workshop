import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseArgs } from '../../scripts/pregen/lib/cli.mjs';
import {
	applyJobFilters,
	buildPlateJobs,
	outputPathForAsset,
	sidecarPathForAsset,
} from '../../scripts/pregen/lib/jobs.mjs';
import { main as runPlateGen } from '../../scripts/pregen/plate-gen.mjs';

async function tempDir() {
	return mkdtemp(join(tmpdir(), 'pregen-'));
}

describe('pregen CLI and driver controls', () => {
	it('applies --filter and --limit to the deterministic job list', () => {
		const args = parseArgs([
			'--styles',
			's1,s2',
			'--filter',
			'forest/(setup|trial)/s2$',
			'--limit',
			'1',
		]);
		const jobs = applyJobFilters(buildPlateJobs({ styles: args.styles }), args);
		expect(jobs.map((job) => job.assetId)).toEqual(['plateA/forest/setup/s2']);
	});

	it('names every missing required flag', () => {
		expect(() => parseArgs(['--out', '/tmp/bank'], { required: ['server', 'out', 'styles'] }))
			.toThrow(/--server, --styles/);
	});

	it('performs zero fetch calls during dry-run', async () => {
		let fetchCalls = 0;
		const logs: string[] = [];
		const result = await runPlateGen([
			'--dry-run',
			'--styles',
			's1',
			'--out',
			'/tmp/bank',
			'--server',
			'http://localhost:9',
			'--limit',
			'2',
		], {
			fetchImpl: async () => {
				fetchCalls += 1;
				return new Response('{}');
			},
			logger: (line: string) => logs.push(line),
		});

		expect(result).toMatchObject({ total: 2, generated: 0, skipped: 0, dryRun: true });
		expect(fetchCalls).toBe(0);
		expect(logs.some((line) => line.includes('POSITIVE:'))).toBe(true);
	});

	it('skips existing output without touching HTTP and recreates missing sidecar', async () => {
		const bank = await tempDir();
		try {
			const assetId = 'plateA/forest/setup/s1';
			const outputPath = outputPathForAsset(bank, assetId);
			await mkdir(dirname(outputPath), { recursive: true });
			await writeFile(outputPath, new Uint8Array([1, 2, 3]));

			let fetchCalls = 0;
			const logs: string[] = [];
			const result = await runPlateGen([
				'--styles',
				's1',
				'--out',
				bank,
				'--server',
				'http://localhost:9',
				'--limit',
				'1',
			], {
				fetchImpl: async () => {
					fetchCalls += 1;
					return new Response('{}');
				},
				logger: (line: string) => logs.push(line),
				generatedAtIso: '2026-06-11T00:00:00.000Z',
			});

			expect(result).toMatchObject({ total: 1, generated: 0, skipped: 1 });
			expect(fetchCalls).toBe(0);
			expect(logs.some((line) => line.includes('skipped'))).toBe(true);
			const sidecar = JSON.parse(await readFile(sidecarPathForAsset(bank, assetId), 'utf8'));
			expect(sidecar).toMatchObject({ assetId, layer: 'A', styleId: 's1', locale: 'forest' });
		} finally {
			await rm(bank, { recursive: true, force: true });
		}
	});
});
