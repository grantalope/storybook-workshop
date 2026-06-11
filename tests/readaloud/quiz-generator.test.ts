import { describe, expect, it } from 'vitest';
import type { BeatId, BeatName, SceneTree } from '$lib/services/author/types';
import { generateQuiz } from '$lib/services/readaloud/QuizGenerator';

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
		title: 'Mira and the Moon Key',
		back_cover_blurb: 'A gentle adventure.',
		page_budget: 7,
		tier2_words: ['brave'],
		beats: ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).map((id) => ({
			id,
			beat_name: BEAT_NAMES[id],
			emotional_arc: id === 7 ? 'worried -> proud' : 'curious -> hopeful',
			scenes: [
				{
					sceneId: `scene-${id}`,
					spreadCount: 1,
					sceneBrief: `Brief ${id}`,
					spreads: [
						{
							spreadIndex: id - 1,
							spread_text:
								id === 2
									? 'Mira found a glowing moon key beside the old gate.'
									: id === 5
										? 'A windy bridge wobbled while Mira held the key tight.'
										: id === 6
											? 'Mira unlocked the gate and moonlight filled the garden.'
											: `Beat ${id} moment.`,
							text_focus: 'left'
						}
					]
				}
			]
		}))
	};
}

describe('generateQuiz', () => {
	it('creates three questions with one of each template type', () => {
		const quiz = generateQuiz(makeTree());
		expect(quiz).toHaveLength(3);
		expect(quiz.map((question) => question.type)).toEqual(['recall', 'sequence', 'feeling']);
		expect(quiz[0].options[quiz[0].correctIndex]).toBe('Mira found a glowing moon key beside the old gate.');
		expect(quiz[2].options[quiz[2].correctIndex]).toBe('proud');
	});

	it('keeps every correct index valid and every option set unique', () => {
		for (const question of generateQuiz(makeTree())) {
			expect([0, 1, 2]).toContain(question.correctIndex);
			expect(new Set(question.options).size).toBe(3);
			for (const option of question.options) {
				expect(option.length).toBeLessThanOrEqual(60);
			}
		}
	});

	it('is deterministic across repeated runs', () => {
		const tree = makeTree();
		expect(generateQuiz(tree)).toEqual(generateQuiz(tree));
	});
});
