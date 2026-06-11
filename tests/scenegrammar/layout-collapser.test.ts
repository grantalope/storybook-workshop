import { describe, expect, it } from 'vitest';

import {
	GLOBAL_CONSTRAINTS,
	UnsatisfiableLayoutError,
	collapseLayout,
	collapseTemplateLayout,
	isPropCompatible,
} from '$lib/services/scenegrammar';
import type {
	CollapsedLayout,
	CollapseContext,
	GrammarTemplate,
	Rect,
	SlotId,
} from '$lib/services/scenegrammar';
import type { BeatName, LocaleBiome } from '$lib/services/author/types';

const BEATS: BeatName[] = ['setup', 'catalyst', 'debate', 'midpoint', 'trial', 'climax', 'resolution'];
const LOCALES: LocaleBiome[] = [
	'forest',
	'seaside',
	'mountain',
	'desert',
	'meadow',
	'snowfield',
	'jungle',
	'urban',
	'farm',
	'underwater',
	'space',
	'imaginary',
];

function ctx(overrides: Partial<CollapseContext> = {}): CollapseContext {
	return {
		bookId: 'book-scenegrammar',
		spreadIndex: 4,
		beatName: 'catalyst',
		locale: 'forest',
		styleId: 'opaque-style',
		castArchetypeIds: ['hero-fox', 'sidekick-moon'],
		pageTurnDirection: 'ltr',
		...overrides,
	};
}

function intersectionArea(a: Rect, b: Rect): number {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.w, b.x + b.w);
	const y2 = Math.min(a.y + a.h, b.y + b.h);
	if (x2 <= x1 || y2 <= y1) return 0;
	return (x2 - x1) * (y2 - y1);
}

function slot(layout: CollapsedLayout, slotId: SlotId) {
	const found = layout.slots.find((candidate) => candidate.slotId === slotId);
	if (!found) throw new Error(`missing slot ${slotId}`);
	return found;
}

describe('scenegrammar layout collapser', () => {
	it('is deterministic for setup layouts including seed and backtracks', () => {
		const first = collapseLayout(ctx({ beatName: 'setup', spreadIndex: 1 }));
		const second = collapseLayout(ctx({ beatName: 'setup', spreadIndex: 1 }));
		expect(second).toEqual(first);
	});

	it('is deterministic for climax layouts including seed and backtracks', () => {
		const first = collapseLayout(ctx({ beatName: 'climax', spreadIndex: 9, locale: 'space' }));
		const second = collapseLayout(ctx({ beatName: 'climax', spreadIndex: 9, locale: 'space' }));
		expect(second).toEqual(first);
	});

	it('emits byte-identical layout JSON for the same bookId and spreadIndex across 50 runs', () => {
		const context = ctx({ beatName: 'trial', spreadIndex: 12, locale: 'mountain' });
		const first = JSON.stringify(collapseLayout(context));
		for (let i = 0; i < 50; i++) {
			expect(JSON.stringify(collapseLayout(context))).toBe(first);
		}
	});

	it('changes at least one collapsed slot when spreadIndex changes', () => {
		const first = collapseLayout(ctx({ beatName: 'trial', spreadIndex: 3 }));
		const second = collapseLayout(ctx({ beatName: 'trial', spreadIndex: 4 }));
		const firstSlots = JSON.stringify(first.slots.map(({ rect, facing, scale }) => ({ rect, facing, scale })));
		const secondSlots = JSON.stringify(second.slots.map(({ rect, facing, scale }) => ({ rect, facing, scale })));
		expect(secondSlots).not.toBe(firstSlots);
	});

	it('keeps text clear of focal slots and all rects in bounds for 50 seeded variants across every beat', () => {
		for (let spreadIndex = 0; spreadIndex < 50; spreadIndex++) {
			for (const beatName of BEATS) {
				const layout = collapseLayout(ctx({
					bookId: `book-${spreadIndex % 5}`,
					spreadIndex,
					beatName,
					locale: LOCALES[spreadIndex % LOCALES.length],
					pageTurnDirection: spreadIndex % 2 === 0 ? 'ltr' : 'rtl',
				}));
				const text = slot(layout, 'textZone');
				for (const collapsedSlot of layout.slots) {
					expect(collapsedSlot.rect.x).toBeGreaterThanOrEqual(0);
					expect(collapsedSlot.rect.y).toBeGreaterThanOrEqual(0);
					expect(collapsedSlot.rect.x + collapsedSlot.rect.w).toBeLessThanOrEqual(1);
					expect(collapsedSlot.rect.y + collapsedSlot.rect.h).toBeLessThanOrEqual(1);
				}
				for (const focalSlotId of ['heroSlot', 'sidekickSlot', 'focalPropSlot'] as SlotId[]) {
					expect(intersectionArea(text.rect, slot(layout, focalSlotId).rect)).toBe(0);
				}
			}
		}
	});

	it('makes setup hero facing follow ltr and rtl page turns', () => {
		expect(slot(collapseLayout(ctx({ beatName: 'setup', pageTurnDirection: 'ltr' })), 'heroSlot').facing).toBe('right');
		expect(slot(collapseLayout(ctx({ beatName: 'setup', pageTurnDirection: 'rtl' })), 'heroSlot').facing).toBe('left');
	});

	it('makes debate characters face each other', () => {
		const layout = collapseLayout(ctx({ beatName: 'debate', pageTurnDirection: 'ltr' }));
		const hero = slot(layout, 'heroSlot');
		const sidekick = slot(layout, 'sidekickSlot');
		const heroCenter = hero.rect.x + hero.rect.w / 2;
		const sidekickCenter = sidekick.rect.x + sidekick.rect.w / 2;
		if (heroCenter < sidekickCenter) {
			expect(hero.facing).toBe('right');
			expect(sidekick.facing).toBe('left');
		} else {
			expect(hero.facing).toBe('left');
			expect(sidekick.facing).toBe('right');
		}
	});

	it('chooses a deterministic compatible focal prop when absent and rejects explicit incompatible props', () => {
		const defaulted = collapseLayout(ctx({ beatName: 'catalyst', locale: 'desert', focalPropId: undefined }));
		expect(defaulted.ctx.focalPropId).toBeDefined();
		expect(isPropCompatible(defaulted.ctx.focalPropId ?? '', 'desert')).toBe(true);
		expect(() => collapseLayout(ctx({ beatName: 'catalyst', locale: 'desert', focalPropId: 'sled' }))).toThrow(UnsatisfiableLayoutError);
	});

	it('defaults omitted candidate facing to forward', () => {
		const template: GrammarTemplate = {
			beatName: 'climax',
			shot: 'tight-dramatic',
			slots: [
				{
					id: 'heroSlot',
					required: true,
					zIndex: 3,
					candidates: [{ rect: { x: 0.2, y: 0.2, w: 0.2, h: 0.3 }, scale: 0.5 }],
				},
			],
			constraints: [],
		};
		const layout = collapseTemplateLayout(ctx({ beatName: 'climax' }), template);
		expect(slot(layout, 'heroSlot').facing).toBe('forward');
	});

	it('includes slot id and rejecting constraint description in unsatisfiable errors', () => {
		const template: GrammarTemplate = {
			beatName: 'setup',
			shot: 'wide-establishing',
			slots: [
				{
					id: 'heroSlot',
					required: true,
					zIndex: 3,
					candidates: [{ rect: { x: -0.1, y: 0.2, w: 0.2, h: 0.3 }, scale: 0.3, facing: 'right' }],
				},
			],
			constraints: [],
		};
		expect(() => collapseTemplateLayout(ctx({ beatName: 'setup' }), template)).toThrow(/heroSlot/);
		expect(() => collapseTemplateLayout(ctx({ beatName: 'setup' }), template)).toThrow(GLOBAL_CONSTRAINTS[3].description);
	});
});
