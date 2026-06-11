// @graph-layer: private
// @rationale: public-safe curation guard; no child PII

import type { StylePack } from './types';
import { StylePackError } from './types';

export const BANNED_STYLE_REFERENCES = Object.freeze([
	'Eric Carle',
	'Oliver Jeffers',
	'Jon Klassen',
	'Sophie Blackall',
	'Mo Willems',
	'Maurice Sendak',
	'Dr. Seuss',
	'Quentin Blake',
	'Richard Scarry',
	'Mary Blair',
	'Chris Van Allsburg',
	'Shaun Tan',
	'Beatrix Potter',
	'Miyazaki',
	'Ghibli',
	'Disney',
	'Pixar',
	'Dreamworks',
]);

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BANNED_PATTERNS = BANNED_STYLE_REFERENCES.map((name) => ({
	name,
	pattern: new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i'),
}));

function promptRecipeText(pack: StylePack): string {
	const recipe = pack.promptRecipe;
	if (!recipe) return '';
	return [
		recipe.positivePrefix,
		recipe.positiveSuffix,
		recipe.negativeAdditions,
		...recipe.palette,
	].join('\n');
}

export function assertNoBannedReferences(packs: readonly StylePack[]): void {
	for (const pack of packs) {
		const text = promptRecipeText(pack);
		for (const { name, pattern } of BANNED_PATTERNS) {
			if (pattern.test(text)) {
				throw new StylePackError(
					`Style pack "${pack.id}" prompt recipe references banned style source "${name}"`,
				);
			}
		}
	}
}
