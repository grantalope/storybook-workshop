// @graph-layer: private
// tests/scenerender/character-sheet-service.test.ts
//
// CharacterSheetService against the instrumented fake provider. NO GPU.

import { describe, expect, it } from 'vitest';

import {
	BASE_SEED,
	CharacterSheetService,
	MULTI_VIEW_SHEET_RECIPE,
	NEGATIVE_PROMPT,
	SHEET_SEED_OFFSET,
	SINGLE_VIEW_SHEET_RECIPE,
	type SceneRenderProgress,
} from '$lib/services/scenerender';
import { HERO_DNA, SIDEKICK_DNA, makeFakeProvider } from './helpers';

const CHARACTERS = [HERO_DNA, SIDEKICK_DNA];

describe('CharacterSheetService', () => {
	it('generates one sheet per character and returns characterId → Blob', async () => {
		const provider = makeFakeProvider();
		const service = new CharacterSheetService({ provider });
		const sheets = await service.generateSheets(CHARACTERS, 'flat-painted');

		expect(Array.from(sheets.keys())).toEqual(['hero', 'pip-hedgehog']);
		for (const blob of sheets.values()) expect(blob).toBeInstanceOf(Blob);
		expect(provider.genCalls).toHaveLength(2);
		expect(provider.upscaleCalls).toHaveLength(0);
	});

	it('prompts carry the multi-view recipe, the DNA, and the negative prompt', async () => {
		const provider = makeFakeProvider();
		const service = new CharacterSheetService({ provider });
		await service.generateSheets(CHARACTERS, 'flat-painted');

		expect(provider.genCalls[0].prompt).toContain(MULTI_VIEW_SHEET_RECIPE);
		expect(provider.genCalls[0].prompt).toContain(HERO_DNA.description);
		expect(provider.genCalls[1].prompt).toContain(SIDEKICK_DNA.description);
		for (const call of provider.genCalls) {
			expect(call.negativePrompt).toBe(NEGATIVE_PROMPT);
		}
	});

	it('seeds deterministically at baseSeed + 1 + index and honors sheetPx', async () => {
		const provider = makeFakeProvider();
		const service = new CharacterSheetService({ provider, baseSeed: 1_000, sheetPx: 256 });
		await service.generateSheets(CHARACTERS, 'pixel-pure');

		expect(provider.genCalls[0].seed).toBe(1_000 + SHEET_SEED_OFFSET);
		expect(provider.genCalls[1].seed).toBe(1_000 + SHEET_SEED_OFFSET + 1);
		expect(provider.genCalls[0].width).toBe(256);
		expect(provider.genCalls[0].height).toBe(256);
	});

	it('defaults to BASE_SEED and supports the single-view mode', async () => {
		const provider = makeFakeProvider();
		const service = new CharacterSheetService({ provider, multiView: false });
		await service.generateSheets([HERO_DNA], 'octopath-hd2d');

		expect(provider.genCalls[0].seed).toBe(BASE_SEED + SHEET_SEED_OFFSET);
		expect(provider.genCalls[0].prompt).toContain(SINGLE_VIEW_SHEET_RECIPE);
	});

	it('reports progress per sheet', async () => {
		const provider = makeFakeProvider();
		const service = new CharacterSheetService({ provider });
		const events: SceneRenderProgress[] = [];
		await service.generateSheets(CHARACTERS, 'flat-painted', (p) => events.push(p));

		expect(events).toEqual([
			{ phase: 'character-sheets', done: 1, total: 2, label: 'character-sheet-hero' },
			{ phase: 'character-sheets', done: 2, total: 2, label: 'character-sheet-pip-hedgehog' },
		]);
	});
});
