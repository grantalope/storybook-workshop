// @graph-layer: private
// tests/ui/workshop-orchestrator.test.ts

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { IdbKeyValueStore } from '$lib/workshop/advanced/services/IdbKeyValueStore';
import { WorkshopDraftStore } from '$lib/workshop/services/WorkshopDraftStore';
import {
	WorkshopOrchestrator,
	WorkshopAdvanceError,
	WorkshopNavError,
	isStationSatisfied,
} from '$lib/workshop/services/WorkshopOrchestrator';
import type { StationOutputs, WorkshopDraft } from '$lib/workshop/types';

async function makeOrch(): Promise<{
	orch: WorkshopOrchestrator;
	store: WorkshopDraftStore;
}> {
	const idb = new IdbKeyValueStore<WorkshopDraft>(
		`swt-o-${crypto.randomUUID()}`,
		'drafts',
	);
	const store = new WorkshopDraftStore({ idb });
	const draft = await store.create({ kidId: 'kid-1' });
	return { orch: new WorkshopOrchestrator(store, draft), store };
}

const SAMPLE_S1 = {
	theme: 'bedtime' as const,
	occasion: 'birthday' as const,
	lengthTier: 'standard' as const,
	targetSpreads: 12,
	ehriPhase: 'partial-alphabetic' as const,
};
const SAMPLE_S2 = { pillarId: 'pillar-7' };
const SAMPLE_S3 = { dedicationText: 'Stay curious.' };
const SAMPLE_S4 = {
	heroName: 'Eli',
	sidekickSettlerId: 'ada',
	supportingCast: [],
	localeBiome: 'seaside' as const,
};
const SAMPLE_S5 = {
	artStyle: 'octopath-hd2d' as const,
	easierReadingMode: false,
	dialogicPromptsEnabled: true,
};
const SAMPLE_S6 = {
	bookShortcode: 'AB12-CD34',
	pdfBlobSize: 1024,
	pdfHash: 'abc123',
	consent: {
		reviewedSpreads: true,
		understandsNonRefundable: true,
		pdfHash: 'abc123',
		timestampMs: Date.now(),
	},
};

describe('isStationSatisfied', () => {
	it('kid-picker is always satisfied', () => {
		expect(isStationSatisfied('kid-picker', {})).toBe(true);
	});
	it('s1 requires targetSpreads > 0', () => {
		expect(isStationSatisfied('s1', {})).toBe(false);
		expect(isStationSatisfied('s1', { s1: SAMPLE_S1 })).toBe(true);
	});
	it('s2 requires pillarId', () => {
		expect(isStationSatisfied('s2', {})).toBe(false);
		expect(isStationSatisfied('s2', { s2: SAMPLE_S2 })).toBe(true);
	});
	it('s6 requires both consent checkboxes', () => {
		const s6NoConsent = {
			...SAMPLE_S6,
			consent: { ...SAMPLE_S6.consent, reviewedSpreads: false },
		};
		expect(isStationSatisfied('s6', { s6: s6NoConsent })).toBe(false);
		expect(isStationSatisfied('s6', { s6: SAMPLE_S6 })).toBe(true);
	});
});

describe('WorkshopOrchestrator — forward transitions', () => {
	it('starts at kid-picker', async () => {
		const { orch } = await makeOrch();
		expect(orch.currentStation).toBe('kid-picker');
	});

	it('advance() from kid-picker moves to s1 (always satisfied)', async () => {
		const { orch } = await makeOrch();
		await orch.advance();
		expect(orch.currentStation).toBe('s1');
	});

	it('advance() throws WorkshopAdvanceError when station not satisfied', async () => {
		const { orch } = await makeOrch();
		await orch.advance(); // → s1
		await expect(orch.advance()).rejects.toBeInstanceOf(WorkshopAdvanceError);
	});

	it('saveOutput + advance walks the full forward path', async () => {
		const { orch } = await makeOrch();
		await orch.advance(); // s1
		await orch.saveOutput('s1', SAMPLE_S1);
		await orch.advance(); // s2
		await orch.saveOutput('s2', SAMPLE_S2);
		await orch.advance(); // s3
		await orch.saveOutput('s3', SAMPLE_S3);
		await orch.advance(); // s4
		await orch.saveOutput('s4', SAMPLE_S4);
		await orch.advance(); // s5
		await orch.saveOutput('s5', SAMPLE_S5);
		await orch.advance(); // s6
		await orch.saveOutput('s6', SAMPLE_S6);
		await orch.advance(); // s7
		expect(orch.currentStation).toBe('s7');
	});

	it('advance() at terminal library throws', async () => {
		const { orch, store } = await makeOrch();
		await store.update(orch.draft.draftId, { currentStation: 'library' });
		orch.draft = (await store.get(orch.draft.draftId))!;
		await expect(orch.advance()).rejects.toThrow();
	});
});

describe('WorkshopOrchestrator — back navigation', () => {
	it('back() decrements one station', async () => {
		const { orch } = await makeOrch();
		await orch.advance(); // s1
		await orch.back();
		expect(orch.currentStation).toBe('kid-picker');
	});

	it('back() at kid-picker throws', async () => {
		const { orch } = await makeOrch();
		await expect(orch.back()).rejects.toBeInstanceOf(WorkshopNavError);
	});

	it('jumpBackTo allows backward jumps', async () => {
		const { orch } = await makeOrch();
		await orch.advance(); // s1
		await orch.saveOutput('s1', SAMPLE_S1);
		await orch.advance(); // s2
		await orch.saveOutput('s2', SAMPLE_S2);
		await orch.advance(); // s3
		await orch.jumpBackTo('s1');
		expect(orch.currentStation).toBe('s1');
	});

	it('jumpBackTo forbids forward jumps', async () => {
		const { orch } = await makeOrch();
		await expect(orch.jumpBackTo('s5')).rejects.toThrow(/forward jump forbidden/);
	});

	it('jumpBackTo unknown station throws', async () => {
		const { orch } = await makeOrch();
		await expect(orch.jumpBackTo('s99' as any)).rejects.toThrow(/unknown station/);
	});
});

describe('WorkshopOrchestrator — persistence', () => {
	it('saveOutput persists to draft store', async () => {
		const { orch, store } = await makeOrch();
		await orch.advance();
		await orch.saveOutput('s1', SAMPLE_S1);
		const reloaded = await store.get(orch.draft.draftId);
		expect(reloaded?.outputs.s1?.theme).toBe('bedtime');
	});
});
