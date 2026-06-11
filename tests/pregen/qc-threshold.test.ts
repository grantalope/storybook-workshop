// @ts-nocheck
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runQcSimilarity } from '../../scripts/pregen/qc-similarity.mjs';

async function tempDir() {
	const { mkdtemp } = await import('node:fs/promises');
	return mkdtemp(join(tmpdir(), 'pregen-qc-'));
}

async function writePoseSidecar(bank: string, seed = 123) {
	const entry = {
		assetId: 'poseB/p001/standing-neutral/s1',
		layer: 'B',
		styleId: 's1',
		archetypeId: 'p001',
		poseClass: 'standing-neutral',
		file: 'poseB/p001/standing-neutral/s1.png',
		seed,
		generatedAtIso: '2026-06-11T00:00:00.000Z',
	};
	const sidecarPath = join(bank, `${entry.assetId}.png.json`);
	await mkdir(dirname(sidecarPath), { recursive: true });
	await writeFile(sidecarPath, `${JSON.stringify(entry, null, 2)}\n`);
	return sidecarPath;
}

function embedderForPortraitVector(vector: [number, number]) {
	return {
		embedImage: async (filePath: string) => {
			if (filePath.includes('portraits')) return new Float32Array(vector);
			return new Float32Array([1, 0]);
		},
	};
}

describe('pregen QC similarity thresholding', () => {
	it('flags low-similarity sprites and writes a deterministic regen queue', async () => {
		const bank = await tempDir();
		const portraits = join(bank, 'portraits');
		try {
			const sidecarPath = await writePoseSidecar(bank);
			const result = await runQcSimilarity({
				bank,
				portraits,
				threshold: 0.75,
				embedder: embedderForPortraitVector([0.6, 0.8]),
				logger: () => undefined,
			});

			expect(result).toMatchObject({ checked: 1, flagged: 1 });
			expect(result.regenQueue[0].seed).toBe(123);
			expect(result.regenQueue[0].retrySeed).not.toBe(123);
			const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
			expect(sidecar.qcSimilarity).toBe(0.6);
			const queue = JSON.parse(await readFile(join(bank, 'regen-queue.json'), 'utf8'));
			expect(queue[0].assetId).toBe('poseB/p001/standing-neutral/s1');
		} finally {
			await rm(bank, { recursive: true, force: true });
		}
	});

	it('passes high-similarity sprites while still recording qcSimilarity', async () => {
		const bank = await tempDir();
		const portraits = join(bank, 'portraits');
		try {
			const sidecarPath = await writePoseSidecar(bank);
			const result = await runQcSimilarity({
				bank,
				portraits,
				threshold: 0.75,
				embedder: embedderForPortraitVector([0.9, 0.4358899]),
				logger: () => undefined,
			});

			expect(result).toMatchObject({ checked: 1, flagged: 0 });
			const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
			expect(sidecar.qcSimilarity).toBe(0.9);
			const queue = JSON.parse(await readFile(join(bank, 'regen-queue.json'), 'utf8'));
			expect(queue).toEqual([]);
		} finally {
			await rm(bank, { recursive: true, force: true });
		}
	});
});
