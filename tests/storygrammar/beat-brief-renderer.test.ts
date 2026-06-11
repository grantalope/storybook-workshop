import { describe, expect, it } from 'vitest';

import { BEAT_NAMES } from '$lib/services/author/types';
import {
	collapseSkeleton,
	renderBeatBriefs,
} from '$lib/services/storygrammar';
import type { StoryInput } from '$lib/services/author/types';

function input(overrides: Partial<StoryInput> = {}): StoryInput {
	return {
		kidName: 'Zephyrina',
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

describe('renderBeatBriefs', () => {
	it('renders seven briefs in canonical beat order', () => {
		const briefs = renderBeatBriefs(collapseSkeleton(input(), { seed: 7 }), input(), []);
		expect(briefs.map((brief) => brief.beatId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(briefs.map((brief) => brief.beatName)).toEqual([
			BEAT_NAMES[1],
			BEAT_NAMES[2],
			BEAT_NAMES[3],
			BEAT_NAMES[4],
			BEAT_NAMES[5],
			BEAT_NAMES[6],
			BEAT_NAMES[7],
		]);
	});

	it('assigns every tier-2 word to at least one beat', () => {
		const words = ['brave', 'glimmer', 'patient', 'notice', 'mend', 'steady'];
		const briefs = renderBeatBriefs(collapseSkeleton(input(), { seed: 7 }), input(), words);
		const assigned = new Set(briefs.flatMap((brief) => brief.tier2Words));
		for (const word of words) expect(assigned.has(word)).toBe(true);
	});

	it('places the refrain on placement beats and mutates exactly at beat 6', () => {
		const skeleton = collapseSkeleton(input(), { seed: 7 });
		const briefs = renderBeatBriefs(skeleton, input(), []);
		for (const beatId of skeleton.refrain.placementBeats) {
			expect(briefs[beatId - 1].refrainLine).toBeDefined();
		}
		expect(briefs[5].refrainLine).not.toBe(skeleton.refrain.line);
		expect(briefs[5].refrainIsMutated).toBe(true);
		expect(briefs.filter((brief) => brief.refrainIsMutated).map((brief) => brief.beatId)).toEqual([
			6,
		]);
	});

	it('includes the hero-agency sentence in the climax brief', () => {
		const briefs = renderBeatBriefs(collapseSkeleton(input(), { seed: 7 }), input(), []);
		expect(briefs[5].brief).toContain('The hero, not the sidekick, resolves the problem.');
	});

	it('does not leak the kid name into any brief field', () => {
		const briefs = renderBeatBriefs(collapseSkeleton(input(), { seed: 7 }), input(), [
			'brave',
			'glimmer',
		]);
		expect(JSON.stringify(briefs)).not.toContain('Zephyrina');
	});

	it('is deterministic', () => {
		const skeleton = collapseSkeleton(input(), { seed: 7 });
		const first = renderBeatBriefs(skeleton, input(), ['brave', 'glimmer']);
		const second = renderBeatBriefs(skeleton, input(), ['brave', 'glimmer']);
		expect(second).toEqual(first);
	});
});
