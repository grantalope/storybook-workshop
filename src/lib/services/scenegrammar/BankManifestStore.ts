import type { BeatName, LocaleBiome } from '$lib/services/author/types';
import type {
	BankAssetEntry,
	BankAssetQuery,
	BankManifest,
	PoseClass,
} from './types';

const VALID_LAYERS = ['A', 'B', 'C'] as const;
const VALID_LOCALES: LocaleBiome[] = [
	'forest',
	'seaside',
	'mountain',
	'desert',
	'meadow',
	'snowfield',
	'jungle',
	'urban',
	'farm',
	'underwater',
	'space',
	'imaginary',
];
const VALID_BEATS: BeatName[] = ['setup', 'catalyst', 'debate', 'midpoint', 'trial', 'climax', 'resolution'];
const VALID_POSES: PoseClass[] = [
	'standing-neutral',
	'walking',
	'running',
	'sitting',
	'reaching',
	'pointing',
	'hugging',
	'sleeping',
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, expected: string): never {
	throw new Error(`BankManifest malformed at ${path}: expected ${expected}`);
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
	const value = record[key];
	if (typeof value !== 'string' || value.length === 0) fail(`${path}.${key}`, 'non-empty string');
	return value;
}

function optionalString(record: Record<string, unknown>, key: string, path: string): string | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.length === 0) fail(`${path}.${key}`, 'non-empty string');
	return value;
}

function requireInteger(record: Record<string, unknown>, key: string, path: string): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isInteger(value)) fail(`${path}.${key}`, 'integer');
	return value;
}

function optionalNumber(record: Record<string, unknown>, key: string, path: string): number | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path}.${key}`, 'finite number');
	return value;
}

function requireLayer(record: Record<string, unknown>, path: string): BankAssetEntry['layer'] {
	const value = requireString(record, 'layer', path);
	if (!VALID_LAYERS.includes(value as BankAssetEntry['layer'])) fail(`${path}.layer`, 'A, B, or C');
	return value as BankAssetEntry['layer'];
}

function optionalLocale(record: Record<string, unknown>, path: string): LocaleBiome | undefined {
	const value = optionalString(record, 'locale', path);
	if (value === undefined) return undefined;
	if (!VALID_LOCALES.includes(value as LocaleBiome)) fail(`${path}.locale`, 'known LocaleBiome');
	return value as LocaleBiome;
}

function optionalBeat(record: Record<string, unknown>, path: string): BeatName | undefined {
	const value = optionalString(record, 'beatMood', path);
	if (value === undefined) return undefined;
	if (!VALID_BEATS.includes(value as BeatName)) fail(`${path}.beatMood`, 'known BeatName');
	return value as BeatName;
}

function optionalPose(record: Record<string, unknown>, path: string): PoseClass | undefined {
	const value = optionalString(record, 'poseClass', path);
	if (value === undefined) return undefined;
	if (!VALID_POSES.includes(value as PoseClass)) fail(`${path}.poseClass`, 'known PoseClass');
	return value as PoseClass;
}

function parseEntry(value: unknown, path: string): BankAssetEntry {
	if (!isRecord(value)) fail(path, 'object');
	const locale = optionalLocale(value, path);
	const beatMood = optionalBeat(value, path);
	const archetypeId = optionalString(value, 'archetypeId', path);
	const poseClass = optionalPose(value, path);
	const propId = optionalString(value, 'propId', path);
	const qcSimilarity = optionalNumber(value, 'qcSimilarity', path);
	return {
		assetId: requireString(value, 'assetId', path),
		layer: requireLayer(value, path),
		styleId: requireString(value, 'styleId', path),
		...(locale ? { locale } : {}),
		...(beatMood ? { beatMood } : {}),
		...(archetypeId ? { archetypeId } : {}),
		...(poseClass ? { poseClass } : {}),
		...(propId ? { propId } : {}),
		file: requireString(value, 'file', path),
		seed: requireInteger(value, 'seed', path),
		...(qcSimilarity !== undefined ? { qcSimilarity } : {}),
		generatedAtIso: requireString(value, 'generatedAtIso', path),
	};
}

export function loadBankManifest(json: unknown): BankManifest {
	if (!isRecord(json)) fail('$', 'object');
	if (json.version !== 1) fail('$.version', 'literal 1');
	const bankRoot = requireString(json, 'bankRoot', '$');
	const entriesValue = json.entries;
	if (!Array.isArray(entriesValue)) fail('$.entries', 'array');
	return {
		version: 1,
		bankRoot,
		entries: entriesValue.map((entry, index) => parseEntry(entry, `entries[${index}]`)),
	};
}

const QUERY_FIELDS = ['layer', 'styleId', 'locale', 'beatMood', 'archetypeId', 'poseClass', 'propId'] as const;

export function findAsset(manifest: BankManifest, query: BankAssetQuery): BankAssetEntry | null {
	for (const entry of manifest.entries) {
		let matches = true;
		for (const field of QUERY_FIELDS) {
			if (query[field] !== undefined && entry[field] !== query[field]) {
				matches = false;
				break;
			}
		}
		if (matches) return entry;
	}
	return null;
}

export function coverageReport(
	manifest: BankManifest,
	queries: BankAssetQuery[],
): { covered: number; missing: BankAssetQuery[]; coverageRatio: number } {
	const missing: BankAssetQuery[] = [];
	for (const query of queries) {
		if (!findAsset(manifest, query)) missing.push(query);
	}
	const covered = queries.length - missing.length;
	return {
		covered,
		missing,
		coverageRatio: queries.length === 0 ? 1 : covered / queries.length,
	};
}
