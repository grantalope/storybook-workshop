#!/usr/bin/env node
// @ts-nocheck

// Validate static/pregen-bank/manifest.json by loading it through the REAL
// scenegrammar BankManifestStore (src/lib/services/scenegrammar/BankManifestStore.ts)
// and print a coverage report against the expected pregen grid.
//
// Node 18-compatible: BankManifestStore.ts only has `import type` imports, so
// transpiling it with the repo's typescript devDependency yields an
// import-free ES module we can dynamic-import directly.
//
// Hard failures (exit 1):
//   - loadBankManifest() rejects the manifest
//   - duplicate assetIds
//   - an entry is missing its `thumb` field, or the thumb file is absent
//   - orphan thumb files not referenced by any entry
//   - (with --bank) an entry's source PNG is missing from the bank
// Coverage < 100% is REPORTED but non-fatal — the imagegen lanes fill the grid
// incrementally; rebuild the manifest when they finish (docs/pregen-bank.md).
//
// Usage:
//   node scripts/pregen/validate-repo-manifest.mjs \
//     [--in static/pregen-bank/manifest.json] \
//     [--expect-styles flat-painted] \
//     [--taxonomy static/pillar-library-v2/taxonomy.json] \
//     [--bank /abs/path/to/.bank]

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parseArgs } from './lib/cli.mjs';
import { expectedEntries } from './lib/manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE_TS = path.join(REPO_ROOT, 'src', 'lib', 'services', 'scenegrammar', 'BankManifestStore.ts');

async function importBankManifestStore() {
	const source = await readFile(STORE_TS, 'utf8');
	const transpiled = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ES2022,
			isolatedModules: true,
		},
	}).outputText;
	if (/^\s*import\s/m.test(transpiled)) {
		throw new Error('transpiled BankManifestStore unexpectedly retains runtime imports');
	}
	const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'bank-manifest-store-'));
	const tmpFile = path.join(tmpDir, 'BankManifestStore.mjs');
	await writeFile(tmpFile, transpiled);
	try {
		return await import(pathToFileURL(tmpFile).href);
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
}

async function pathExists(filePath) {
	try {
		await stat(filePath);
		return true;
	} catch (err) {
		if (err?.code === 'ENOENT') return false;
		throw err;
	}
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
		defaults: {
			in: path.join(REPO_ROOT, 'static', 'pregen-bank', 'manifest.json'),
			expectStyles: ['flat-painted'],
			taxonomy: path.join(REPO_ROOT, 'static', 'pillar-library-v2', 'taxonomy.json'),
		},
	});
	const logger = deps.logger ?? console.log;
	const manifestPath = path.resolve(args.in);
	const staticBase = path.dirname(manifestPath);
	const raw = JSON.parse(await readFile(manifestPath, 'utf8'));

	// 1. The load-bearing check: the real BankManifestStore must accept it.
	const store = await importBankManifestStore();
	const manifest = store.loadBankManifest(raw);

	const problems = [];

	// 2. Unique assetIds (loadBankManifest does not enforce this).
	const seen = new Set();
	for (const entry of manifest.entries) {
		if (seen.has(entry.assetId)) problems.push(`duplicate assetId: ${entry.assetId}`);
		seen.add(entry.assetId);
	}

	// 3. Thumbs: every RAW entry carries thumb (BankManifestStore strips
	// unknown fields, so check the raw JSON) and the file exists.
	const referencedThumbs = new Set();
	for (const entry of raw.entries) {
		const expectedThumb = `thumbs/${entry.assetId}.jpg`;
		if (entry.thumb !== expectedThumb) {
			problems.push(`entry ${entry.assetId}: thumb is ${JSON.stringify(entry.thumb)}, expected ${expectedThumb}`);
			continue;
		}
		referencedThumbs.add(path.normalize(entry.thumb));
		if (!(await pathExists(path.join(staticBase, entry.thumb)))) {
			problems.push(`entry ${entry.assetId}: thumb file missing (${entry.thumb})`);
		}
	}

	// 4. No orphan thumbs.
	const thumbsRoot = path.join(staticBase, 'thumbs');
	let thumbCount = 0;
	if (await pathExists(thumbsRoot)) {
		for (const file of await readdir(thumbsRoot, { recursive: true })) {
			const full = path.join(thumbsRoot, String(file));
			if (!(await stat(full)).isFile()) continue;
			thumbCount += 1;
			const rel = path.normalize(path.join('thumbs', String(file)));
			if (!referencedThumbs.has(rel)) problems.push(`orphan thumb: ${rel}`);
		}
	}

	// 5. Optional: source PNGs present in the out-of-repo bank.
	if (args.bank) {
		for (const entry of manifest.entries) {
			if (!(await pathExists(path.join(args.bank, entry.file)))) {
				problems.push(`entry ${entry.assetId}: bank file missing (${entry.file})`);
			}
		}
	}

	// 6. Coverage through the store's own findAsset/coverageReport.
	const archetypes = await loadTaxonomyArchetypes(args.taxonomy);
	const expected = expectedEntries({ styles: args.expectStyles, archetypes });
	const queries = expected.map(({ assetId, ...query }) => query);
	const coverage = store.coverageReport(manifest, queries);

	logger(JSON.stringify({
		manifest: manifestPath,
		valid: problems.length === 0,
		entries: manifest.entries.length,
		thumbFiles: thumbCount,
		problems: problems.slice(0, 50),
		problemCount: problems.length,
		coverage: {
			expected: queries.length,
			covered: coverage.covered,
			coverageRatio: Number(coverage.coverageRatio.toFixed(4)),
			missing: coverage.missing.map((q) =>
				[q.layer, q.archetypeId ?? q.locale ?? q.propId, q.poseClass ?? q.beatMood, q.styleId]
					.filter(Boolean)
					.join('/')),
		},
	}, null, 2));

	return { ok: problems.length === 0, problems, coverage, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main()
		.then((result) => {
			process.exitCode = result.ok ? 0 : 1;
		})
		.catch((err) => {
			console.error(err?.stack ?? err);
			process.exitCode = 1;
		});
}
