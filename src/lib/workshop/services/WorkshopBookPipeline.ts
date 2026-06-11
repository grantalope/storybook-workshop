// @graph-layer: private
// @rationale: private (per-draft generation pipeline — runs locally only)

// src/lib/workshop/services/WorkshopBookPipeline.ts
//
// Orchestrates the Station-6 generation:
//   1. Compose StoryInput from draft outputs
//   2. storyAuthorService.author(...) → SceneTree
//   3. Render scenes → wbPngsByScene Map
//        - IMAGE_GEN_PROVIDER=mock (default, tests/CI): MockSceneRenderer
//          placeholder PNGs, byte-identical to the pre-scenerender pipeline
//        - IMAGE_GEN_PROVIDER=local|cloud: RealSceneRenderer — character
//          sheets + per-spread generation (concurrency 2) + print-res
//          upscale via the resolved ImageGenProvider
//   4. bookAssembler.assemble(...) → AssembledBook
//        - mock path keeps skipValidation: true (1×1 placeholder PNGs can't
//          satisfy the Lulu print spec)
//        - real path runs the full LuluPdfSpecValidator gate
//          (skipValidation: false) and passes the spread prose through for
//          the name-overlay compositor
//   5. Returns Output (pdfBlob + shortcode + hash + pageCount)

import { assemble } from '$lib/services/assemble/BookAssembler';
import type {
	AnimationManifest,
	AssembledBook,
	BookAssetBundle,
	BookFormat,
	SidekickSettlerInfo,
} from '$lib/services/assemble/types';
import { FORMAT_DIMENSIONS } from '$lib/services/assemble/types';
import { storyAuthorService } from '$lib/services/author/StoryAuthorService';
import type { GrammarGateTelemetry, SceneTree, StoryInput } from '$lib/services/author/types';
import {
	resolveImageGenProvider,
	type ImageGenEnv,
	type ImageGenProvider,
} from '$lib/services/imagegen';
import {
	RealSceneRenderer,
	charactersFromStation4,
	type RealSceneRendererOpts,
} from '$lib/services/scenerender';
import { getKidProfileStore } from '$lib/workshop/services/KidProfileStore';
import { mockRenderAllScenes } from '$lib/workshop/services/MockSceneRenderer';
import type {
	StationOutputs,
	WorkshopDraft,
} from '$lib/workshop/types';

export interface PipelineProgress {
	stage: 'author' | 'render' | 'assemble' | 'done';
	message: string;
}

export interface PipelineResult {
	tree: SceneTree;
	book: AssembledBook;
	pdfHash: string;
	pageCount: number;
	/**
	 * Grammar-gate telemetry from the author stage (mirrors
	 * `tree.meta.grammarGate`). `salvaged: true` = the shipped story is a
	 * real-LLM draft that did not fully pass the deterministic Stein-Glenn
	 * gate; surfaced here so operators/inspectors see it without digging
	 * through tree meta.
	 */
	grammarGate?: GrammarGateTelemetry;
}

export interface PipelineOpts {
	onProgress?: (p: PipelineProgress) => void;
	/** Test override — skip the LLM and use the deterministic template fallback. */
	forceTemplate?: boolean;
	/** Injectable provider (tests). Default: resolveImageGenProvider(imageGenEnv). */
	provider?: ImageGenProvider;
	/** Env override for provider resolution (tests). Default: process.env. */
	imageGenEnv?: ImageGenEnv;
	/** Renderer tuning overrides for the real path (tests: tiny px, zero retry delay). */
	renderOpts?: Partial<Omit<RealSceneRendererOpts, 'provider' | 'onProgress'>>;
	/** Optional hero appearance DNA (e.g. heroDnaFromPillarAxes(matchedPillar.axes)). */
	heroDna?: string;
}

function pickFormat(targetSpreads: number): BookFormat {
	if (targetSpreads <= 8) return 'saddlestitch-8x8';
	if (targetSpreads >= 16) return 'hardcover-8x8';
	return 'softcover-8x8';
}

/**
 * Interior page count that satisfies the format's Lulu constraints (min
 * pages + page-count multiple). The real-render path runs the full
 * LuluPdfSpecValidator gate, so the declared count must be valid.
 */
function clampPagesToFormat(spreadCount: number, format: BookFormat): number {
	const dims = FORMAT_DIMENSIONS[format];
	let pages = Math.max(spreadCount * 2, dims.minPages);
	const rem = pages % dims.pageCountMultiple;
	if (rem !== 0) pages += dims.pageCountMultiple - rem;
	return pages;
}

async function blobHash(b: Blob): Promise<string> {
	const ab = await b.arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', ab);
	return Array.from(new Uint8Array(digest))
		.map((x) => x.toString(16).padStart(2, '0'))
		.join('');
}

export async function buildStoryInput(
	draft: WorkshopDraft,
	outputs: StationOutputs,
): Promise<StoryInput> {
	if (!outputs.s1 || !outputs.s2 || !outputs.s3 || !outputs.s4 || !outputs.s5) {
		throw new Error('Pipeline: stations 1-5 must be completed before Station 6');
	}
	const kid = await getKidProfileStore().get(draft.kidId);
	if (!kid) throw new Error(`Pipeline: kid not found: ${draft.kidId}`);
	return {
		kidName: outputs.s4.heroName || kid.name,
		ageBand: kid.ageBand,
		ehriPhase: outputs.s1.ehriPhase,
		theme: outputs.s1.theme,
		occasion: outputs.s1.occasion,
		sidekickSettlerId: outputs.s4.sidekickSettlerId,
		supportingCast: outputs.s4.supportingCast,
		localeBiome: outputs.s4.localeBiome,
		targetSpreads: outputs.s1.targetSpreads,
		dedicationText: outputs.s3.dedicationText,
		dialogicPromptsEnabled: outputs.s5.dialogicPromptsEnabled,
		easierReadingMode: outputs.s5.easierReadingMode,
	};
}

/** Flatten spread prose in canonical tree order (matches the render order). */
function flattenSpreadTexts(tree: SceneTree): string[] {
	const texts: string[] = [];
	for (const beat of tree.beats) {
		for (const scene of beat.scenes) {
			if (scene.spreads?.length) {
				for (const spread of scene.spreads) texts.push(spread.spread_text ?? '');
			} else {
				const count = Math.max(1, scene.spreadCount ?? 1);
				for (let i = 0; i < count; i++) texts.push('');
			}
		}
	}
	return texts;
}

/** Scene ids in canonical tree order — pins BookAssembler spread order. */
function sceneOrderOf(tree: SceneTree): string[] {
	const order: string[] = [];
	for (const beat of tree.beats) for (const scene of beat.scenes) order.push(scene.sceneId);
	return order;
}

export async function runWorkshopPipeline(
	draft: WorkshopDraft,
	opts: PipelineOpts = {},
): Promise<PipelineResult> {
	const outputs = draft.outputs;
	const emit = opts.onProgress ?? (() => {});

	emit({ stage: 'author', message: 'Authoring story…' });
	const input = await buildStoryInput(draft, outputs);
	const tree = await storyAuthorService.author(input, {
		forceTemplate: opts.forceTemplate,
	});

	// Surface grammar-gate telemetry (incl. salvage mode) instead of burying it
	// in tree meta — operators should see when a draft shipped under salvage.
	const grammarGate = tree.meta?.grammarGate;
	if (grammarGate?.salvaged) {
		emit({
			stage: 'author',
			message: `Story salvaged: grammar gate not fully green (avg ${grammarGate.avgScore.toFixed(2)})`,
		});
		// eslint-disable-next-line no-console
		console.warn('[WorkshopBookPipeline] salvage mode shipped draft', grammarGate);
	}

	emit({ stage: 'render', message: 'Rendering scenes…' });
	const stylePackId = outputs.s5!.artStyle;
	const provider = opts.provider ?? resolveImageGenProvider(opts.imageGenEnv);
	const isMock = provider.name === 'mock';
	let wbPngsByScene: Map<string, Blob[]>;
	if (isMock) {
		({ wbPngsByScene } = await mockRenderAllScenes(tree, stylePackId));
	} else {
		const renderer = new RealSceneRenderer({
			provider,
			...opts.renderOpts,
			onProgress: (p) =>
				emit({ stage: 'render', message: `Rendering ${p.label} (${p.done}/${p.total})…` }),
		});
		const rendered = await renderer.renderAllScenes(tree, {
			stylePackId,
			locale: input.localeBiome,
			characters: charactersFromStation4(outputs.s4!, input.ageBand, opts.heroDna),
		});
		wbPngsByScene = rendered.wbPngsByScene;
	}

	emit({ stage: 'assemble', message: 'Binding the book…' });
	const spreadCount = Array.from(wbPngsByScene.values()).reduce((n, arr) => n + arr.length, 0);
	const sidekickInfo: SidekickSettlerInfo = {
		settlerId: outputs.s4!.sidekickSettlerId,
		displayName: outputs.s4!.sidekickSettlerId,
	};
	const format = pickFormat(input.targetSpreads);
	const bundle: BookAssetBundle = {
		wbPngsByScene,
		pretextStaticFrames: new Map<number, Blob>(),
		animationManifests: new Map<number, AnimationManifest>(),
		kidName: outputs.s4!.heroName,
		dedication: outputs.s3!.dedicationText,
		sidekickSettlerInfo: sidekickInfo,
		title: tree.title,
		backCoverBlurb: tree.back_cover_blurb,
		format,
		// Mock path keeps the legacy page math byte-identical; the real path
		// must declare a Lulu-valid count because the validator gate is live.
		pages: isMock ? Math.max(spreadCount * 2, 4) : clampPagesToFormat(spreadCount, format),
		authorByline: outputs.s5!.authorByline,
		stylePackId,
		...(isMock ? {} : { sceneOrder: sceneOrderOf(tree) }),
	};
	const spreadTexts = flattenSpreadTexts(tree);
	const book = await assemble(
		bundle,
		isMock
			? { skipValidation: true, stylePackId }
			: {
					skipValidation: false,
					stylePackId,
					...(spreadTexts.length === spreadCount ? { spreadTexts } : {}),
				},
	);
	const pdfHash = await blobHash(book.pdfBlob);

	emit({ stage: 'done', message: 'Done!' });
	return { tree, book, pdfHash, pageCount: book.audit.pageCount, grammarGate };
}
