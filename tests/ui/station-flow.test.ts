// @graph-layer: private
// tests/ui/station-flow.test.ts
//
// Integration test: drive a workshop draft through all 7 stations with
// mocked storyAuthor + mocked scene render. Validates the orchestrator
// + pipeline composition end-to-end without browser.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IdbKeyValueStore } from '$lib/workshop/advanced/services/IdbKeyValueStore';
import {
	KidProfileStore,
	getKidProfileStore,
	__TEST_resetKidProfileStore,
} from '$lib/workshop/services/KidProfileStore';
import { WorkshopDraftStore } from '$lib/workshop/services/WorkshopDraftStore';
import { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
import { runWorkshopPipeline } from '$lib/workshop/services/WorkshopBookPipeline';
import type {
	ConsentRecord,
	KidProfile,
	WorkshopDraft,
} from '$lib/workshop/types';

async function bootKid(): Promise<{
	kids: KidProfileStore;
	drafts: WorkshopDraftStore;
	kid: KidProfile;
	orch: WorkshopOrchestrator;
}> {
	const draftsIdb = new IdbKeyValueStore<WorkshopDraft>(
		`flow-d-${crypto.randomUUID()}`,
		'drafts',
	);
	const drafts = new WorkshopDraftStore({ idb: draftsIdb });
	// Pipeline calls getKidProfileStore() under the hood — drive the real
	// singleton so the lookup succeeds.
	__TEST_resetKidProfileStore();
	const kids = getKidProfileStore();
	await kids.__TEST_clear();
	const kid = await kids.create({ name: 'Eli', birthdayIso: '2021-01-01' });
	const draft = await drafts.create({ kidId: kid.kidId });
	return {
		kids,
		drafts,
		kid,
		orch: new WorkshopOrchestrator(drafts, draft),
	};
}

describe('Station flow — happy path', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('walks all 7 stations and seals a book', async () => {
		const { orch } = await bootKid();

		// kid-picker → s1
		expect(orch.currentStation).toBe('kid-picker');
		await orch.advance();
		expect(orch.currentStation).toBe('s1');

		await orch.saveOutput('s1', {
			theme: 'bedtime',
			occasion: 'just-because',
			lengthTier: 'bedtime',
			targetSpreads: 8,
			ehriPhase: 'partial-alphabetic',
		});
		await orch.advance();
		expect(orch.currentStation).toBe('s2');

		await orch.saveOutput('s2', { pillarId: 'pillar-mvp-1' });
		await orch.advance();
		expect(orch.currentStation).toBe('s3');

		await orch.saveOutput('s3', { dedicationText: 'Stay curious, Eli.' });
		await orch.advance();
		expect(orch.currentStation).toBe('s4');

		await orch.saveOutput('s4', {
			heroName: 'Eli',
			sidekickSettlerId: 'ada',
			supportingCast: [],
			localeBiome: 'forest',
		});
		await orch.advance();
		expect(orch.currentStation).toBe('s5');

		await orch.saveOutput('s5', {
			artStyle: 'octopath-hd2d',
			easierReadingMode: false,
			dialogicPromptsEnabled: true,
		});
		await orch.advance();
		expect(orch.currentStation).toBe('s6');

		// Pipeline runs through the deterministic template fallback
		// (no LLM/network needed).
		const pipelineResult = await runWorkshopPipeline(orch.draft, {
			forceTemplate: true,
		});
		expect(pipelineResult.book.pdfBlob.size).toBeGreaterThan(0);
		expect(pipelineResult.book.shortcode).toMatch(/^[a-zA-Z0-9]/);
		expect(pipelineResult.pdfHash).toMatch(/^[0-9a-f]{64}$/);

		const consent: ConsentRecord = {
			reviewedSpreads: true,
			understandsNonRefundable: true,
			pdfHash: pipelineResult.pdfHash,
			timestampMs: Date.now(),
		};
		await orch.saveOutput('s6', {
			bookShortcode: pipelineResult.book.shortcode,
			pdfBlobSize: pipelineResult.book.pdfBlob.size,
			pdfHash: pipelineResult.pdfHash,
			consent,
		});
		await orch.advance();
		expect(orch.currentStation).toBe('s7');
	});
});

describe('Station flow — forward gating', () => {
	it('cannot advance from s1 without theme/lengthTier output', async () => {
		const { orch } = await bootKid();
		await orch.advance(); // s1
		await expect(orch.advance()).rejects.toThrow();
	});

	it('cannot advance from s6 without consent', async () => {
		const { orch } = await bootKid();
		await orch.advance(); // s1
		await orch.saveOutput('s1', {
			theme: 'bedtime',
			occasion: 'just-because',
			lengthTier: 'bedtime',
			targetSpreads: 8,
			ehriPhase: 'partial-alphabetic',
		});
		await orch.advance();
		await orch.saveOutput('s2', { pillarId: 'p1' });
		await orch.advance();
		await orch.saveOutput('s3', { dedicationText: 'go' });
		await orch.advance();
		await orch.saveOutput('s4', {
			heroName: 'X',
			sidekickSettlerId: 'ada',
			supportingCast: [],
			localeBiome: 'forest',
		});
		await orch.advance();
		await orch.saveOutput('s5', {
			artStyle: 'octopath-hd2d',
			easierReadingMode: false,
			dialogicPromptsEnabled: true,
		});
		await orch.advance(); // s6
		expect(orch.currentStation).toBe('s6');

		// Sealed book recorded but consent unchecked → still blocked
		await orch.saveOutput('s6', {
			bookShortcode: 'X1',
			pdfBlobSize: 0,
			pdfHash: 'h',
			consent: {
				reviewedSpreads: false,
				understandsNonRefundable: true,
				pdfHash: 'h',
				timestampMs: 0,
			},
		});
		await expect(orch.advance()).rejects.toThrow();
	});
});

describe('Pipeline — buildStoryInput', () => {
	it('throws when s1..s5 missing', async () => {
		const { orch } = await bootKid();
		await expect(
			runWorkshopPipeline(orch.draft, { forceTemplate: true }),
		).rejects.toThrow(/stations 1-5/);
	});
});
