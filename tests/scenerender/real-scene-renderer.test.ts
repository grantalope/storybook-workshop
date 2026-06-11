// @graph-layer: private
// tests/scenerender/real-scene-renderer.test.ts
//
// RealSceneRenderer against the instrumented fake provider: drop-in shape
// parity with MockSceneRenderer, concurrency cap, ordering, progress,
// retry, seeds, and the character-refs path. NO GPU.

import { describe, expect, it } from 'vitest';

import { collapseLayout, planComposition } from '$lib/services/scenegrammar';
import {
	BASE_SEED,
	RealSceneRenderer,
	SHEET_SEED_OFFSET,
	SPREAD_SEED_OFFSET,
	type SceneRenderProgress,
} from '$lib/services/scenerender';
import { getStylePack } from '$lib/services/stylepacks';
import { mockRenderAllScenes } from '$lib/workshop/services/MockSceneRenderer';
import {
	HERO_DNA,
	SIDEKICK_DNA,
	blobBytes,
	makeFakeProvider,
	makeSixSpreadTree,
} from './helpers';

const CTX = {
	stylePackId: 'flat-painted' as const,
	locale: 'forest' as const,
	characters: [HERO_DNA, SIDEKICK_DNA],
};

function makeRenderer(provider: ReturnType<typeof makeFakeProvider>, extra = {}) {
	return new RealSceneRenderer({ provider, retryDelayMs: 0, ...extra });
}

describe('RealSceneRenderer — output shape', () => {
	it('returns the MockSceneRenderer drop-in wbPngsByScene shape', async () => {
		const tree = makeSixSpreadTree();
		const provider = makeFakeProvider();
		const result = await makeRenderer(provider).renderAllScenes(tree, CTX);
		const mock = await mockRenderAllScenes(tree, 'flat-painted');

		expect(Array.from(result.wbPngsByScene.keys())).toEqual(
			Array.from(mock.wbPngsByScene.keys()),
		);
		for (const [sceneId, blobs] of result.wbPngsByScene) {
			expect(blobs).toHaveLength(mock.wbPngsByScene.get(sceneId)!.length);
			for (const blob of blobs) expect(blob).toBeInstanceOf(Blob);
		}
		expect(Array.from(result.characterSheets.keys())).toEqual(['hero', 'pip-hedgehog']);
	});

	it('stores the upscaled print image per spread (scale = printPx / genPx)', async () => {
		const provider = makeFakeProvider();
		const renderer = makeRenderer(provider, { genPx: 1024, printPx: 2048 });
		const result = await renderer.renderAllScenes(makeSixSpreadTree(), CTX);

		expect(provider.upscaleCalls).toHaveLength(6);
		for (const call of provider.upscaleCalls) expect(call.scale).toBe(2);
		for (const blobs of result.wbPngsByScene.values()) {
			for (const blob of blobs) {
				const bytes = await blobBytes(blob);
				expect(bytes[0]).toBe(0x02); // upscaled marker, not the raw gen
			}
		}
	});

	it('preserves spread order within each scene under concurrency', async () => {
		const provider = makeFakeProvider({ genDelayMs: 5 });
		const result = await makeRenderer(provider).renderAllScenes(makeSixSpreadTree(), CTX);

		const sceneC = result.wbPngsByScene.get('scene-c')!;
		const markers = await Promise.all(sceneC.map(async (b) => (await blobBytes(b))[1]));
		const expected = [3, 4, 5].map((i) => (BASE_SEED + SPREAD_SEED_OFFSET + i) % 251);
		expect(markers).toEqual(expected);
	});
});

describe('RealSceneRenderer — scheduling + seeds', () => {
	it('caps in-flight generations at the concurrency limit (default 2)', async () => {
		const provider = makeFakeProvider({ genDelayMs: 10 });
		await makeRenderer(provider).renderAllScenes(makeSixSpreadTree(), CTX);
		// Sheets run sequentially first (max 1); spreads run pooled at 2.
		expect(provider.state.maxInFlight).toBe(2);
	});

	it('honors a custom concurrency cap', async () => {
		const provider = makeFakeProvider({ genDelayMs: 10 });
		await makeRenderer(provider, { concurrency: 3 }).renderAllScenes(makeSixSpreadTree(), CTX);
		expect(provider.state.maxInFlight).toBe(3);
	});

	it('seeds sheets at baseSeed+1.. and spreads at baseSeed+100+spreadIndex', async () => {
		const provider = makeFakeProvider();
		await makeRenderer(provider).renderAllScenes(makeSixSpreadTree(), CTX);

		const seeds = provider.genCalls.map((c) => c.seed);
		expect(seeds.slice(0, 2)).toEqual([BASE_SEED + SHEET_SEED_OFFSET, BASE_SEED + SHEET_SEED_OFFSET + 1]);
		expect([...seeds.slice(2)].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
			[0, 1, 2, 3, 4, 5].map((i) => BASE_SEED + SPREAD_SEED_OFFSET + i),
		);
	});

	it('retries a failed spread once with seed+1', async () => {
		const failingSeed = BASE_SEED + SPREAD_SEED_OFFSET + 2;
		const provider = makeFakeProvider({ failSeedsOnce: [failingSeed] });
		const result = await makeRenderer(provider).renderAllScenes(makeSixSpreadTree(), CTX);

		// 2 sheets + 6 spreads + 1 retry
		expect(provider.genCalls).toHaveLength(9);
		const retried = provider.genCalls.filter((c) => c.seed === failingSeed + 1);
		expect(retried.length).toBeGreaterThanOrEqual(1);
		// scene-b's single spread (index 2) still rendered.
		expect(result.wbPngsByScene.get('scene-b')).toHaveLength(1);
	});

	it('surfaces the error when both attempts fail', async () => {
		const failingSeed = BASE_SEED + SPREAD_SEED_OFFSET + 1;
		const provider = makeFakeProvider({ failSeedsOnce: [failingSeed, failingSeed + 1] });
		await expect(makeRenderer(provider).renderAllScenes(makeSixSpreadTree(), CTX)).rejects.toThrow(
			/fake generation failure/,
		);
	});
});

describe('RealSceneRenderer — progress + prompts', () => {
	it('reports sheet progress then spread progress up to the totals', async () => {
		const provider = makeFakeProvider();
		const events: SceneRenderProgress[] = [];
		await makeRenderer(provider, { onProgress: (p: SceneRenderProgress) => events.push(p) })
			.renderAllScenes(makeSixSpreadTree(), CTX);

		const sheetEvents = events.filter((e) => e.phase === 'character-sheets');
		const spreadEvents = events.filter((e) => e.phase === 'spreads');
		expect(sheetEvents).toHaveLength(2);
		expect(spreadEvents).toHaveLength(6);
		expect(spreadEvents.map((e) => e.done).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(spreadEvents.every((e) => e.total === 6)).toBe(true);
		expect(spreadEvents.every((e) => /^spread-\d{2}$/.test(e.label))).toBe(true);
	});

	it('injects sidekick DNA only on spreads that feature it; resolves {HERO_NAME}', async () => {
		const provider = makeFakeProvider();
		await makeRenderer(provider).renderAllScenes(makeSixSpreadTree(), CTX);

		const spreadCalls = provider.genCalls.slice(2);
		const pipSpread = spreadCalls.find((c) => c.seed === BASE_SEED + SPREAD_SEED_OFFSET + 1)!;
		const soloSpread = spreadCalls.find((c) => c.seed === BASE_SEED + SPREAD_SEED_OFFSET + 4)!;
		expect(pipSpread.prompt).toContain(SIDEKICK_DNA.description);
		expect(soloSpread.prompt).not.toContain(SIDEKICK_DNA.description);
		for (const call of spreadCalls) {
			expect(call.prompt).toContain(HERO_DNA.description);
			expect(call.prompt).not.toContain('{HERO_NAME}');
		}
	});

	it('passes character sheets as refs only when useCharacterRefs is on', async () => {
		const defaultProvider = makeFakeProvider();
		await makeRenderer(defaultProvider).renderAllScenes(makeSixSpreadTree(), CTX);
		for (const call of defaultProvider.genCalls.slice(2)) {
			expect(call.characterRefs).toBeUndefined();
		}

		const refsProvider = makeFakeProvider();
		await makeRenderer(refsProvider, { useCharacterRefs: true }).renderAllScenes(
			makeSixSpreadTree(),
			CTX,
		);
		for (const call of refsProvider.genCalls.slice(2)) {
			expect(call.characterRefs).toHaveLength(2);
			expect(call.characterRefs![0]).toBeInstanceOf(Blob);
		}
	});

	it('applies non-legacy style packs at the image request boundary', async () => {
		const provider = makeFakeProvider();
		await makeRenderer(provider).renderAllScenes(makeSixSpreadTree(), {
			...CTX,
			stylePackId: 'ukiyo-e-woodblock',
		});

		const pack = getStylePack('ukiyo-e-woodblock')!;
		expect(provider.genCalls[0].styleId).toBe(pack.id);
		expect(provider.genCalls[0].prompt).toContain(pack.promptRecipe!.positivePrefix);
		expect(provider.genCalls[0].prompt).toContain(pack.promptRecipe!.positiveSuffix);
		expect(provider.genCalls[0].negativePrompt).toContain(pack.promptRecipe!.negativeAdditions);
		const spreadCall = provider.genCalls.find(
			(c) => c.seed === BASE_SEED + SPREAD_SEED_OFFSET,
		)!;
		expect(spreadCall.styleId).toBe(pack.id);
		expect(spreadCall.prompt).toContain(pack.promptRecipe!.positivePrefix);
		expect(spreadCall.prompt).toContain(pack.promptRecipe!.positiveSuffix);
	});

	it('uses an optional CompositionPlan to serialize direct-gen composition guidance', async () => {
		const provider = makeFakeProvider();
		const layout = collapseLayout({
			bookId: 'renderer-plan-book',
			spreadIndex: 0,
			beatName: 'setup',
			locale: 'forest',
			styleId: 'flat-painted',
			castArchetypeIds: ['hero', 'pip-hedgehog'],
			focalPropId: 'lantern',
			pageTurnDirection: 'ltr',
		});
		const plan = planComposition(layout, null);
		await makeRenderer(provider).renderAllScenes(makeSixSpreadTree(), {
			...CTX,
			compositionPlansBySpread: new Map([[0, plan]]),
		});

		const firstSpread = provider.genCalls.find(
			(c) => c.seed === BASE_SEED + SPREAD_SEED_OFFSET,
		)!;
		expect(firstSpread.prompt).toContain('Shot:');
		expect(firstSpread.prompt).toContain('Composition:');
		expect(firstSpread.prompt).toContain('clear empty area at');
	});
});
