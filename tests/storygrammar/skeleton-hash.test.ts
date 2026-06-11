import { describe, expect, it } from 'vitest';

import { skeletonHash } from '$lib/services/storygrammar/SkeletonHash';
import type { StorySkeleton } from '$lib/services/storygrammar/types';

function fixedSkeleton(): StorySkeleton {
	return {
		seedUsed: 1234,
		theme: 'overcoming-fear',
		conflictClass: 'fear-to-face',
		stakes: 'social-bond',
		settingArc: { start: 'forest', excursion: 'mountain', return: 'forest' },
		refrain: {
			line: 'Moon by moon, show the way home',
			minWords: 6,
			maxWords: 9,
			placementBeats: [1, 6, 7],
			climaxMutation: { beat: 6, swapWordIndex: 0 },
		},
		sidekickRole: 'helper',
		endingType: 'circular-callback',
		beatSceneCounts: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 7: 1 },
		beatSpreadBudgets: { 1: 2, 2: 1, 3: 2, 4: 4, 5: 3, 6: 3, 7: 1 },
		emotionalArc: { 1: 0.2, 2: 0.1, 3: 0, 4: -0.2, 5: -0.15, 6: 0.2, 7: 0.6 },
	};
}

describe('skeletonHash', () => {
	it('is insensitive to object key insertion order', () => {
		const skeleton = fixedSkeleton();
		const shuffled = {
			theme: skeleton.theme,
			seedUsed: skeleton.seedUsed,
			stakes: skeleton.stakes,
			conflictClass: skeleton.conflictClass,
			endingType: skeleton.endingType,
			sidekickRole: skeleton.sidekickRole,
			refrain: {
				maxWords: skeleton.refrain.maxWords,
				line: skeleton.refrain.line,
				climaxMutation: {
					swapWordIndex: skeleton.refrain.climaxMutation.swapWordIndex,
					beat: skeleton.refrain.climaxMutation.beat,
				},
				placementBeats: skeleton.refrain.placementBeats,
				minWords: skeleton.refrain.minWords,
			},
			settingArc: {
				return: skeleton.settingArc.return,
				start: skeleton.settingArc.start,
				excursion: skeleton.settingArc.excursion,
			},
			emotionalArc: { 7: 0.6, 6: 0.2, 5: -0.15, 4: -0.2, 3: 0, 2: 0.1, 1: 0.2 },
			beatSpreadBudgets: { 7: 1, 6: 3, 5: 3, 4: 4, 3: 2, 2: 1, 1: 2 },
			beatSceneCounts: { 7: 1, 6: 2, 5: 2, 4: 2, 3: 2, 2: 1, 1: 1 },
		} as StorySkeleton;

		expect(skeletonHash(shuffled)).toBe(skeletonHash(skeleton));
	});

	it('changes when any field value changes', () => {
		const skeleton = fixedSkeleton();
		const changed: StorySkeleton = {
			...skeleton,
			refrain: { ...skeleton.refrain, line: 'Star by star, show the way home' },
		};

		expect(skeletonHash(changed)).not.toBe(skeletonHash(skeleton));
	});

	it('has a stable golden for a fixed skeleton', () => {
		expect(skeletonHash(fixedSkeleton())).toBe('67725a0d5792c232');
	});
});
