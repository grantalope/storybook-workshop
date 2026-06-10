// @graph-layer: private
// tests/scenerender/helpers.ts
//
// Shared fixtures for the scenerender suite: minimal SceneTree builders and
// an instrumented fake ImageGenProvider. NO real GPU calls anywhere.

import type { Beat, BeatName, Scene, SceneTree, Spread } from '$lib/services/author/types';
import type {
	ImageGenProvider,
	ImageGenRequest,
	UpscaleRequest,
} from '$lib/services/imagegen';
import type { CharacterDNA } from '$lib/services/scenerender';

// ---------------------------------------------------------------------------
// Tree fixtures
// ---------------------------------------------------------------------------

export function makeSpread(spreadIndex: number, text: string, brief?: string): Spread {
	return { spreadIndex, spread_text: text, text_focus: 'left', illustration_brief: brief };
}

export function makeScene(sceneId: string, spreads: Spread[], sceneBrief = ''): Scene {
	return {
		sceneId,
		spreadCount: Math.min(5, Math.max(1, spreads.length)) as Scene['spreadCount'],
		sceneBrief,
		spreads,
	};
}

const BEAT_NAMES: readonly BeatName[] = [
	'setup',
	'catalyst',
	'debate',
	'midpoint',
	'trial',
	'climax',
	'resolution',
];

export function makeTree(scenesByBeat: Scene[][]): SceneTree {
	return {
		title: 'Test Book',
		back_cover_blurb: 'A small test story.',
		page_budget: scenesByBeat.flat().reduce((n, s) => n + s.spreads.length, 0),
		beats: scenesByBeat.map(
			(scenes, i): Beat => ({
				id: (i + 1) as Beat['id'],
				beat_name: BEAT_NAMES[i],
				emotional_arc: 'calm → curious',
				scenes,
			}),
		),
		tier2_words: [],
	};
}

/** 2 beats / 3 scenes / 6 spreads (indices 0..5). */
export function makeSixSpreadTree(): SceneTree {
	return makeTree([
		[
			makeScene('scene-a', [
				makeSpread(0, 'The hero wakes up.', 'the hero stretching in a sunlit clearing'),
				makeSpread(1, 'Pip arrives with his lantern.', 'the sidekick hedgehog Pip holding a lantern'),
			]),
			makeScene('scene-b', [
				makeSpread(2, '{HERO_NAME} hears thunder.', 'the hero looking up at storm clouds'),
			]),
		],
		[
			makeScene('scene-c', [
				makeSpread(3, 'They walk together.', 'the hero and Pip walking a forest path'),
				makeSpread(4, 'The storm grows.', 'dark clouds over the trees'),
				makeSpread(5, 'A warm light ahead.', 'a glowing cottage window in the rain'),
			]),
		],
	]);
}

export const HERO_DNA: CharacterDNA = {
	id: 'hero',
	role: 'hero',
	description: 'the hero: a small young child with short curly hair, wearing a yellow raincoat',
};

export const SIDEKICK_DNA: CharacterDNA = {
	id: 'pip-hedgehog',
	role: 'sidekick',
	description: 'the sidekick: Pip, a tiny round hedgehog carrying a small glowing brass lantern',
	matchTerms: ['pip', 'hedgehog', 'lantern', 'sidekick'],
};

// ---------------------------------------------------------------------------
// Instrumented fake provider
// ---------------------------------------------------------------------------

/**
 * Blob markers: byte0 0x01 = generated, 0x02 = upscaled print image.
 * byte1 = (seed % 251) so order tests can trace which request produced
 * which blob.
 */
export interface FakeProviderOpts {
	name?: string;
	/** Per-generate artificial delay — makes concurrency observable. */
	genDelayMs?: number;
	/** Seeds whose FIRST generate call throws (retry-path testing). */
	failSeedsOnce?: number[];
}

export function makeFakeProvider(opts: FakeProviderOpts = {}) {
	const genCalls: ImageGenRequest[] = [];
	const upscaleCalls: UpscaleRequest[] = [];
	const pendingFails = new Set(opts.failSeedsOnce ?? []);
	let inFlight = 0;
	const state = { maxInFlight: 0 };
	const provider: ImageGenProvider = {
		name: opts.name ?? 'fake-local-gpu',
		async generate(req) {
			genCalls.push(req);
			inFlight++;
			state.maxInFlight = Math.max(state.maxInFlight, inFlight);
			if (opts.genDelayMs) await new Promise((r) => setTimeout(r, opts.genDelayMs));
			inFlight--;
			if (req.seed !== undefined && pendingFails.has(req.seed)) {
				pendingFails.delete(req.seed);
				throw new Error(`fake generation failure for seed ${req.seed}`);
			}
			const seedByte = (req.seed ?? 0) % 251;
			return {
				images: [new Blob([new Uint8Array([0x01, seedByte])], { type: 'image/png' })],
				seed: req.seed ?? 0,
				providerMeta: { provider: 'fake' },
			};
		},
		async upscale(req) {
			upscaleCalls.push(req);
			const src = new Uint8Array(await (req.image as Blob).arrayBuffer());
			return {
				image: new Blob([new Uint8Array([0x02, src[1] ?? 0])], { type: 'image/png' }),
				providerMeta: { provider: 'fake' },
			};
		},
	};
	return Object.assign(provider, { genCalls, upscaleCalls, state });
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}
