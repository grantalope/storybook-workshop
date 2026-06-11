#!/usr/bin/env node
// @ts-nocheck

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { scanSidecars } from './lib/manifest.mjs';
import { bumpedRetrySeed } from './lib/seed.mjs';

const MODEL_SOURCE = 'Xenova/clip-vit-base-patch32';

let defaultPipePromise = null;

export async function defaultEmbedImage(imagePath) {
	const xfm = await import('@xenova/transformers');
	if (!defaultPipePromise) {
		defaultPipePromise = xfm.pipeline('image-feature-extraction', MODEL_SOURCE);
	}
	const pipe = await defaultPipePromise;
	const input = xfm.RawImage?.read ? await xfm.RawImage.read(imagePath) : imagePath;
	const result = await pipe(input, { pooling: 'mean', normalize: true });
	return result.data instanceof Float32Array ? result.data : new Float32Array(result.data);
}

function cosine(a, b) {
	if (a.length !== b.length) {
		throw new Error(`embedding length mismatch: ${a.length} !== ${b.length}`);
	}
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let index = 0; index < a.length; index += 1) {
		dot += a[index] * b[index];
		magA += a[index] * a[index];
		magB += b[index] * b[index];
	}
	if (magA === 0 || magB === 0) return 0;
	return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function loadEmbedder(embedderPath) {
	if (!embedderPath) return { embedImage: defaultEmbedImage };
	const moduleUrl = embedderPath.startsWith('file:')
		? embedderPath
		: pathToFileURL(path.resolve(embedderPath)).href;
	const imported = await import(moduleUrl);
	if (typeof imported.embedImage !== 'function') {
		throw new Error('--embedder module must export embedImage(path)');
	}
	return imported;
}

export async function runQcSimilarity({
	bank,
	portraits,
	threshold = 0.75,
	embedder,
	embedderPath,
	logger = console.log,
} = {}) {
	const activeEmbedder = embedder ?? await loadEmbedder(embedderPath);
	const sidecars = await scanSidecars(bank);
	const layerB = sidecars.filter(({ entry }) => entry.layer === 'B');
	const regenQueue = [];

	for (const { sidecarPath, entry } of layerB) {
		if (!entry.archetypeId) {
			throw new Error(`Layer-B sidecar ${entry.assetId} missing archetypeId`);
		}
		const spritePath = path.join(bank, entry.file);
		const portraitPath = path.join(portraits, `${entry.archetypeId}.png`);
		const [sprite, portrait] = await Promise.all([
			activeEmbedder.embedImage(spritePath),
			activeEmbedder.embedImage(portraitPath),
		]);
		const similarity = Number(cosine(sprite, portrait).toFixed(6));
		const updated = { ...entry, qcSimilarity: similarity };
		await writeFile(sidecarPath, `${JSON.stringify(updated, null, 2)}\n`);
		logger(`[pregen] qc ${entry.assetId} similarity=${similarity.toFixed(3)}`);

		if (similarity < threshold) {
			regenQueue.push({
				assetId: entry.assetId,
				archetypeId: entry.archetypeId,
				poseClass: entry.poseClass,
				styleId: entry.styleId,
				file: entry.file,
				seed: entry.seed,
				retrySeed: bumpedRetrySeed(entry.seed, 1),
				qcSimilarity: similarity,
			});
		}
	}

	await writeFile(path.join(bank, 'regen-queue.json'), `${JSON.stringify(regenQueue, null, 2)}\n`);
	return { checked: layerB.length, flagged: regenQueue.length, regenQueue };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
	const args = parseArgs(argv, {
		required: ['bank', 'portraits'],
		defaults: { threshold: 0.75 },
	});
	return runQcSimilarity({
		bank: args.bank,
		portraits: args.portraits,
		threshold: args.threshold,
		embedderPath: args.embedder,
		embedder: deps.embedder,
		logger: deps.logger,
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err?.stack ?? err);
		process.exitCode = 1;
	});
}
