import { describe, expect, it } from 'vitest';

import { hashSeed, mulberry32 } from '$lib/services/scenegrammar';

describe('scenegrammar seeded RNG', () => {
	it('hashes the same parts to the same seed', () => {
		expect(hashSeed('book-a', 3, 'spread')).toBe(hashSeed('book-a', 3, 'spread'));
	});

	it('changes seed when spreadIndex changes', () => {
		expect(hashSeed('book-a', 3)).not.toBe(hashSeed('book-a', 4));
	});

	it('emits the mulberry32 golden sequence for seed 1', () => {
		const rng = mulberry32(1);
		const values = Array.from({ length: 5 }, () => Number(rng().toFixed(12)));
		expect(values).toEqual([
			0.627073940588,
			0.00273572118,
			0.52744703996,
			0.981050967472,
			0.968377898214,
		]);
	});
});
