export function hashSeed(...parts: (string | number)[]): number {
	let hash = 0x811c9dc5;
	for (const part of parts) {
		const value = String(part);
		hash ^= value.length;
		hash = Math.imul(hash, 0x01000193);
		for (let i = 0; i < value.length; i++) {
			hash ^= value.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193);
		}
		hash ^= 0xff;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
