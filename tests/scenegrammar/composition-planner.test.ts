import { describe, expect, it } from 'vitest';

import {
	collapseLayout,
	isSlotRequiredForBeat,
	planComposition,
} from '$lib/services/scenegrammar';
import type {
	BankAssetEntry,
	BankAssetQuery,
	BankManifest,
	CollapsedLayout,
	SlotId,
} from '$lib/services/scenegrammar';

function layout(): CollapsedLayout {
	return collapseLayout({
		bookId: 'planner-book',
		spreadIndex: 2,
		beatName: 'catalyst',
		locale: 'forest',
		styleId: 'opaque-style',
		castArchetypeIds: ['hero-fox', 'sidekick-moon'],
		focalPropId: 'lantern',
		pageTurnDirection: 'ltr',
	});
}

function queriesFor(layoutValue: CollapsedLayout): Array<{ slotId: SlotId; query: BankAssetQuery }> {
	return layoutValue.slots.flatMap((slot) => (slot.assetQuery ? [{ slotId: slot.slotId, query: slot.assetQuery }] : []));
}

function entryFor(slotId: SlotId, query: BankAssetQuery, index: number): BankAssetEntry {
	return {
		assetId: `${slotId}-${index}`,
		layer: query.layer,
		styleId: query.styleId,
		...(query.locale ? { locale: query.locale } : {}),
		...(query.beatMood ? { beatMood: query.beatMood } : {}),
		...(query.archetypeId ? { archetypeId: query.archetypeId } : {}),
		...(query.poseClass ? { poseClass: query.poseClass } : {}),
		...(query.propId ? { propId: query.propId } : {}),
		file: `${slotId}-${index}.png`,
		seed: 100 + index,
		generatedAtIso: '2026-06-11T00:00:00.000Z',
	};
}

function manifestFor(layoutValue: CollapsedLayout, omitSlot?: SlotId): BankManifest {
	return {
		version: 1,
		bankRoot: '/bank',
		entries: queriesFor(layoutValue)
			.filter(({ slotId }) => slotId !== omitSlot)
			.map(({ slotId, query }, index) => entryFor(slotId, query, index)),
	};
}

describe('scenegrammar composition planner', () => {
	it('uses bank-composite when all required slot assets resolve', () => {
		const collapsed = layout();
		const plan = planComposition(collapsed, manifestFor(collapsed));
		expect(plan.mode).toBe('bank-composite');
		expect(plan.fallbackToDirectGen).toBe(false);
		const requiredAssetSlots = plan.resolvedAssets.filter((asset) => isSlotRequiredForBeat(collapsed.ctx.beatName, asset.slotId));
		expect(requiredAssetSlots.length).toBeGreaterThanOrEqual(3);
	});

	it('falls back to direct-gen when the required hero sprite is missing', () => {
		const collapsed = layout();
		const heroQuery = collapsed.slots.find((slot) => slot.slotId === 'heroSlot')?.assetQuery;
		const plan = planComposition(collapsed, manifestFor(collapsed, 'heroSlot'));
		expect(plan.mode).toBe('direct-gen');
		expect(plan.fallbackToDirectGen).toBe(true);
		expect(plan.missingAssets).toContainEqual(heroQuery);
	});

	it('falls back to direct-gen with all asset queries missing for a null manifest', () => {
		const collapsed = layout();
		const plan = planComposition(collapsed, null);
		expect(plan.mode).toBe('direct-gen');
		expect(plan.resolvedAssets).toEqual([]);
		expect(plan.missingAssets).toEqual(queriesFor(collapsed).map(({ query }) => query));
	});
});
