// @ts-nocheck

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BEAT_MOODS, LOCALES, POSE_CLASSES } from './grids.mjs';
import { PROPS } from './props.mjs';

async function walkJsonFiles(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const child = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...await walkJsonFiles(child));
		} else if (entry.isFile() && entry.name.endsWith('.png.json')) {
			out.push(child);
		}
	}
	return out.sort();
}

function normalizeEntry(entry) {
	if (!entry || typeof entry !== 'object') throw new Error('sidecar must be a JSON object');
	for (const key of ['assetId', 'layer', 'styleId', 'file', 'seed', 'generatedAtIso']) {
		if (entry[key] === undefined) throw new Error(`sidecar ${entry.assetId ?? '<unknown>'} missing ${key}`);
	}
	return entry;
}

export async function scanSidecars(bankRoot) {
	const files = await walkJsonFiles(bankRoot);
	const sidecars = [];
	for (const sidecarPath of files) {
		const entry = normalizeEntry(JSON.parse(await readFile(sidecarPath, 'utf8')));
		sidecars.push({ sidecarPath, entry });
	}
	return sidecars.sort((a, b) => a.entry.assetId.localeCompare(b.entry.assetId));
}

export function buildManifest(bankRoot, sidecars) {
	return {
		version: 1,
		bankRoot,
		entries: sidecars.map(({ entry }) => entry).sort((a, b) => a.assetId.localeCompare(b.assetId)),
	};
}

export function expectedEntries({ styles, archetypes = [] }) {
	const expected = [];
	for (const locale of LOCALES) {
		for (const beatMood of BEAT_MOODS) {
			for (const styleId of styles) {
				expected.push({ assetId: `plateA/${locale}/${beatMood}/${styleId}`, layer: 'A', styleId, locale, beatMood });
			}
		}
	}
	for (const prop of PROPS) {
		for (const styleId of styles) {
			expected.push({ assetId: `propC/${prop.propId}/${styleId}`, layer: 'C', styleId, propId: prop.propId });
		}
	}
	for (const archetype of archetypes) {
		for (const poseClass of POSE_CLASSES) {
			for (const styleId of styles) {
				expected.push({
					assetId: `poseB/${archetype.id}/${poseClass}/${styleId}`,
					layer: 'B',
					styleId,
					archetypeId: archetype.id,
					poseClass,
				});
			}
		}
	}
	return expected.sort((a, b) => a.assetId.localeCompare(b.assetId));
}

export function coverageReport(entries, expected) {
	const presentIds = new Set(entries.map((entry) => entry.assetId));
	const missing = expected.filter((entry) => !presentIds.has(entry.assetId));
	const perLayer = {};
	for (const layer of ['A', 'B', 'C']) {
		const layerExpected = expected.filter((entry) => entry.layer === layer);
		const present = entries.filter((entry) => entry.layer === layer).length;
		perLayer[layer] = {
			expected: layerExpected.length,
			present,
			missing: layerExpected.filter((entry) => !presentIds.has(entry.assetId)).length,
		};
	}
	const covered = expected.length - missing.length;
	return {
		expected: expected.length,
		present: entries.length,
		covered,
		perLayer,
		missing,
		coverageRatio: expected.length === 0 ? 1 : covered / expected.length,
	};
}

async function loadManifestTaxonomy(taxonomyPath) {
	if (!taxonomyPath) return [];
	const parsed = JSON.parse(await readFile(taxonomyPath, 'utf8'));
	if (!Array.isArray(parsed?.archetypes)) {
		throw new Error('--taxonomy must point to JSON with an archetypes array');
	}
	return parsed.archetypes;
}

export async function writeManifestAndReport({ bank, styles, taxonomyPath }) {
	const sidecars = await scanSidecars(bank);
	const manifest = buildManifest(bank, sidecars);
	const archetypes = await loadManifestTaxonomy(taxonomyPath);
	const report = coverageReport(manifest.entries, expectedEntries({ styles, archetypes }));
	await mkdir(bank, { recursive: true });
	await writeFile(path.join(bank, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	await writeFile(path.join(bank, 'coverage-report.json'), `${JSON.stringify(report, null, 2)}\n`);
	return { manifest, report, exitCode: report.coverageRatio < 1 ? 1 : 0 };
}
