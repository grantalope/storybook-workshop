// @graph-layer: private
// @rationale: public-safe style metadata; no child PII

import type { ImageGenRequest } from '$lib/services/imagegen/types';

export type CultureTag = 'japan' | 'persia' | 'mexico' | 'scandinavia';

export interface StylePack {
	id: string;
	displayName: string;
	legacy?: boolean;
	era?: { start: number; end: number };
	cultureTag?: CultureTag;
	respectNote?: string;
	inspirations: Array<{ name: string; died: number }>;
	promptRecipe?: {
		positivePrefix: string;
		positiveSuffix: string;
		negativeAdditions: string;
		palette: string[];
	};
	educationalCard?: {
		kidExplainer: string;
		funFact: string;
		lookFor: string;
		tryItYourself: string;
		famousWorkDescription: string;
	};
}

export class StylePackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StylePackError';
	}
}

export type StylePackImageGenRequest = ImageGenRequest;
