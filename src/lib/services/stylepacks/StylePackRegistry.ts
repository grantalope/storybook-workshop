// @graph-layer: private
// @rationale: public-safe curation guard; no child PII

import { assertNoBannedReferences } from './bannedNames';
import { STYLE_PACKS } from './packs';
import type { StylePack } from './types';
import { StylePackError } from './types';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function assertPresent(value: unknown, message: string): void {
	if (value === undefined || value === null || value === '') {
		throw new StylePackError(message);
	}
}

function assertEducationalCard(pack: StylePack): void {
	const card = pack.educationalCard;
	assertPresent(card, `Style pack "${pack.id}" requires educationalCard`);
	for (const field of [
		'kidExplainer',
		'funFact',
		'lookFor',
		'tryItYourself',
		'famousWorkDescription',
	] as const) {
		if (!card?.[field]?.trim()) {
			throw new StylePackError(`Style pack "${pack.id}" educationalCard.${field} is empty`);
		}
	}
}

function assertPromptRecipe(pack: StylePack): void {
	const recipe = pack.promptRecipe;
	assertPresent(recipe, `Style pack "${pack.id}" requires promptRecipe`);
	for (const field of ['positivePrefix', 'positiveSuffix', 'negativeAdditions'] as const) {
		if (!recipe?.[field]?.trim()) {
			throw new StylePackError(`Style pack "${pack.id}" promptRecipe.${field} is empty`);
		}
	}
	if (!recipe?.palette?.length) {
		throw new StylePackError(`Style pack "${pack.id}" promptRecipe.palette is empty`);
	}
	for (const color of recipe.palette) {
		if (!HEX_COLOR_RE.test(color)) {
			throw new StylePackError(`Style pack "${pack.id}" has invalid palette color "${color}"`);
		}
	}
}

export function validateStylePack(pack: StylePack, currentYear = new Date().getFullYear()): void {
	if (!pack.id.trim()) throw new StylePackError('Style pack id is required');
	if (!pack.displayName.trim()) throw new StylePackError(`Style pack "${pack.id}" displayName is required`);

	if (pack.legacy) return;

	if (!pack.era) {
		throw new StylePackError(`Style pack "${pack.id}" requires era`);
	}
	if (pack.era.end > 1955) {
		throw new StylePackError(`Style pack "${pack.id}" era ends after 1955`);
	}
	for (const inspiration of pack.inspirations) {
		if (inspiration.died + 70 > currentYear) {
			throw new StylePackError(
				`Style pack "${pack.id}" inspiration "${inspiration.name}" is not public-domain safe in ${currentYear}`,
			);
		}
	}
	if (pack.cultureTag && !pack.respectNote?.trim()) {
		throw new StylePackError(`Style pack "${pack.id}" with cultureTag requires respectNote`);
	}
	assertPromptRecipe(pack);
	assertEducationalCard(pack);
}

function validateAll(packs: readonly StylePack[]): readonly StylePack[] {
	for (const pack of packs) validateStylePack(pack);
	assertNoBannedReferences(packs);
	return packs;
}

export const ALL_STYLE_PACKS: readonly StylePack[] = validateAll(STYLE_PACKS);

const STYLE_PACK_BY_ID = new Map(ALL_STYLE_PACKS.map((pack) => [pack.id, pack]));

export function getStylePack(id: string): StylePack | null {
	return STYLE_PACK_BY_ID.get(id) ?? null;
}

export function listStylePacks(): StylePack[] {
	return [...ALL_STYLE_PACKS];
}

export function isLegacyStyle(id: string): boolean {
	return getStylePack(id)?.legacy === true;
}
