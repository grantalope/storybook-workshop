// @graph-layer: private
// @rationale: private (scenerender barrel)

// src/lib/services/scenerender/index.ts
//
// Public barrel for the real scene-render subsystem: prompt recipes
// (ScenePromptComposer), character sheets (CharacterSheetService), and the
// SceneTree → wbPngsByScene renderer (RealSceneRenderer). Provider selection
// (IMAGE_GEN_PROVIDER local | cloud | mock) stays in $lib/services/imagegen.

export type {
	CharacterDNA,
	CharacterRole,
	SceneRenderProgress,
	SceneRenderProgressFn,
	SceneRenderResult,
} from './types';

export {
	BASE_SEED,
	GEN_PX,
	LOCALE_FRAGMENTS,
	MULTI_VIEW_SHEET_RECIPE,
	NEGATIVE_PROMPT,
	PRINT_PX,
	SINGLE_VIEW_SHEET_RECIPE,
	STYLE_PREFIXES,
	buildCharacterDnaBlock,
	charactersFromStation4,
	composeCharacterSheetPrompt,
	composeScenePrompt,
	defaultHeroDna,
	heroDnaFromPillarAxes,
	resolveHeroPlaceholder,
	sidekickDnaFromCast,
	type CharacterSheetPromptOpts,
	type ScenePromptOpts,
} from './ScenePromptComposer';

export {
	CharacterSheetService,
	SHEET_SEED_OFFSET,
	type CharacterSheetServiceOpts,
} from './CharacterSheetService';

export {
	RealSceneRenderer,
	SPREAD_SEED_OFFSET,
	type RealSceneRendererOpts,
	type SceneRenderContext,
} from './RealSceneRenderer';
