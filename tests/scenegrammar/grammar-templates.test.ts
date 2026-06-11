import { describe, expect, it } from 'vitest';

import {
	ALL_SLOT_IDS,
	BEAT_NAMES,
	BEAT_SHOT_MAP,
	GRAMMAR_TEMPLATES,
	isSlotRequiredForBeat,
} from '$lib/services/scenegrammar';
import type { BeatName } from '$lib/services/author/types';

describe('scenegrammar templates', () => {
	it('defines exactly seven templates keyed by all BeatNames', () => {
		expect(GRAMMAR_TEMPLATES).toHaveLength(7);
		expect(GRAMMAR_TEMPLATES.map((template) => template.beatName).sort()).toEqual([...BEAT_NAMES].sort());
	});

	it('exports the approved beat to shot map', () => {
		expect(BEAT_SHOT_MAP).toEqual({
			setup: 'wide-establishing',
			catalyst: 'medium',
			debate: 'medium',
			midpoint: 'medium-dynamic',
			trial: 'tense-medium',
			climax: 'tight-dramatic',
			resolution: 'warm-wide',
		});
	});

	it('includes every canonical slot in each template with real candidate domains', () => {
		for (const template of GRAMMAR_TEMPLATES) {
			expect(template.slots.map((slot) => slot.id).sort()).toEqual([...ALL_SLOT_IDS].sort());
			for (const slot of template.slots) {
				expect(slot.candidates.length).toBeGreaterThanOrEqual(3);
				expect(slot.candidates.length).toBeLessThanOrEqual(6);
			}
		}
	});

	it('keeps every skyband as a bounded top band', () => {
		for (const template of GRAMMAR_TEMPLATES) {
			const skyband = template.slots.find((slot) => slot.id === 'skyband');
			expect(skyband).toBeDefined();
			for (const candidate of skyband?.candidates ?? []) {
				expect(candidate.rect.y).toBe(0);
				expect(candidate.rect.h).toBeLessThanOrEqual(0.25);
			}
		}
	});

	it('infers sidekick and prop requiredness from beat templates', () => {
		for (const beat of ['setup', 'resolution'] as BeatName[]) {
			expect(isSlotRequiredForBeat(beat, 'sidekickSlot')).toBe(false);
			expect(isSlotRequiredForBeat(beat, 'focalPropSlot')).toBe(false);
		}
		for (const beat of ['catalyst', 'debate', 'midpoint', 'trial', 'climax'] as BeatName[]) {
			expect(isSlotRequiredForBeat(beat, 'sidekickSlot')).toBe(true);
			expect(isSlotRequiredForBeat(beat, 'focalPropSlot')).toBe(true);
		}
	});
});
