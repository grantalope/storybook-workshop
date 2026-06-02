// tests/storybook-workshop/author/story-author-pipeline.test.ts
//
// End-to-end pipeline tests with a deterministic mocked LLM. Covers:
//   - happy path (well-formed SceneTree, schema match, ≥3 Tier-2 words used)
//   - LLM returns unsafe → retry → template fallback path
//   - LLM returns wrong budget → deterministic redistribute
//   - LLM returns missing Stein-Glenn element → retry with corrective
//   - Length-overflow → regen
//   - Template fallback structural guarantees

import { describe, expect, it, vi } from 'vitest';

import { StoryAuthorService, type KidsContentSafetyLike } from '$lib/services/author/StoryAuthorService';
import type { ChatRequest, ChatResponse } from '$lib/kernel-contracts/helpers/llr-fallback';
import type { SceneTree, StoryInput, BeatId } from '$lib/services/author/types';

// Make the privacy filter's heavy backend probing a no-op in tests by forcing
// the stub backend via test seam.
vi.mock(
  '../../../src/routes/dashboard/services/privacy/PrivacyFilterService',
  () => ({
    privacyFilterService: {
      scrub: vi.fn(async (text: string) => ({
        detections: [],
        redactedText: text,
        hardFail: false,
        inferenceMs: 0,
        backend: 'stub',
      })),
    },
  }),
);

const PERMISSIVE_SAFETY: KidsContentSafetyLike = {
  async scan() { return { passed: true, categories: [], confidence: 0 }; },
};

function baseInput(over: Partial<StoryInput> = {}): StoryInput {
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
    ...over,
  };
}

/** Build a syntactically valid SceneTree matching `targetSpreads` for mocked LLM. */
function buildValidSceneTreeJson(targetSpreads: number, tier2: string[]): string {
  // distribute spreads using the actual allocator-like math (12/6/12/22/18/18/12)
  const weights: Record<BeatId, number> = { 1: 12, 2: 6, 3: 12, 4: 22, 5: 18, 6: 18, 7: 12 };
  const raw: Record<BeatId, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  for (const id of [1, 2, 3, 4, 5, 6, 7] as BeatId[]) raw[id] = Math.max(1, Math.floor((targetSpreads * weights[id]) / 100));
  let placed = (Object.values(raw) as number[]).reduce((a, b) => a + b, 0);
  // pad to target on the biggest beat
  while (placed < targetSpreads) { raw[4] += 1; placed++; }
  while (placed > targetSpreads) { raw[4] -= 1; placed--; }

  const grammarText: Record<BeatId, string> = {
    1: `Once upon a time, the hero lived by the forest. It was a ${tier2[0] ?? 'peaceful'} morning.`,
    2: `Suddenly a letter arrived with surprising news.`,
    3: `The hero felt nervous and wondered what to do.`,
    4: `So the hero tried to follow the trail.`,
    5: `But the path was tricky. So the hero tried again.`,
    6: `Finally, the hero managed to find the answer.`,
    7: `That night, the hero smiled and felt warm and safe. The end.`,
  };

  const beatNames = ['setup', 'catalyst', 'debate', 'midpoint', 'trial', 'climax', 'resolution'] as const;
  let cursor = 0;
  const beats = [1, 2, 3, 4, 5, 6, 7].map((idn) => {
    const id = idn as BeatId;
    let remaining = raw[id];
    const scenes: any[] = [];
    let sceneCounter = 1;
    while (remaining > 0) {
      const sceneSize = Math.min(5, Math.min(3, remaining));
      const spreads = Array.from({ length: sceneSize }).map(() => ({
        spreadIndex: cursor++,
        spread_text: grammarText[id],
        text_focus: 'left' as const,
      }));
      scenes.push({
        sceneId: `${beatNames[id - 1]}-${sceneCounter++}`,
        spreadCount: sceneSize,
        sceneBrief: 'the hero in the forest',
        spreads,
      });
      remaining -= sceneSize;
    }
    return {
      id,
      beat_name: beatNames[id - 1],
      emotional_arc: 'arc',
      scenes,
    };
  });

  return JSON.stringify({
    title: 'Eli and the Forest',
    back_cover_blurb: 'A brave little story about courage.',
    tier2_words: tier2,
    beats,
  });
}

function chatReturning(content: string): (req: ChatRequest) => Promise<ChatResponse> {
  return async (_req: ChatRequest) => ({ content }) as unknown as ChatResponse;
}

function chatReturningSequence(sequence: string[]): (req: ChatRequest) => Promise<ChatResponse> {
  let i = 0;
  return async (_req: ChatRequest) => ({ content: sequence[Math.min(i++, sequence.length - 1)] }) as unknown as ChatResponse;
}

describe('StoryAuthorService.author — happy path', () => {
  it('produces a valid SceneTree matching target spread count + 7 beats', async () => {
    const svc = new StoryAuthorService();
    const tier2 = ['courage', 'tremble', 'shadow', 'brave'];
    const input = baseInput({ targetSpreads: 16 });
    const tree = await svc.author(input, {
      chatOverride: chatReturning(buildValidSceneTreeJson(16, tier2)),
      safetyOverride: PERMISSIVE_SAFETY,
    });
    expect(tree.beats.length).toBe(7);
    const total = tree.beats.reduce(
      (s, b) => s + b.scenes.reduce((bs, sc) => bs + sc.spreads.length, 0),
      0,
    );
    expect(total).toBe(16);
    expect(tree.page_budget).toBe(16);
    expect(tree.meta?.template_fallback).toBeFalsy();
  });

  it('echoes Tier-2 words into the tree', async () => {
    const svc = new StoryAuthorService();
    const tier2 = ['courage', 'tremble', 'shadow'];
    const tree = await svc.author(baseInput({ targetSpreads: 16 }), {
      chatOverride: chatReturning(buildValidSceneTreeJson(16, tier2)),
      safetyOverride: PERMISSIVE_SAFETY,
    });
    expect(tree.tier2_words.length).toBeGreaterThanOrEqual(3);
  });

  it('includes dialogic prompts when enabled', async () => {
    const svc = new StoryAuthorService();
    const tree = await svc.author(
      baseInput({ targetSpreads: 16, dialogicPromptsEnabled: true }),
      {
        chatOverride: chatReturning(buildValidSceneTreeJson(16, ['courage', 'brave', 'shadow'])),
        safetyOverride: PERMISSIVE_SAFETY,
      },
    );
    expect(tree.dialogic_prompts).toBeDefined();
    expect((tree.dialogic_prompts ?? []).length).toBeGreaterThan(0);
  });

  it('skips dialogic prompts when disabled', async () => {
    const svc = new StoryAuthorService();
    const tree = await svc.author(
      baseInput({ targetSpreads: 16, dialogicPromptsEnabled: false }),
      {
        chatOverride: chatReturning(buildValidSceneTreeJson(16, ['courage', 'brave', 'shadow'])),
        safetyOverride: PERMISSIVE_SAFETY,
      },
    );
    expect(tree.dialogic_prompts).toBeUndefined();
  });
});

describe('StoryAuthorService.author — fallback paths', () => {
  it('retries then falls back to template when LLM returns unsafe content', async () => {
    const blockingSafety: KidsContentSafetyLike = {
      async scan(text: string) {
        return text.length > 0 && text.toLowerCase().includes('hero')
          ? { passed: false, categories: ['violence'], confidence: 1 }
          : { passed: true, categories: [], confidence: 0 };
      },
    };
    const svc = new StoryAuthorService();
    const tree = await svc.author(baseInput({ targetSpreads: 16 }), {
      chatOverride: chatReturning(buildValidSceneTreeJson(16, ['courage', 'brave', 'shadow'])),
      safetyOverride: blockingSafety,
      maxLlmRetries: 1,
    });
    expect(tree.meta?.template_fallback).toBe(true);
    expect(tree.page_budget).toBe(16);
  });

  it('redistributes when LLM returns wrong total spread count', async () => {
    const svc = new StoryAuthorService();
    // Generate a tree purposefully with the wrong total (10 spreads when target is 16)
    const wrong = buildValidSceneTreeJson(10, ['courage', 'brave']);
    const tree = await svc.author(baseInput({ targetSpreads: 16 }), {
      chatOverride: chatReturning(wrong),
      safetyOverride: PERMISSIVE_SAFETY,
      maxLlmRetries: 0, // no retry, force redistribute path
    });
    const total = tree.beats.reduce(
      (s, b) => s + b.scenes.reduce((bs, sc) => bs + sc.spreads.length, 0),
      0,
    );
    expect(total).toBe(16);
    expect(tree.meta?.budget_redistributed).toBe(true);
  });

  it('falls back to template when LLM returns unparseable junk', async () => {
    const svc = new StoryAuthorService();
    const tree = await svc.author(baseInput({ targetSpreads: 24 }), {
      chatOverride: chatReturning('this is not JSON at all 🐸'),
      safetyOverride: PERMISSIVE_SAFETY,
      maxLlmRetries: 1,
    });
    expect(tree.meta?.template_fallback).toBe(true);
    expect(tree.beats.length).toBe(7);
  });

  it('falls back when grammar is missing internal_response across all retries', async () => {
    const svc = new StoryAuthorService();
    // Build a tree that's spread-budget-valid but lacks internal_response language everywhere
    const grammarless = {
      title: 't',
      back_cover_blurb: 'b',
      tier2_words: ['brave'],
      beats: [
        {
          id: 1, beat_name: 'setup', emotional_arc: 'a',
          scenes: [{ sceneId: 'setup-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 0, spread_text: 'static prose', text_focus: 'left' }] }],
        },
        {
          id: 2, beat_name: 'catalyst', emotional_arc: 'a',
          scenes: [{ sceneId: 'cat-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 1, spread_text: 'still nothing', text_focus: 'left' }] }],
        },
        {
          id: 3, beat_name: 'debate', emotional_arc: 'a',
          scenes: [{ sceneId: 'deb-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 2, spread_text: 'nothing happens', text_focus: 'left' }] }],
        },
        {
          id: 4, beat_name: 'midpoint', emotional_arc: 'a',
          scenes: [{ sceneId: 'mid-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 3, spread_text: 'still', text_focus: 'left' }] }],
        },
        {
          id: 5, beat_name: 'trial', emotional_arc: 'a',
          scenes: [{ sceneId: 'tri-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 4, spread_text: 'still', text_focus: 'left' }] }],
        },
        {
          id: 6, beat_name: 'climax', emotional_arc: 'a',
          scenes: [{ sceneId: 'cli-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 5, spread_text: 'still', text_focus: 'left' }] }],
        },
        {
          id: 7, beat_name: 'resolution', emotional_arc: 'a',
          scenes: [{ sceneId: 'res-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 6, spread_text: 'still', text_focus: 'left' }] }],
        },
      ],
    };
    const tree = await svc.author(baseInput({ targetSpreads: 7 }), {
      chatOverride: chatReturning(JSON.stringify(grammarless)),
      safetyOverride: PERMISSIVE_SAFETY,
      maxLlmRetries: 1,
    });
    expect(tree.meta?.template_fallback).toBe(true);
  });

  it('forceTemplate path produces valid tree without invoking LLM', async () => {
    const svc = new StoryAuthorService();
    const chat = vi.fn();
    const tree = await svc.author(baseInput({ targetSpreads: 16 }), {
      chatOverride: chat as any,
      forceTemplate: true,
    });
    expect(chat).not.toHaveBeenCalled();
    expect(tree.meta?.template_fallback).toBe(true);
    const total = tree.beats.reduce(
      (s, b) => s + b.scenes.reduce((bs, sc) => bs + sc.spreads.length, 0),
      0,
    );
    expect(total).toBe(16);
  });
});

describe('StoryAuthorService — template fallback structural guarantees', () => {
  it('template fallback yields valid SceneTree at every supported length', async () => {
    const svc = new StoryAuthorService();
    for (const target of [16, 24, 32, 48]) {
      const tree = await svc.author(baseInput({ targetSpreads: target }), {
        forceTemplate: true,
      });
      const total = tree.beats.reduce(
        (s, b) => s + b.scenes.reduce((bs, sc) => bs + sc.spreads.length, 0),
        0,
      );
      expect(total).toBe(target);
      expect(tree.beats.length).toBe(7);
      // contiguous spread indices
      const indices = tree.beats.flatMap((b) => b.scenes.flatMap((sc) => sc.spreads.map((sp) => sp.spreadIndex)));
      expect(indices).toEqual(Array.from({ length: target }, (_, i) => i));
    }
  });

  it('template fallback applies dialogic prompts when enabled', async () => {
    const svc = new StoryAuthorService();
    const tree = await svc.author(baseInput({ targetSpreads: 16, dialogicPromptsEnabled: true }), {
      forceTemplate: true,
    });
    expect((tree.dialogic_prompts ?? []).length).toBe(16);
  });
});

describe('StoryAuthorService — multi-attempt sequencing', () => {
  it('passes after a calibration-corrective retry produces clean prose', async () => {
    const svc = new StoryAuthorService();
    // First attempt is over-cap for preschool; second attempt is short enough
    const longText = 'Eli felt extraordinarily nervous walking carefully past the immense rolling shadowy river.';
    const longTree = {
      title: 't', back_cover_blurb: 'b', tier2_words: ['brave'],
      beats: [
        { id: 1, beat_name: 'setup', emotional_arc: 'a',
          scenes: [{ sceneId: 'setup-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 0, spread_text: longText, text_focus: 'left' }] }] },
        { id: 2, beat_name: 'catalyst', emotional_arc: 'a',
          scenes: [{ sceneId: 'cat-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 1, spread_text: 'Suddenly a letter arrived.', text_focus: 'left' }] }] },
        { id: 3, beat_name: 'debate', emotional_arc: 'a',
          scenes: [{ sceneId: 'deb-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 2, spread_text: 'Eli felt nervous.', text_focus: 'left' }] }] },
        { id: 4, beat_name: 'midpoint', emotional_arc: 'a',
          scenes: [{ sceneId: 'mid-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 3, spread_text: 'Eli tried.', text_focus: 'left' }] }] },
        { id: 5, beat_name: 'trial', emotional_arc: 'a',
          scenes: [{ sceneId: 'tri-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 4, spread_text: 'But it failed. So Eli tried again.', text_focus: 'left' }] }] },
        { id: 6, beat_name: 'climax', emotional_arc: 'a',
          scenes: [{ sceneId: 'cli-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 5, spread_text: 'Finally Eli succeeded.', text_focus: 'left' }] }] },
        { id: 7, beat_name: 'resolution', emotional_arc: 'a',
          scenes: [{ sceneId: 'res-1', spreadCount: 1, sceneBrief: 'b', spreads: [{ spreadIndex: 6, spread_text: 'Eli smiled. The end.', text_focus: 'left' }] }] },
      ],
    };
    const sequence = [JSON.stringify(longTree), buildValidSceneTreeJson(7, ['brave'])];
    const chat = chatReturningSequence(sequence);
    const tree = await svc.author(baseInput({ targetSpreads: 7 }), {
      chatOverride: chat,
      safetyOverride: PERMISSIVE_SAFETY,
      maxLlmRetries: 2,
    });
    expect(tree.page_budget).toBe(7);
  });
});

describe('StoryAuthorService.scrubSceneBriefsAsync', () => {
  it('replaces literal kid name with "the hero" in scene briefs', async () => {
    const svc = new StoryAuthorService();
    const tree: SceneTree = {
      title: 't', back_cover_blurb: 'b', page_budget: 1, tier2_words: [],
      beats: [
        { id: 1, beat_name: 'setup', emotional_arc: 'a',
          scenes: [{ sceneId: 'setup-1', spreadCount: 1, sceneBrief: 'Eli runs through the forest', spreads: [{ spreadIndex: 0, spread_text: 't', text_focus: 'left' }] }] },
      ] as unknown as SceneTree['beats'],
    };
    await svc.scrubSceneBriefsAsync(tree, baseInput({ kidName: 'Eli' }));
    expect(tree.beats[0].scenes[0].sceneBrief).not.toMatch(/\bEli\b/);
    expect(tree.beats[0].scenes[0].sceneBrief).toContain('the hero');
  });
});

describe('StoryAuthorService — kernel + safety surface', () => {
  it('exposes a globalThis.__sw_storyAuthor singleton', () => {
    const g = globalThis as any;
    expect(g.__sw_storyAuthor).toBeDefined();
    expect(typeof g.__sw_storyAuthor.author).toBe('function');
  });
});
