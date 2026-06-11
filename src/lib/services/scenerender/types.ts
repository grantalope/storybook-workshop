// @graph-layer: private
// @rationale: private (scene-render boundary — briefs + character DNA feed image prompts)

// src/lib/services/scenerender/types.ts
//
// Canonical shapes for the real scene-render pipeline. The renderer turns a
// SceneTree into the `wbPngsByScene` Map that BookAssetBundle expects — the
// exact drop-in shape MockSceneRenderer produces — but backed by a real
// ImageGenProvider (local ComfyUI / cloud fal.ai / mock).
//
// PRIVACY: CharacterDNA descriptions and illustration briefs may leave the
// device (they are sent to the configured image provider). They must NEVER
// contain the kid's name — briefs say "the hero", and the composer resolves
// any {HERO_NAME} placeholder to "the hero" before prompt assembly.

export type CharacterRole = 'hero' | 'sidekick' | 'supporting';

/**
 * Character DNA — a fixed visual description block injected into every
 * prompt that features the character. This is the consistency mechanism
 * proven by the e2e real-book run when Qwen-Image-Edit-2511 multi-ref
 * conditioning is unavailable (and the prompt backbone even when it is).
 */
export interface CharacterDNA {
	/** Stable id — settler id for sidekicks, 'hero' for the hero. */
	id: string;
	role: CharacterRole;
	/** Visual description fed to the image model. NEVER the kid's name. */
	description: string;
	/**
	 * Case-insensitive terms that mark a spread as featuring this character.
	 * The hero is always included in prompts; non-hero DNA joins only when a
	 * term matches the spread's brief/text. Defaults to `[id]`.
	 */
	matchTerms?: string[];
}

export interface SceneRenderProgress {
	phase: 'character-sheets' | 'spreads';
	/** Completed units in this phase. */
	done: number;
	/** Total units in this phase. */
	total: number;
	/** e.g. 'character-sheet-hero', 'spread-04'. */
	label: string;
}

export type SceneRenderProgressFn = (p: SceneRenderProgress) => void;

/** Drop-in superset of MockSceneRenderResult. */
export interface SceneRenderResult {
	/** sceneId → ordered print-res PNG Blobs (one per spread). */
	wbPngsByScene: Map<string, Blob[]>;
	/** characterId → generation-res character-sheet PNG. */
	characterSheets: Map<string, Blob>;
}
