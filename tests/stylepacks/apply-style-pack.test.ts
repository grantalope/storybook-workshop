import { describe, expect, it } from 'vitest';
import {
	applyStylePackToRequest,
	getStylePack,
	StylePackError,
} from '$lib/services/stylepacks';
import type { ImageGenRequest } from '$lib/services/imagegen';

describe('applyStylePackToRequest', () => {
	it('adds prompt recipe text and negative additions without mutating the request', () => {
		const req: ImageGenRequest = {
			prompt: 'the hero walks beside a moonlit pond',
			negativePrompt: 'blurry',
			width: 512,
			height: 512,
			seed: 42,
		};
		const original = { ...req };
		const pack = getStylePack('ukiyo-e-woodblock')!;

		const out = applyStylePackToRequest(req, pack.id);

		expect(out).not.toBe(req);
		expect(req).toEqual(original);
		expect(out.prompt).toBe(
			`${pack.promptRecipe!.positivePrefix}, ${req.prompt}, ${pack.promptRecipe!.positiveSuffix}`,
		);
		expect(out.negativePrompt).toBe(`blurry, ${pack.promptRecipe!.negativeAdditions}`);
	});

	it('returns legacy renderer-mode requests unchanged', () => {
		const req: ImageGenRequest = {
			prompt: 'a small library in the woods',
			width: 512,
			height: 512,
			styleId: 'octopath-hd2d',
		};
		expect(applyStylePackToRequest(req, 'octopath-hd2d')).toBe(req);
	});

	it('throws a StylePackError naming unknown ids', () => {
		expect(() =>
			applyStylePackToRequest({ prompt: 'x', width: 64, height: 64 }, 'missing-pack'),
		).toThrow(StylePackError);
		expect(() =>
			applyStylePackToRequest({ prompt: 'x', width: 64, height: 64 }, 'missing-pack'),
		).toThrow(/missing-pack/);
	});
});
