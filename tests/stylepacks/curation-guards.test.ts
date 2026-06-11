import { describe, expect, it } from 'vitest';
import {
	assertNoBannedReferences,
	listStylePacks,
	validateStylePack,
	type StylePack,
} from '$lib/services/stylepacks';

function validPack(overrides: Partial<StylePack> = {}): StylePack {
	return {
		id: 'fixture-pack',
		displayName: 'Fixture Pack',
		era: { start: 1900, end: 1950 },
		inspirations: [],
		promptRecipe: {
			positivePrefix: 'public-domain watercolor technique',
			positiveSuffix: 'soft paper texture',
			negativeAdditions: 'photorealistic',
			palette: ['#112233', '#445566', '#778899', '#aabbcc'],
		},
		educationalCard: {
			kidExplainer: 'This style uses gentle marks and simple shapes.',
			funFact: 'Artists can learn by looking closely.',
			lookFor: 'Soft color and clear shapes.',
			tryItYourself: 'Try three colors and one careful line.',
			famousWorkDescription: 'A public-domain work might show a quiet garden.',
		},
		...overrides,
	};
}

describe('style pack curation guards', () => {
	it('throws when a non-legacy era ends after 1955', () => {
		expect(() => validateStylePack(validPack({ era: { start: 1960, end: 1980 } }), 2026)).toThrow(
			/after 1955/,
		);
	});

	it('throws when an inspiration is not public-domain safe in the current year', () => {
		expect(() =>
			validateStylePack(validPack({ inspirations: [{ name: 'Late exemplar', died: 1991 }] }), 2026),
		).toThrow(/not public-domain safe/);
		expect(() =>
			validateStylePack(validPack({ inspirations: [{ name: 'Boundary exemplar', died: 1957 }] }), 2026),
		).toThrow(/not public-domain safe/);
	});

	it('throws when a culture-tagged pack omits its respect note', () => {
		expect(() => validateStylePack(validPack({ cultureTag: 'japan', respectNote: undefined }), 2026)).toThrow(
			/respectNote/,
		);
	});

	it('ships respect notes and technique-only prompt language for culture packs', () => {
		const culturePacks = listStylePacks().filter((pack) => pack.cultureTag);
		expect(culturePacks.map((pack) => pack.id).sort()).toEqual([
			'mexican-amate-folk',
			'persian-miniature',
			'scandinavian-rosemaling',
			'ukiyo-e-woodblock',
		]);
		for (const pack of culturePacks) {
			expect(pack.respectNote?.trim(), pack.id).toBeTruthy();
			const recipeText = [
				pack.promptRecipe?.positivePrefix,
				pack.promptRecipe?.positiveSuffix,
				pack.promptRecipe?.negativeAdditions,
			].join(' ');
			expect(recipeText, pack.id).not.toMatch(/\b(costume|ethnic|oriental|exotic)\b/i);
		}
	});

	it('blocks banned living-artist and studio references in prompt recipes', () => {
		assertNoBannedReferences(listStylePacks());

		for (const bannedName of ['Eric Carle', 'Oliver Jeffers', 'Jon Klassen', 'Sophie Blackall']) {
			const fixture = validPack({
				promptRecipe: {
					...validPack().promptRecipe!,
					positivePrefix: `in the style of ${bannedName}`,
				},
			});
			expect(() => assertNoBannedReferences([fixture]), bannedName).toThrow(bannedName);
		}
	});
});
