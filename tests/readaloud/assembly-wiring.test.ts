import { describe, expect, it } from 'vitest';
import { assemble } from '$lib/services/assemble/BookAssembler';
import type { ReadAlongBundle } from '$lib/services/assemble/types';
import type { BeatId, BeatName, SceneTree } from '$lib/services/author/types';
import { makeBundle } from '../assemble/_fixtures';

const BEAT_NAMES: Record<BeatId, BeatName> = {
	1: 'setup',
	2: 'catalyst',
	3: 'debate',
	4: 'midpoint',
	5: 'trial',
	6: 'climax',
	7: 'resolution'
};

function makeTree(): SceneTree {
	return {
		title: 'The Brave Reader',
		back_cover_blurb: 'A story about courage.',
		page_budget: 7,
		tier2_words: ['brave'],
		dialogic_prompts: [{ spreadIndex: 0, type: 'recall', text: 'What did the reader try?' }],
		beats: ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).map((id) => ({
			id,
			beat_name: BEAT_NAMES[id],
			emotional_arc: id === 7 ? 'nervous -> proud' : 'curious -> brave',
			scenes: [
				{
					sceneId: `scene-${id}`,
					spreadCount: 1,
					sceneBrief: `Brief ${id}`,
					spreads: [
						{
							spreadIndex: id - 1,
							spread_text: id === 2 ? 'The brave reader opened the map.' : `Beat ${id} text.`,
							text_focus: 'left'
						}
					]
				}
			]
		}))
	};
}

describe('BookAssembler read-aloud edu wiring', () => {
	it('registers an edu-extended read-along bundle when edu overlays are supplied', async () => {
		const captured: ReadAlongBundle[] = [];
		await assemble(makeBundle(), {
			spreadTexts: ['A brave {HERO_NAME} opened the map.', '', '', '', '', '', ''],
			eduOverlays: { sceneTree: makeTree() },
			registerBundle: async (bundle) => {
				captured.push(bundle);
				return `/preview/${bundle.shortcode}`;
			}
		});

		const edu = captured[0].edu;
		expect(edu?.phonicsMap.brave.length).toBeGreaterThan(0);
		expect(edu?.tier2Annotations[0].word).toBe('brave');
		expect(edu?.dialogicPrompts).toEqual([{ spreadIndex: 0, type: 'recall', text: 'What did the reader try?' }]);
		expect(edu?.quiz).toHaveLength(3);
	});

	it('leaves the registered bundle unchanged when edu overlays are absent', async () => {
		const captured: ReadAlongBundle[] = [];
		await assemble(makeBundle(), {
			spreadTexts: ['', '', '', '', '', '', ''],
			registerBundle: async (bundle) => {
				captured.push(bundle);
				return `/preview/${bundle.shortcode}`;
			}
		});

		expect(captured[0]).not.toHaveProperty('edu');
	});
});
