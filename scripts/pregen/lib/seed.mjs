// @ts-nocheck

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a(input) {
	let hash = FNV_OFFSET_BASIS;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return hash >>> 0;
}

export function seedFor(assetId) {
	return fnv1a(String(assetId));
}

export function bumpedRetrySeed(seed, attempt = 1) {
	return seedFor(`retry/${seed}/${attempt}`);
}
