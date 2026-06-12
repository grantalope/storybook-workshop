#!/usr/bin/env node
// @ts-nocheck

// Build static/pregen-bank/manifest.json from an out-of-repo pregen bank.
//
// STORAGE RULING (2026-06-11): full-resolution bank PNGs (~1.1 GB) stay OUT of
// git. The repo carries only:
//   static/pregen-bank/manifest.json — BankManifest validated by
//     src/lib/services/scenegrammar/BankManifestStore.ts (entries point at
//     bank-relative paths under bankRoot, plus a repo-only `thumb` field that
//     BankManifestStore ignores)
//   static/pregen-bank/thumbs/       — 256px JPEG q80 thumbnails
//     (scripts/pregen/build-thumbs.py)
// See docs/pregen-bank.md for bank location + regeneration runbook.
//
// Usage:
//   node scripts/pregen/build-manifest-from-bank.mjs \
//     --bank /abs/path/to/.bank \
//     --expect-styles flat-painted \
//     [--taxonomy static/pillar-library-v2/taxonomy.json] \
//     [--out static/pregen-bank]
//
// Differences vs bank-manifest.mjs (which writes manifest+coverage INTO the
// bank itself): this script dedupes nested duplicate sidecars (some pose
// ingests left both poseB/<a>/<pose>/<style>.png and
// poseB/<a>/<pose>/<style>/<style>.png with the same assetId/seed), adds the
// thumb field, and writes into the repo's static/ tree.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { coverageReport, expectedEntries, scanSidecars } from './lib/manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BANK_ROOT_LABEL = 'scripts/pregen/.bank';

function canonicalFile(assetId) {
	return `${assetId}.png`;
}

// Dedupe by assetId. Preference order: the entry whose file path is the
// canonical `<assetId>.png` layout, then the newest generatedAtIso.
export function dedupeEntries(rawEntries) {
	const byId = new Map();
	let duplicates = 0;
	for (const entry of rawEntries) {
		const existing = byId.get(entry.assetId);
		if (!existing) {
			byId.set(entry.assetId, entry);
			continue;
		}
		duplicates += 1;
		const existingCanonical = existing.file === canonicalFile(existing.assetId);
		const entryCanonical = entry.file === canonicalFile(entry.assetId);
		if (existingCanonical && !entryCanonical) continue;
		if (entryCanonical && !existingCanonical) {
			byId.set(entry.assetId, entry);
			continue;
		}
		if (String(entry.generatedAtIso) > String(existing.generatedAtIso)) {
			byId.set(entry.assetId, entry);
		}
	}
	return {
		entries: [...byId.values()].sort((a, b) => a.assetId.localeCompare(b.assetId)),
		duplicates,
	};
}

export function withThumbs(entries) {
	return entries.map((entry) => ({ ...entry, thumb: `thumbs/${entry.assetId}.jpg` }));
}

async function loadTaxonomyArchetypes(taxonomyPath) {
	if (!taxonomyPath) return [];
	const parsed = JSON.parse(await readFile(taxonomyPath, 'utf8'));
	if (!Array.isArray(parsed?.archetypes)) {
		throw new Error('--taxonomy must point to JSON with an archetypes array');
	}
	return parsed.archetypes;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
	const args = parseArgs(argv, {
		required: ['bank', 'expectStyles'],
		defaults: {
			out: path.join(REPO_ROOT, 'static', 'pregen-bank'),
			taxonomy: path.join(REPO_ROOT, 'static', 'pillar-library-v2', 'taxonomy.json'),
		},
	});
	const sidecars = await scanSidecars(args.bank);
	const { entries: deduped, duplicates } = dedupeEntries(sidecars.map(({ entry }) => entry));
	const entries = withThumbs(deduped);
	const manifest = { version: 1, bankRoot: BANK_ROOT_LABEL, entries };
	const archetypes = await loadTaxonomyArchetypes(args.taxonomy);
	const report = coverageReport(entries, expectedEntries({ styles: args.expectStyles, archetypes }));
	await mkdir(args.out, { recursive: true });
	const outPath = path.join(args.out, 'manifest.json');
	await writeFile(outPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	const logger = deps.logger ?? console.log;
	logger(JSON.stringify({
		out: outPath,
		entries: entries.length,
		duplicatesDropped: duplicates,
		expected: report.expected,
		covered: report.covered,
		coverageRatio: Number(report.coverageRatio.toFixed(4)),
		perLayer: report.perLayer,
		missing: report.missing.map((m) => m.assetId),
	}, null, 2));
	return { manifest, report, duplicates };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err?.stack ?? err);
		process.exitCode = 1;
	});
}
