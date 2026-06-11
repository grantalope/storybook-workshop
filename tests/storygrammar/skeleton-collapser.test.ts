import { describe, expect, it } from 'vitest';

import {
	CONFLICT_THEME_COMPAT,
	EMOTIONAL_ARC_RULES,
	MAX_STAKES_BY_AGE,
	STAKES_LADDER,
	collapseSkeleton,
} from '$lib/services/storygrammar';
import type { BeatId, StoryInput, StoryTheme } from '$lib/services/author/types';

const THEMES: StoryTheme[] = [
	'bedtime',
	'first-day',
	'lost-and-found',
	'overcoming-fear',
	'new-baby-arrives',
	'kindness',
	'adventure',
	'curiosity',
	'friendship',
	'sibling-rivalry',
	'saying-goodbye',
	'silly-quest',
];

function input(overrides: Partial<StoryInput> = {}): StoryInput {
	return {
		kidName: 'Eli',
		ageBand: 'preschool',
		ehriPhase: 'partial-alphabetic',
		theme: 'overcoming-fear',
		occasion: 'just-because',
		sidekickSettlerId: 'sidekick-1',
		supportingCast: [],
		localeBiome: 'forest',
		targetSpreads: 24,
		dedicationText: '',
		dialogicPromptsEnabled: true,
		easierReadingMode: false,
		...overrides,
	};
}

describe('collapseSkeleton', () => {
	it('is deterministic for the same input and seed', () => {
		const first = collapseSkeleton(input(), { seed: 42 });
		const second = collapseSkeleton(input(), { seed: 42 });
		expect(second).toEqual(first);
	});

	it('changes when the seed changes', () => {
		const first = collapseSkeleton(input(), { seed: 1 });
		const second = collapseSkeleton(input(), { seed: 2 });
		expect(second).not.toEqual(first);
	});

	it('selects a compatible conflict class for all 12 themes', () => {
		for (const theme of THEMES) {
			const skeleton = collapseSkeleton(input({ theme }), { seed: 99 });
			expect(CONFLICT_THEME_COMPAT[skeleton.conflictClass]).toContain(theme);
		}
	});

	it('never exceeds the age stakes cap', () => {
		for (const ageBand of ['toddler', 'preschool', 'grade-school'] as const) {
			const skeleton = collapseSkeleton(input({ ageBand }), { seed: 13 });
			const actualRank = STAKES_LADDER.indexOf(skeleton.stakes);
			const maxRank = STAKES_LADDER.indexOf(MAX_STAKES_BY_AGE[ageBand]);
			expect(actualRank).toBeGreaterThanOrEqual(0);
			expect(actualRank).toBeLessThanOrEqual(maxRank);
		}
	});

	it('allocates beat spread budgets that sum to the target spreads', () => {
		for (const targetSpreads of [16, 24, 32, 48]) {
			const skeleton = collapseSkeleton(input({ targetSpreads }), { seed: targetSpreads });
			const sum = Object.values(skeleton.beatSpreadBudgets).reduce((acc, n) => acc + n, 0);
			expect(sum).toBe(targetSpreads);
		}
	});

	it('keeps every beat scene count in the 1..3 range', () => {
		const skeleton = collapseSkeleton(input({ targetSpreads: 48 }), { seed: 48 });
		for (const count of Object.values(skeleton.beatSceneCounts)) {
			expect(count).toBeGreaterThanOrEqual(1);
			expect(count).toBeLessThanOrEqual(3);
		}
	});

	it('constructs emotional arcs that satisfy the pre-climax dip rules', () => {
		for (let seed = 0; seed < 50; seed++) {
			const arc = collapseSkeleton(input(), { seed }).emotionalArc;
			expect(arc[1]).toBeGreaterThanOrEqual(EMOTIONAL_ARC_RULES.beat1Min);
			const dipBeat = ([4, 5, 6] as BeatId[]).reduce((lowest, beat) =>
				arc[beat] < arc[lowest] ? beat : lowest,
			);
			expect(arc[dipBeat]).toBeLessThanOrEqual(
				arc[1] - EMOTIONAL_ARC_RULES.preClimaxDipDelta,
			);
			expect(arc[7]).toBeGreaterThanOrEqual(EMOTIONAL_ARC_RULES.beat7Min);
			for (let beat = dipBeat + 1; beat <= 7; beat++) {
				expect(arc[beat as BeatId]).toBeGreaterThanOrEqual(arc[(beat - 1) as BeatId]);
			}
		}
	});

	it('returns to the starting setting for bedtime', () => {
		const skeleton = collapseSkeleton(input({ theme: 'bedtime', localeBiome: 'seaside' }), {
			seed: 5,
		});
		expect(skeleton.settingArc.return).toBe(skeleton.settingArc.start);
	});
});
