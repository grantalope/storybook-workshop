// @graph-layer: private
// @rationale: private (drives per-book image generation from story briefs)

// src/lib/services/scenerender/RealSceneRenderer.ts
//
// SceneTree → real per-spread image generation. Ports the pipeline proven by
// scripts/e2e/generate-real-book.mjs (feat/e2e-real-book @ ca00d61) into a
// proper service:
//
//   1. hero + sidekick character sheets (CharacterSheetService, sequential)
//   2. one generation per spread at GEN_PX, concurrency-capped (default 2 —
//      keeps the 4090's VRAM happy while still pipelining upload/poll gaps)
//   3. print-res upscale (scale = printPx / genPx) per spread
//   4. → wbPngsByScene Map, the exact drop-in shape MockSceneRenderer
//      produces for BookAssetBundle
//
// Provider selection lives with the caller (WorkshopBookPipeline resolves
// IMAGE_GEN_PROVIDER local | cloud | mock via resolveImageGenProvider; mock
// stays the default in tests/CI). This class never reads env.

import { ImageGenError, MAX_CHARACTER_REFS, type ImageGenProvider } from '$lib/services/imagegen';
import type { LocaleBiome, Scene, SceneTree } from '$lib/services/author/types';
import type { ArtStyle } from '$lib/workshop/types';
import { CharacterSheetService } from './CharacterSheetService';
import {
	BASE_SEED,
	GEN_PX,
	PRINT_PX,
	buildCharacterDnaBlock,
	composeScenePrompt,
} from './ScenePromptComposer';
import type { CharacterDNA, SceneRenderProgressFn, SceneRenderResult } from './types';

/** Spread seeds start at baseSeed + 100 + spreadIndex (e2e layout). */
export const SPREAD_SEED_OFFSET = 100;

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_RETRY_DELAY_MS = 5_000;

export interface SceneRenderContext {
	artStyle: ArtStyle;
	locale: LocaleBiome;
	/** Hero first by convention; see buildCharacterDnaBlock for inclusion rules. */
	characters: CharacterDNA[];
}

export interface RealSceneRendererOpts {
	provider: ImageGenProvider;
	/** Max in-flight spread generations (default 2). */
	concurrency?: number;
	/** Generation resolution (default GEN_PX = 1024). */
	genPx?: number;
	/** Print resolution after upscale (default PRINT_PX = 2475). */
	printPx?: number;
	/** Deterministic seed base (default BASE_SEED). */
	baseSeed?: number;
	/**
	 * Condition every spread on the character sheets via multi-ref edit
	 * (Qwen-Image-Edit-2511). Default false — the e2e run proved the
	 * prompt-DNA path; flip when Edit-2511 is installed on the provider.
	 */
	useCharacterRefs?: boolean;
	/** Multi-view character sheets (default true). */
	multiViewSheets?: boolean;
	/** Delay before the single per-spread retry (default 5s; 0 in tests). */
	retryDelayMs?: number;
	sleep?: (ms: number) => Promise<void>;
	onProgress?: SceneRenderProgressFn;
}

interface SpreadTask {
	sceneId: string;
	/** Slot within the scene's Blob[] (preserves order under concurrency). */
	slot: number;
	/** Book-global spread index (drives the deterministic seed + label). */
	spreadIndex: number;
	brief: string;
	/** brief + spread text — match haystack for sidekick DNA inclusion. */
	contextText: string;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run async tasks with a fixed worker-pool cap, preserving result order. */
async function runPool(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
		for (;;) {
			const i = next++;
			if (i >= tasks.length) return;
			await tasks[i]();
		}
	});
	await Promise.all(workers);
}

export class RealSceneRenderer {
	private _provider: ImageGenProvider;
	private _concurrency: number;
	private _genPx: number;
	private _printPx: number;
	private _baseSeed: number;
	private _useCharacterRefs: boolean;
	private _multiViewSheets: boolean;
	private _retryDelayMs: number;
	private _sleep: (ms: number) => Promise<void>;
	private _onProgress?: SceneRenderProgressFn;

	constructor(opts: RealSceneRendererOpts) {
		this._provider = opts.provider;
		this._concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
		this._genPx = opts.genPx ?? GEN_PX;
		this._printPx = opts.printPx ?? PRINT_PX;
		this._baseSeed = opts.baseSeed ?? BASE_SEED;
		this._useCharacterRefs = opts.useCharacterRefs ?? false;
		this._multiViewSheets = opts.multiViewSheets ?? true;
		this._retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		this._sleep = opts.sleep ?? defaultSleep;
		this._onProgress = opts.onProgress;
	}

	/**
	 * Render every spread in the tree. Returns the MockSceneRenderer drop-in
	 * `wbPngsByScene` Map (sceneId → ordered print-res Blobs) plus the
	 * character sheets.
	 */
	async renderAllScenes(tree: SceneTree, ctx: SceneRenderContext): Promise<SceneRenderResult> {
		// ── 1. character sheets ────────────────────────────────────────────
		const sheetService = new CharacterSheetService({
			provider: this._provider,
			baseSeed: this._baseSeed,
			sheetPx: this._genPx,
			multiView: this._multiViewSheets,
		});
		const characterSheets =
			ctx.characters.length > 0
				? await sheetService.generateSheets(ctx.characters, ctx.artStyle, this._onProgress)
				: new Map<string, Blob>();
		const refs =
			this._useCharacterRefs && characterSheets.size > 0
				? Array.from(characterSheets.values()).slice(0, MAX_CHARACTER_REFS)
				: undefined;

		// ── 2. flatten spreads into tasks (tree order = canonical order) ───
		const wbPngsByScene = new Map<string, Blob[]>();
		const tasks: SpreadTask[] = [];
		let globalIndex = 0;
		for (const beat of tree.beats) {
			for (const scene of beat.scenes) {
				const rows = sceneRows(scene);
				const slots: Blob[] = new Array(rows.length);
				wbPngsByScene.set(scene.sceneId, slots);
				rows.forEach((row, slot) => {
					const spreadIndex = Number.isInteger(row.spreadIndex)
						? (row.spreadIndex as number)
						: globalIndex;
					tasks.push({
						sceneId: scene.sceneId,
						slot,
						spreadIndex,
						brief: row.brief,
						contextText: row.contextText,
					});
					globalIndex++;
				});
			}
		}

		// ── 3. generate + upscale with the concurrency cap ─────────────────
		let done = 0;
		const total = tasks.length;
		await runPool(
			tasks.map((task) => async () => {
				const blob = await this._renderSpread(task, ctx, refs);
				wbPngsByScene.get(task.sceneId)![task.slot] = blob;
				done++;
				this._onProgress?.({
					phase: 'spreads',
					done,
					total,
					label: `spread-${String(task.spreadIndex + 1).padStart(2, '0')}`,
				});
			}),
			this._concurrency,
		);

		return { wbPngsByScene, characterSheets };
	}

	// -----------------------------------------------------------------------

	private async _renderSpread(
		task: SpreadTask,
		ctx: SceneRenderContext,
		refs: Blob[] | undefined,
	): Promise<Blob> {
		const characterDna = buildCharacterDnaBlock(ctx.characters, task.contextText);
		const baseReq = composeScenePrompt({
			illustrationBrief: task.brief,
			artStyle: ctx.artStyle,
			locale: ctx.locale,
			characterDna,
			refs,
			width: this._genPx,
			height: this._genPx,
		});
		const seed = this._baseSeed + SPREAD_SEED_OFFSET + task.spreadIndex;

		// One retry with seed+1 (e2e-proven recovery from transient gen fails).
		let lastErr: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const res = await this._provider.generate({ ...baseReq, seed: seed + attempt });
				if (res.images.length === 0) {
					throw new ImageGenError(
						'provider',
						`scenerender: spread ${task.spreadIndex + 1} generation returned no images`,
					);
				}
				const up = await this._provider.upscale({
					image: res.images[0],
					scale: this._printPx / this._genPx,
				});
				return up.image;
			} catch (err) {
				lastErr = err;
				if (attempt === 0 && this._retryDelayMs > 0) await this._sleep(this._retryDelayMs);
			}
		}
		throw lastErr;
	}
}

interface SceneRow {
	spreadIndex: number | undefined;
	brief: string;
	contextText: string;
}

/**
 * Rows to render for one scene. Uses the scene's real spreads; degrades to
 * `spreadCount` sceneBrief rows for legacy trees without spread arrays so
 * the result shape stays parity with mockRenderAllScenes.
 */
function sceneRows(scene: Scene): SceneRow[] {
	if (scene.spreads?.length) {
		return scene.spreads.map((spread) => ({
			spreadIndex: Number.isInteger(spread.spreadIndex) ? spread.spreadIndex : undefined,
			brief: (spread.illustration_brief || scene.sceneBrief || spread.spread_text || '').trim(),
			contextText: `${spread.illustration_brief ?? ''} ${spread.spread_text ?? ''}`.trim(),
		}));
	}
	const count = Math.max(1, scene.spreadCount ?? 1);
	return Array.from({ length: count }, () => ({
		spreadIndex: undefined,
		brief: (scene.sceneBrief ?? '').trim(),
		contextText: (scene.sceneBrief ?? '').trim(),
	}));
}
