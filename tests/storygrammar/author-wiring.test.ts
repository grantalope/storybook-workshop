import { describe, expect, it } from 'vitest';

import { BEAT_NAMES, type Beat, type BeatId, type SceneTree, type StoryInput } from '$lib/services/author/types';
import {
	StoryAuthorService,
	type KidsContentSafetyLike,
} from '$lib/services/author/StoryAuthorService';
import type { ChatRequest, ChatResponse } from '$lib/kernel-contracts/helpers/llr-fallback';
import type { SceneTreeCacheStore } from '$lib/services/storygrammar';
import type { Tier2VocabPlanner } from '$lib/services/author/Tier2VocabPlanner';
import { storyBudgetAllocator } from '$lib/services/author/StoryBudgetAllocator';

const PERMISSIVE_SAFETY: KidsContentSafetyLike = {
	async scan() {
		return { passed: true, categories: [], confidence: 0 };
	},
};

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
		targetSpreads: 16,
		dedicationText: '',
		dialogicPromptsEnabled: false,
		easierReadingMode: false,
		...overrides,
	};
}

function monolithicTreeJson(targetSpreads: number): string {
	const budget = storyBudgetAllocator.allocate(targetSpreads);
	let cursor = 0;
	const beats = ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).map((beatId) => {
		const spreads = Array.from({ length: budget[beatId] }).map(() => ({
			spreadIndex: cursor++,
			spread_text: grammarTextForBeat(beatId),
			text_focus: 'left' as const,
			illustration_brief: 'the hero in a clear visual moment',
		}));
		return {
			id: beatId,
			beat_name: BEAT_NAMES[beatId],
			emotional_arc: 'steady',
			scenes: [
				{
					sceneId: `${BEAT_NAMES[beatId]}-1`,
					spreadCount: spreads.length as Beat['scenes'][number]['spreadCount'],
					sceneBrief: 'the hero in a clear visual moment',
					spreads,
				},
			],
		};
	});
	return JSON.stringify({
		title: 'The Brave Forest',
		back_cover_blurb: 'The hero takes one brave step.',
		page_budget: targetSpreads,
		tier2_words: ['brave', 'glimmer', 'steady'],
		beats,
	});
}

function chatCapturingUserMessage(
	captured: string[],
	content = monolithicTreeJson(16),
): (req: ChatRequest) => Promise<ChatResponse> {
	return async (req: ChatRequest) => {
		captured.push(String((req as any).messages[1].content));
		return { content } as unknown as ChatResponse;
	};
}

function beatChat(counter: { calls: number }, malformedBeat3Once = false) {
	let malformedReturned = false;
	return async (req: ChatRequest): Promise<ChatResponse> => {
		counter.calls++;
		const user = String((req as any).messages[1].content);
		const beatId = Number(user.match(/"beatId":(\d+)/)?.[1]) as BeatId;
		const spreadBudget = Number(user.match(/"spreadBudget":(\d+)/)?.[1]);
		if (malformedBeat3Once && beatId === 3 && !malformedReturned) {
			malformedReturned = true;
			return { content: 'not json' } as unknown as ChatResponse;
		}
		return {
			content: JSON.stringify(buildBeat(beatId, spreadBudget)),
		} as unknown as ChatResponse;
	};
}

function buildBeat(beatId: BeatId, spreadBudget: number): Beat {
	const scenes: Beat['scenes'] = [];
	let remaining = spreadBudget;
	let sceneIndex = 1;
	while (remaining > 0) {
		const sceneSize = Math.min(5, remaining) as Beat['scenes'][number]['spreadCount'];
		scenes.push({
			sceneId: `${BEAT_NAMES[beatId]}-${sceneIndex++}`,
			spreadCount: sceneSize,
			sceneBrief: 'the hero in a clear visual moment',
			spreads: Array.from({ length: sceneSize }).map((_, index) => ({
				spreadIndex: index,
				spread_text: grammarTextForBeat(beatId),
				text_focus: 'left',
				illustration_brief: 'the hero in a clear visual moment',
			})),
		});
		remaining -= sceneSize;
	}
	return {
		id: beatId,
		beat_name: BEAT_NAMES[beatId],
		emotional_arc: 'steady',
		scenes,
	};
}

function grammarTextForBeat(beatId: BeatId): string {
	return {
		1: 'Once upon a time, the hero lived in the forest.',
		2: 'Suddenly a bell rang.',
		3: 'The hero wondered what to do.',
		4: 'The hero tried one step.',
		5: 'But the bridge wobbled, so the hero tried again.',
		6: 'Finally, the hero solved it.',
		7: 'That night, the hero smiled back home.',
	}[beatId];
}

class TestCache implements SceneTreeCacheStore {
	readonly entries = new Map<string, SceneTree>();

	async get(hash: string): Promise<SceneTree | null> {
		return this.entries.get(hash) ?? null;
	}

	async put(hash: string, tree: SceneTree): Promise<void> {
		this.entries.set(hash, tree);
	}
}

describe('StoryAuthorService story grammar wiring', () => {
	it('keeps the monolithic user message byte-identical when the flag is off', async () => {
		const originalEnv = process.env.STORY_GRAMMAR;
		delete process.env.STORY_GRAMMAR;
		try {
			const service = new StoryAuthorService();
			const first: string[] = [];
			const second: string[] = [];
			await service.author(input(), {
				storyGrammar: false,
				chatOverride: chatCapturingUserMessage(first),
				safetyOverride: PERMISSIVE_SAFETY,
				skipQualityGate: true,
			});
			await service.author(input(), {
				chatOverride: chatCapturingUserMessage(second),
				safetyOverride: PERMISSIVE_SAFETY,
				skipQualityGate: true,
			});

			expect(first[0]).toBe(second[0]);
		} finally {
			if (originalEnv === undefined) delete process.env.STORY_GRAMMAR;
			else process.env.STORY_GRAMMAR = originalEnv;
		}
	});

	it('appends the skeleton section when story grammar is enabled', async () => {
		const captured: string[] = [];
		const service = new StoryAuthorService();
		await service.author(input(), {
			storyGrammar: true,
			skeletonSeed: 123,
			chatOverride: chatCapturingUserMessage(captured),
			safetyOverride: PERMISSIVE_SAFETY,
			skipQualityGate: true,
		});

		expect(captured[0]).toContain('## Story skeleton (follow exactly)');
	});

	it('authors per beat with exactly seven LLM calls and a valid budget', async () => {
		const service = new StoryAuthorService();
		const counter = { calls: 0 };
		const tree = await service.authorPerBeat(input(), {
			skeletonSeed: 77,
			chatOverride: beatChat(counter),
			safetyOverride: PERMISSIVE_SAFETY,
		});

		expect(counter.calls).toBe(7);
		expect(tree.meta?.per_beat).toBe(true);
		expect(tree.beats.map((beat) => beat.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		const total = tree.beats.reduce(
			(sum, beat) => sum + beat.scenes.reduce((beatSum, scene) => beatSum + scene.spreads.length, 0),
			0,
		);
		expect(total).toBe(input().targetSpreads);
	});

	it('retries one malformed per-beat response and still assembles the tree', async () => {
		const service = new StoryAuthorService();
		const counter = { calls: 0 };
		const tree = await service.authorPerBeat(input(), {
			skeletonSeed: 77,
			chatOverride: beatChat(counter, true),
			safetyOverride: PERMISSIVE_SAFETY,
		});

		expect(counter.calls).toBe(8);
		expect(tree.beats.length).toBe(7);
	});

	it('returns a cached per-beat tree without another LLM call', async () => {
		const service = new StoryAuthorService();
		const cache = new TestCache();
		const firstCounter = { calls: 0 };
		const first = await service.authorPerBeat(input(), {
			skeletonSeed: 77,
			sceneTreeCache: cache,
			chatOverride: beatChat(firstCounter),
			safetyOverride: PERMISSIVE_SAFETY,
		});
		const secondCounter = { calls: 0 };
		const second = await service.authorPerBeat(input(), {
			skeletonSeed: 77,
			sceneTreeCache: cache,
			chatOverride: beatChat(secondCounter),
			safetyOverride: PERMISSIVE_SAFETY,
		});

		expect(firstCounter.calls).toBe(7);
		expect(secondCounter.calls).toBe(0);
		expect(second).toEqual(first);
	});

	it('enforces the per-beat context budget before oversized beat prompts are sent', async () => {
		const hugePlanner = {
			pickWords: () => ({
				words: ['x'.repeat(9000)],
				details: [],
			}),
		} as unknown as Tier2VocabPlanner;
		const service = new StoryAuthorService(hugePlanner);
		const counter = { calls: 0 };

		await expect(
			service.authorPerBeat(input(), {
				skeletonSeed: 77,
				chatOverride: beatChat(counter),
				safetyOverride: PERMISSIVE_SAFETY,
			}),
		).rejects.toThrow(/must be < 8000/);
		expect(counter.calls).toBe(1);
	});
});
