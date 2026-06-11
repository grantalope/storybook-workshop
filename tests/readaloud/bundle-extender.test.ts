import { describe, expect, it } from 'vitest';
import type { AnimationManifest, ReadAlongBundle } from '$lib/services/assemble/types';
import type { BeatId, BeatName, SceneTree } from '$lib/services/author/types';
import { extendReadAlongBundle } from '$lib/services/readaloud/ReadAloudBundleExtender';

const animation: AnimationManifest = {
	beat: 'setup',
	effect: 'flow',
	durationMs: 1500,
	staticFrameIndex: 0
};

const BEAT_NAMES: Record<BeatId, BeatName> = {
	1: 'setup',
	2: 'catalyst',
	3: 'debate',
	4: 'midpoint',
	5: 'trial',
	6: 'climax',
	7: 'resolution'
};

function makeBundle(): ReadAlongBundle {
	return {
		shortcode: 'abcd2345',
		manifest: {
			title: 'Brave Cave',
			spreadCount: 2,
			hasVoiceOver: false,
			hasDedicationAudio: false
		},
		spreads: [
			{ index: 0, framePng: new Blob(['a']), animation, text: 'A brave kid entered the cave.' },
			{ index: 1, framePng: new Blob(['b']), animation, text: 'The cozy cave glowed.' }
		]
	};
}

function makeTree(): SceneTree {
	return {
		title: 'Brave Cave',
		back_cover_blurb: 'A cave story.',
		page_budget: 7,
		tier2_words: ['brave', 'cozy'],
		dialogic_prompts: [{ spreadIndex: 1, type: 'wh-question', text: 'What glowed?' }],
		beats: ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).map((id) => ({
			id,
			beat_name: BEAT_NAMES[id],
			emotional_arc: id === 7 ? 'unsure -> glad' : 'steady -> curious',
			scenes: [
				{
					sceneId: `scene-${id}`,
					spreadCount: 1,
					sceneBrief: `Brief ${id}`,
					spreads: [
						{
							spreadIndex: id - 1,
							spread_text: id === 2 ? 'A brave kid entered the cave.' : `Beat ${id} text.`,
							text_focus: 'left'
						}
					]
				}
			]
		}))
	};
}

describe('extendReadAlongBundle', () => {
	it('adds edu overlays and leaves the original bundle unmutated', () => {
		const bundle = makeBundle();
		const extended = extendReadAlongBundle(bundle, {
			sceneTree: makeTree(),
			wordTimings: { 0: [{ word: 'A', startMs: 0, endMs: 100, charStart: 0, charEnd: 1 }] }
		});

		expect(bundle).not.toHaveProperty('edu');
		expect(extended.edu?.phonicsMap.brave.length).toBeGreaterThan(0);
		expect(extended.edu?.tier2Annotations.map((annotation) => annotation.word)).toEqual(['brave', 'cozy']);
		expect(extended.edu?.dialogicPrompts).toEqual([{ spreadIndex: 1, type: 'wh-question', text: 'What glowed?' }]);
		expect(extended.edu?.quiz).toHaveLength(3);
		expect(extended.edu?.wordTimings?.[0][0]).toEqual({
			word: 'A',
			startMs: 0,
			endMs: 100,
			charStart: 0,
			charEnd: 1
		});
	});
});
