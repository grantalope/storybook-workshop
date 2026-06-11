// @graph-layer: private
// @rationale: public-safe prompt composition at imagegen request boundary

import type { ImageGenRequest } from '$lib/services/imagegen/types';
import { getStylePack } from './StylePackRegistry';
import { StylePackError } from './types';

function joinPromptParts(parts: Array<string | undefined>): string {
	return parts
		.map((part) => part?.trim())
		.filter((part): part is string => !!part)
		.join(', ');
}

export function applyStylePackToRequest(req: ImageGenRequest, packId: string): ImageGenRequest {
	const pack = getStylePack(packId);
	if (!pack) {
		throw new StylePackError(`Unknown style pack id "${packId}"`);
	}
	if (pack.legacy) return req;

	const recipe = pack.promptRecipe;
	if (!recipe) {
		throw new StylePackError(`Style pack "${packId}" is missing promptRecipe`);
	}

	return {
		...req,
		prompt: joinPromptParts([recipe.positivePrefix, req.prompt, recipe.positiveSuffix]),
		negativePrompt: joinPromptParts([req.negativePrompt, recipe.negativeAdditions]),
	};
}
