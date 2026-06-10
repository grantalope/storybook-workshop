// @graph-layer: private
// tests/scenerender/pipeline-wiring.test.ts
//
// WorkshopBookPipeline provider wiring:
//   - mock provider (default in tests/CI) → MockSceneRenderer path,
//     validation skipped, page math byte-identical to the legacy pipeline
//   - real provider → RealSceneRenderer path, LuluPdfSpecValidator gate ON
//     (skipValidation: false), pages clamped to the format spec
//
// The validator module is spy-mocked so the test observes whether the gate
// actually ran. NO GPU — the "real" provider wraps MockProvider under a
// non-mock name.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/assemble/LuluPdfSpecValidator', async (importOriginal) => {
	const orig =
		await importOriginal<typeof import('$lib/services/assemble/LuluPdfSpecValidator')>();
	return {
		...orig,
		validatePdf: vi.fn(async () => ({ valid: true, errors: [] })),
	};
});

import { validatePdf } from '$lib/services/assemble/LuluPdfSpecValidator';
import {
	MockProvider,
	type ImageGenProvider,
	type ImageGenRequest,
	type UpscaleRequest,
} from '$lib/services/imagegen';
import {
	__TEST_resetKidProfileStore,
	getKidProfileStore,
} from '$lib/workshop/services/KidProfileStore';
import {
	runWorkshopPipeline,
	type PipelineProgress,
} from '$lib/workshop/services/WorkshopBookPipeline';
import type { WorkshopDraft } from '$lib/workshop/types';

/** Wrap MockProvider (real decodable PNGs) under an arbitrary provider name. */
function instrumentedProvider(name: string) {
	const inner = new MockProvider();
	const genCalls: ImageGenRequest[] = [];
	const upscaleCalls: UpscaleRequest[] = [];
	const provider: ImageGenProvider = {
		name,
		async generate(req) {
			genCalls.push(req);
			return inner.generate(req);
		},
		async upscale(req) {
			upscaleCalls.push(req);
			return inner.upscale(req);
		},
	};
	return Object.assign(provider, { genCalls, upscaleCalls });
}

async function makeDraft(targetSpreads: number): Promise<WorkshopDraft> {
	__TEST_resetKidProfileStore();
	const kids = getKidProfileStore();
	await kids.__TEST_clear();
	const kid = await kids.create({ name: 'Eli', birthdayIso: '2021-01-01' });
	const now = Date.now();
	return {
		draftId: `draft-${targetSpreads}`,
		kidId: kid.kidId,
		mode: 'standard',
		currentStation: 's6',
		outputs: {
			s1: {
				theme: 'overcoming-fear',
				occasion: 'just-because',
				lengthTier: 'standard',
				targetSpreads,
				ehriPhase: 'partial-alphabetic',
			},
			s2: { pillarId: 'pillar-mvp-1' },
			s3: { dedicationText: 'For every kid who hears the thunder' },
			s4: {
				heroName: 'Eli',
				sidekickSettlerId: 'pip-hedgehog',
				supportingCast: [{ id: 'pip-hedgehog', role: 'Pip, a lantern-carrying hedgehog' }],
				localeBiome: 'forest',
			},
			s5: { artStyle: 'flat-painted', easierReadingMode: false, dialogicPromptsEnabled: false },
		},
		createdAt: now,
		updatedAt: now,
		expiresAt: now + 1_000_000,
	};
}

const REAL_RENDER_OPTS = { genPx: 32, printPx: 64, retryDelayMs: 0 };

beforeEach(() => {
	vi.mocked(validatePdf).mockClear();
});

describe('WorkshopBookPipeline — provider wiring', () => {
	it('mock provider keeps the legacy path: no image-gen calls, validation skipped', async () => {
		const provider = instrumentedProvider('mock');
		const draft = await makeDraft(8);
		const result = await runWorkshopPipeline(draft, { forceTemplate: true, provider });

		expect(provider.genCalls).toHaveLength(0);
		expect(provider.upscaleCalls).toHaveLength(0);
		expect(validatePdf).not.toHaveBeenCalled();
		// Legacy page math: max(spreadCount * 2, 4).
		expect(result.pageCount).toBe(16);
		expect(result.book.pdfBlob.size).toBeGreaterThan(0);
	});

	it('non-mock provider drives RealSceneRenderer and the Lulu validation gate', async () => {
		const provider = instrumentedProvider('fake-local-gpu');
		const draft = await makeDraft(8);
		const progress: PipelineProgress[] = [];
		const result = await runWorkshopPipeline(draft, {
			forceTemplate: true,
			provider,
			renderOpts: REAL_RENDER_OPTS,
			onProgress: (p) => progress.push(p),
		});

		// 2 character sheets + one generation per spread; one upscale per spread.
		expect(provider.genCalls).toHaveLength(2 + 8);
		expect(provider.upscaleCalls).toHaveLength(8);
		// Validation gate actually ran (skipValidation: false on the real path).
		expect(validatePdf).toHaveBeenCalledTimes(1);
		expect(vi.mocked(validatePdf).mock.calls[0][0]).toMatchObject({
			format: 'saddlestitch-8x8',
			interiorPageCount: result.pageCount,
		});
		// Renderer progress surfaced through the pipeline callback.
		expect(progress.some((p) => p.stage === 'render' && /spread-\d{2}/.test(p.message))).toBe(
			true,
		);
		expect(result.book.pdfBlob.size).toBeGreaterThan(0);
	});

	it('real path clamps the declared page count to the format spec', async () => {
		const provider = instrumentedProvider('fake-local-gpu');
		const draft = await makeDraft(12); // softcover-8x8: min 32 pages
		const result = await runWorkshopPipeline(draft, {
			forceTemplate: true,
			provider,
			renderOpts: REAL_RENDER_OPTS,
		});

		expect(result.pageCount).toBe(32);
		expect(validatePdf).toHaveBeenCalledTimes(1);
		expect(vi.mocked(validatePdf).mock.calls[0][0]).toMatchObject({
			format: 'softcover-8x8',
			interiorPageCount: 32,
		});
	});

	it("prompts never carry the kid's name or the raw {HERO_NAME} placeholder", async () => {
		const provider = instrumentedProvider('fake-local-gpu');
		const draft = await makeDraft(8);
		await runWorkshopPipeline(draft, {
			forceTemplate: true,
			provider,
			renderOpts: REAL_RENDER_OPTS,
		});

		expect(provider.genCalls.length).toBeGreaterThan(0);
		for (const call of provider.genCalls) {
			expect(call.prompt).not.toContain('Eli');
			expect(call.prompt).not.toContain('{HERO_NAME}');
		}
	});
});
