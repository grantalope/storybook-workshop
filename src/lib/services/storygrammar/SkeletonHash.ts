import type { StorySkeleton } from './types';

const FNV_64_OFFSET = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const FNV_64_MASK = 0xffffffffffffffffn;

export function skeletonHash(skeleton: StorySkeleton): string {
	const canonical = canonicalJson(skeleton);
	let hash = FNV_64_OFFSET;
	for (let i = 0; i < canonical.length; i++) {
		hash ^= BigInt(canonical.charCodeAt(i));
		hash = (hash * FNV_64_PRIME) & FNV_64_MASK;
	}
	return hash.toString(16).padStart(16, '0');
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;

	const record = value as Record<string, unknown>;
	const keys = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort();
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(',')}}`;
}
