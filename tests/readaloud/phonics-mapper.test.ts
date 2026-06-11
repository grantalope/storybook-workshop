import { describe, expect, it } from 'vitest';
import { buildPhonicsMap } from '$lib/services/readaloud/PhonicsMapper';

describe('buildPhonicsMap', () => {
	it('marks silent-e words with a long medial vowel and silent final e', () => {
		expect(buildPhonicsMap(['cake']).cake).toEqual([
			{ grapheme: 'c', phoneme: '/k/', kind: 'consonant' },
			{ grapheme: 'a', phoneme: '/ā/', kind: 'long-vowel' },
			{ grapheme: 'k', phoneme: '/k/', kind: 'consonant' },
			{ grapheme: 'e', phoneme: '', kind: 'silent' }
		]);
	});

	it('groups common digraphs as one segment', () => {
		const map = buildPhonicsMap(['ship', 'chin', 'that', 'phone']);
		expect(map.ship.some((segment) => segment.grapheme === 'sh' && segment.kind === 'digraph')).toBe(true);
		expect(map.chin.some((segment) => segment.grapheme === 'ch' && segment.kind === 'digraph')).toBe(true);
		expect(map.that.some((segment) => segment.grapheme === 'th' && segment.kind === 'digraph')).toBe(true);
		expect(map.phone.some((segment) => segment.grapheme === 'ph' && segment.kind === 'digraph')).toBe(true);
	});

	it('groups vowel teams as one teaching segment', () => {
		const map = buildPhonicsMap(['rain', 'boat']);
		expect(map.rain).toContainEqual({ grapheme: 'ai', phoneme: '/ā/', kind: 'vowel-team' });
		expect(map.boat).toContainEqual({ grapheme: 'oa', phoneme: '/ō/', kind: 'vowel-team' });
	});

	it('uses the irregular dictionary before ordinary letter rules', () => {
		const map = buildPhonicsMap(['the', 'said']);
		expect(map.the).toEqual([{ grapheme: 'the', phoneme: '/the/', kind: 'irregular' }]);
		expect(map.said).toEqual([{ grapheme: 'said', phoneme: '/said/', kind: 'irregular' }]);
	});

	it('maps a 200-word book sample without empty segment arrays', () => {
		const words = Array.from({ length: 200 }, (_, index) => `word${index}`);
		const map = buildPhonicsMap(words);
		expect(Object.keys(map)).toHaveLength(200);
		for (const word of words) {
			expect(map[word]).toBeDefined();
			expect(map[word].length).toBeGreaterThan(0);
		}
	});

	it('is deterministic across repeated runs', () => {
		const words = ['Cake', 'ship', 'rain', 'the', 'boat', 'said'];
		expect(buildPhonicsMap(words)).toEqual(buildPhonicsMap(words));
	});
});
