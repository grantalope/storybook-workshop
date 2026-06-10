// tests/author/story-quality-gate.test.ts
//
// StoryAuthorService post-gen quality gate: a structurally valid draft that
// scores below the prose-quality threshold triggers exactly ONE regeneration
// with the rubric feedback injected, and the better of the two drafts wins
// (best-of-2). Fixtures are hand-built 7-beat trees that pass the structural
// gates (safety / grammar / calibration) at three quality levels.

import { describe, expect, it, vi } from 'vitest';

import {
  StoryAuthorService,
  type KidsContentSafetyLike,
} from '$lib/services/author/StoryAuthorService';
import { scoreSceneTree, DEFAULT_QUALITY_THRESHOLD } from '$lib/services/author/StoryQualityScorer';
import type { ChatRequest, ChatResponse } from '$lib/kernel-contracts/helpers/llr-fallback';
import type { BeatId, SceneTree, StoryInput } from '$lib/services/author/types';

const PERMISSIVE_SAFETY: KidsContentSafetyLike = {
  async scan() {
    return { passed: true, categories: [], confidence: 0 };
  },
};

function baseInput(over: Partial<StoryInput> = {}): StoryInput {
  return {
    kidName: 'Eli',
    ageBand: 'grade-school',
    ehriPhase: 'full-alphabetic',
    theme: 'overcoming-fear',
    occasion: 'just-because',
    sidekickSettlerId: 'sidekick-1',
    supportingCast: [],
    localeBiome: 'forest',
    targetSpreads: 7,
    dedicationText: '',
    dialogicPromptsEnabled: false,
    easierReadingMode: false,
    ...over,
  };
}

const BEAT_NAMES = ['setup', 'catalyst', 'debate', 'midpoint', 'trial', 'climax', 'resolution'];

/** Build a 7-beat / 1-spread-per-beat tree from per-beat texts. */
function mk7(title: string, texts: Record<BeatId, string>): SceneTree {
  return {
    title,
    back_cover_blurb: 'A story to read together.',
    page_budget: 7,
    tier2_words: ['brave'],
    beats: ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).map((id) => ({
      id,
      beat_name: BEAT_NAMES[id - 1] as SceneTree['beats'][number]['beat_name'],
      emotional_arc: 'arc',
      scenes: [
        {
          sceneId: `${BEAT_NAMES[id - 1]}-1`,
          spreadCount: 1 as const,
          sceneBrief: 'the hero in the forest',
          spreads: [
            { spreadIndex: id - 1, spread_text: texts[id], text_focus: 'left' as const },
          ],
        },
      ],
    })),
  };
}

// HIGH quality: hooks on every non-final spread, refrain-free grade-school
// register, body-language emotion, concrete nouns + sensory details, dialogue.
const HIGH_TREE = mk7('Pip and the Lost Egg', {
  1: 'Once, by the old oak, lived a fox named Pip. Pip packed a red drum. Tap-tap. Who knocked back?',
  2: 'Then a round egg fell into the den. Thump! "Who lost an egg?" Pip whispered…',
  3: "Pip's tummy fluttered. Keep the egg warm? Or hunt for its nest in the dark?",
  4: 'Pip wrapped the egg in soft moss and set off. One step. Two steps. But the trail split — which way?',
  5: 'Pip tried the creek path first. But the stones wobbled! Splash — cold toes. So Pip tried the fern path…',
  6: 'At last Pip found the nest in the pine. Up, up, up. The egg fit just right — click. "Did it… wiggle?"',
  7: 'A small beak peeped hello. Pip smiled and drummed soft. Tap-tap. Safe and snug. The end.',
});

// LOW quality: structurally valid (grammar keywords present, calibration-safe
// short simple words) but flat — no hooks, emotion labels, abstract prose.
const LOW_TREE = mk7('A Nice Story', {
  1: 'Once there was a child. The child lived in a place. It was nice there.',
  2: 'Suddenly a letter came. It was for the child. That was a big thing.',
  3: 'The child felt nervous. The child felt worried too. It was a lot.',
  4: 'So the child tried to fix it. The child did some things. It went on.',
  5: 'But it did not work. So the child tried more. Then it worked out.',
  6: 'At last the child managed to do it. It was all fine. It was good.',
  7: 'The child smiled. It felt safe. The end.',
});

// MEDIUM quality: the LOW tree with a few page-turn hooks added — still under
// the threshold, but strictly better than LOW.
const MEDIUM_TREE = mk7('A Question Story', {
  1: 'Once there was a child. The child lived in a place. Was it nice there?',
  2: 'Suddenly a letter came. It was for the child. What did it say?',
  3: 'The child felt nervous. The child felt worried too. It was a lot.',
  4: 'So the child tried to fix it. The child did some things. Did it work?',
  5: 'But it did not work. So the child tried more. Then it worked out.',
  6: 'At last the child managed to do it. It was all fine. It was good.',
  7: 'The child smiled. It felt safe. The end.',
});

function chatSequence(trees: SceneTree[]): {
  chat: (req: ChatRequest) => Promise<ChatResponse>;
  calls: ChatRequest[];
} {
  const calls: ChatRequest[] = [];
  let i = 0;
  const chat = async (req: ChatRequest): Promise<ChatResponse> => {
    calls.push(req);
    const tree = trees[Math.min(i++, trees.length - 1)];
    return { content: JSON.stringify(tree) } as unknown as ChatResponse;
  };
  return { chat, calls };
}

describe('fixture sanity', () => {
  it('HIGH clears the default threshold; MEDIUM beats LOW; both stay under it', () => {
    const high = scoreSceneTree(HIGH_TREE, { ageBand: 'grade-school' });
    const medium = scoreSceneTree(MEDIUM_TREE, { ageBand: 'grade-school' });
    const low = scoreSceneTree(LOW_TREE, { ageBand: 'grade-school' });
    expect(high.total).toBeGreaterThanOrEqual(DEFAULT_QUALITY_THRESHOLD);
    expect(medium.total).toBeLessThan(DEFAULT_QUALITY_THRESHOLD);
    expect(low.total).toBeLessThan(DEFAULT_QUALITY_THRESHOLD);
    expect(medium.total).toBeGreaterThan(low.total);
  });
});

describe('StoryAuthorService — post-gen quality gate (best-of-2)', () => {
  it('regenerates once when the first draft scores below threshold and keeps the better draft', async () => {
    const svc = new StoryAuthorService();
    const { chat, calls } = chatSequence([LOW_TREE, HIGH_TREE]);
    const tree = await svc.author(baseInput(), {
      chatOverride: chat,
      safetyOverride: PERMISSIVE_SAFETY,
    });
    expect(calls.length).toBe(2);
    expect(tree.title).toBe('Pip and the Lost Egg');
    expect(tree.meta?.quality_regenerated).toBe(true);
    expect(tree.meta?.quality_score).toBe(
      scoreSceneTree(HIGH_TREE, { ageBand: 'grade-school' }).total,
    );
  });

  it('does not regenerate when the first draft clears the bar', async () => {
    const svc = new StoryAuthorService();
    const { chat, calls } = chatSequence([HIGH_TREE]);
    const tree = await svc.author(baseInput(), {
      chatOverride: chat,
      safetyOverride: PERMISSIVE_SAFETY,
    });
    expect(calls.length).toBe(1);
    expect(tree.meta?.quality_regenerated).toBeFalsy();
    expect(tree.meta?.quality_score).toBeGreaterThanOrEqual(DEFAULT_QUALITY_THRESHOLD);
  });

  it('keeps the first draft when the regeneration scores worse (best-of-2)', async () => {
    const svc = new StoryAuthorService();
    const { chat, calls } = chatSequence([MEDIUM_TREE, LOW_TREE]);
    const tree = await svc.author(baseInput(), {
      chatOverride: chat,
      safetyOverride: PERMISSIVE_SAFETY,
    });
    expect(calls.length).toBe(2);
    expect(tree.title).toBe('A Question Story');
    expect(tree.meta?.quality_regenerated).toBe(true);
    expect(tree.meta?.quality_score).toBe(
      scoreSceneTree(MEDIUM_TREE, { ageBand: 'grade-school' }).total,
    );
  });

  it('injects the rubric feedback into the regeneration prompt', async () => {
    const svc = new StoryAuthorService();
    const { chat, calls } = chatSequence([LOW_TREE, HIGH_TREE]);
    await svc.author(baseInput(), {
      chatOverride: chat,
      safetyOverride: PERMISSIVE_SAFETY,
    });
    const secondUserMsg = String(
      (calls[1].messages as Array<{ role: string; content: string }>).find(
        (m) => m.role === 'user',
      )?.content ?? '',
    );
    expect(secondUserMsg).toMatch(/prose-quality rubric/);
    expect(secondUserMsg).toMatch(/Page-turn hooks/);
  });

  it('skipQualityGate skips the regeneration but still records the score', async () => {
    const svc = new StoryAuthorService();
    const { chat, calls } = chatSequence([LOW_TREE, HIGH_TREE]);
    const tree = await svc.author(baseInput(), {
      chatOverride: chat,
      safetyOverride: PERMISSIVE_SAFETY,
      skipQualityGate: true,
    });
    expect(calls.length).toBe(1);
    expect(tree.title).toBe('A Nice Story');
    expect(tree.meta?.quality_regenerated).toBeFalsy();
    expect(tree.meta?.quality_score).toBe(
      scoreSceneTree(LOW_TREE, { ageBand: 'grade-school' }).total,
    );
  });

  it('respects a custom qualityThreshold', async () => {
    const svc = new StoryAuthorService();
    const { chat, calls } = chatSequence([LOW_TREE, HIGH_TREE]);
    const tree = await svc.author(baseInput(), {
      chatOverride: chat,
      safetyOverride: PERMISSIVE_SAFETY,
      qualityThreshold: 10,
    });
    expect(calls.length).toBe(1);
    expect(tree.title).toBe('A Nice Story');
    expect(tree.meta?.quality_regenerated).toBeFalsy();
  });

  it('template fallback records a quality_score that clears the default bar', async () => {
    const svc = new StoryAuthorService();
    const chat = vi.fn();
    const tree = await svc.author(baseInput({ targetSpreads: 16 }), {
      chatOverride: chat as any,
      forceTemplate: true,
    });
    expect(chat).not.toHaveBeenCalled();
    expect(tree.meta?.template_fallback).toBe(true);
    expect(tree.meta?.quality_score).toBeGreaterThanOrEqual(DEFAULT_QUALITY_THRESHOLD);
  });
});
