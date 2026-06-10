// @graph-layer: private
// @rationale: private (character sheets derive from per-kid character DNA)

// src/lib/services/scenerender/CharacterSheetService.ts
//
// Hero + sidekick character-sheet generation via ImageGenProvider. Plain T2I
// from the character-DNA prompt (proven by the e2e real-book run on the
// split-loader Qwen-Image-2512 stack): one multi-view reference sheet per
// character — front / side / back on a plain cream background.
//
// The multi-view sheet is exactly the conditioning shape the
// Qwen-Image-Edit-2511 multi-reference path consumes: when Edit-2511 is
// available, RealSceneRenderer passes these sheets as `characterRefs` on
// every spread (opt-in via `useCharacterRefs`). When it is not — the state
// the e2e run proved — the sheets remain preview artifacts and consistency
// rides on the fixed character-DNA prompt block instead.

import { ImageGenError, type ImageGenProvider } from '$lib/services/imagegen';
import type { ArtStyle } from '$lib/workshop/types';
import { BASE_SEED, GEN_PX, composeCharacterSheetPrompt } from './ScenePromptComposer';
import type { CharacterDNA, SceneRenderProgressFn } from './types';

/** Sheet seeds start at baseSeed + 1 (e2e: hero +1, sidekick +2). */
export const SHEET_SEED_OFFSET = 1;

export interface CharacterSheetServiceOpts {
	provider: ImageGenProvider;
	/** Deterministic seed base (default BASE_SEED). */
	baseSeed?: number;
	/** Square sheet size in px (default GEN_PX). */
	sheetPx?: number;
	/** Default true — multi-view front/side/back reference sheet. */
	multiView?: boolean;
}

export class CharacterSheetService {
	private _provider: ImageGenProvider;
	private _baseSeed: number;
	private _sheetPx: number;
	private _multiView: boolean;

	constructor(opts: CharacterSheetServiceOpts) {
		this._provider = opts.provider;
		this._baseSeed = opts.baseSeed ?? BASE_SEED;
		this._sheetPx = opts.sheetPx ?? GEN_PX;
		this._multiView = opts.multiView ?? true;
	}

	/**
	 * Generate one sheet per character (sequential — sheets are few and each
	 * later spread may condition on them). Returns characterId → sheet PNG.
	 */
	async generateSheets(
		characters: readonly CharacterDNA[],
		artStyle: ArtStyle,
		onProgress?: SceneRenderProgressFn,
	): Promise<Map<string, Blob>> {
		const sheets = new Map<string, Blob>();
		for (let i = 0; i < characters.length; i++) {
			const character = characters[i];
			const req = composeCharacterSheetPrompt({
				character,
				artStyle,
				seed: this._baseSeed + SHEET_SEED_OFFSET + i,
				size: this._sheetPx,
				multiView: this._multiView,
			});
			const res = await this._provider.generate(req);
			if (res.images.length === 0) {
				throw new ImageGenError(
					'provider',
					`scenerender: character sheet for "${character.id}" returned no images`,
				);
			}
			sheets.set(character.id, res.images[0]);
			onProgress?.({
				phase: 'character-sheets',
				done: i + 1,
				total: characters.length,
				label: `character-sheet-${character.id}`,
			});
		}
		return sheets;
	}
}
