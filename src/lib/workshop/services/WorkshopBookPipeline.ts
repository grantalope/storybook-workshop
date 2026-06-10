// @graph-layer: private
// @rationale: private (per-draft generation pipeline — runs locally only)

// src/lib/workshop/services/WorkshopBookPipeline.ts
//
// Orchestrates the Station-6 generation:
//   1. Compose StoryInput from draft outputs
//   2. storyAuthorService.author(...) → SceneTree
//   3. mockRenderAllScenes(...) → wbPngsByScene Map (real HD-2D ships in goal #12)
//   4. bookAssembler.assemble({ ...bundle, skipValidation: true }) → AssembledBook
//   5. Returns Output (pdfBlob + shortcode + hash + pageCount)

import { assemble } from '$lib/services/assemble/BookAssembler';
import type {
	AnimationManifest,
	AssembledBook,
	BookAssetBundle,
	BookFormat,
	SidekickSettlerInfo,
} from '$lib/services/assemble/types';
import { storyAuthorService } from '$lib/services/author/StoryAuthorService';
import type { SceneTree, StoryInput } from '$lib/services/author/types';
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
}

export interface PipelineOpts {
	onProgress?: (p: PipelineProgress) => void;
	/** Test override — skip the LLM and use the deterministic template fallback. */
	forceTemplate?: boolean;
}

function pickFormat(targetSpreads: number): BookFormat {
	if (targetSpreads <= 8) return 'saddlestitch-8x8';
	if (targetSpreads >= 16) return 'hardcover-8x8';
	return 'softcover-8x8';
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
		sidekickName: outputs.s4.sidekickName,
		supportingCast: outputs.s4.supportingCast,
		localeBiome: outputs.s4.localeBiome,
		targetSpreads: outputs.s1.targetSpreads,
		dedicationText: outputs.s3.dedicationText,
		dialogicPromptsEnabled: outputs.s5.dialogicPromptsEnabled,
		easierReadingMode: outputs.s5.easierReadingMode,
	};
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

	emit({ stage: 'render', message: 'Rendering scenes…' });
	const { wbPngsByScene } = await mockRenderAllScenes(tree, outputs.s5!.artStyle);

	emit({ stage: 'assemble', message: 'Binding the book…' });
	const spreadCount = Array.from(wbPngsByScene.values()).reduce((n, arr) => n + arr.length, 0);
	const sidekickInfo: SidekickSettlerInfo = {
		settlerId: outputs.s4!.sidekickSettlerId,
		displayName: outputs.s4!.sidekickSettlerId,
	};
	const bundle: BookAssetBundle = {
		wbPngsByScene,
		pretextStaticFrames: new Map<number, Blob>(),
		animationManifests: new Map<number, AnimationManifest>(),
		kidName: outputs.s4!.heroName,
		dedication: outputs.s3!.dedicationText,
		sidekickSettlerInfo: sidekickInfo,
		title: tree.title,
		backCoverBlurb: tree.back_cover_blurb,
		format: pickFormat(input.targetSpreads),
		pages: Math.max(spreadCount * 2, 4),
		authorByline: outputs.s5!.authorByline,
	};
	const book = await assemble(bundle, { skipValidation: true });
	const pdfHash = await blobHash(book.pdfBlob);

	emit({ stage: 'done', message: 'Done!' });
	return { tree, book, pdfHash, pageCount: bundle.pages };
}
