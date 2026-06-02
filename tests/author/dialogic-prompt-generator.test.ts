// tests/storybook-workshop/author/dialogic-prompt-generator.test.ts

import { describe, expect, it } from 'vitest';

import { DialogicPromptGenerator } from '$lib/services/author/DialogicPromptGenerator';
import {
  BEAT_NAMES,
  BEAT_PROMPT_DEFAULTS,
  type Beat,
  type BeatId,
  type SceneTree,
  type StoryInput,
} from '$lib/services/author/types';

function input(over: Partial<StoryInput> = {}): StoryInput {
  return {
    kidName: 'Eli',
    ageBand: 'preschool',
    ehriPhase: 'partial-alphabetic',
    theme: 'curiosity',
    occasion: 'just-because',
    sidekickSettlerId: 's1',
    supportingCast: [],
    localeBiome: 'forest',
    targetSpreads: 7,
    dedicationText: '',
    dialogicPromptsEnabled: true,
    easierReadingMode: false,
    ...over,
  };
}

function tree(): SceneTree {
  const beats: Beat[] = ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).map((id) => ({
    id,
    beat_name: BEAT_NAMES[id],
    emotional_arc: 'arc',
    scenes: [
      {
        sceneId: `${BEAT_NAMES[id]}-1`,
        spreadCount: 1,
        sceneBrief: 'b',
        spreads: [{ spreadIndex: id - 1, spread_text: 't', text_focus: 'left' }],
      },
    ],
  }));
  return { title: 't', back_cover_blurb: 'b', page_budget: 7, tier2_words: [], beats };
}

const gen = new DialogicPromptGenerator();

describe('DialogicPromptGenerator.generate', () => {
  it('returns empty when dialogic prompts disabled', () => {
    const r = gen.generate(tree(), input({ dialogicPromptsEnabled: false }));
    expect(r).toHaveLength(0);
  });

  it('returns one prompt per spread by default', () => {
    const r = gen.generate(tree(), input());
    expect(r).toHaveLength(7); // 7 spreads
  });

  it('returns two prompts per spread when maxPerSpread=2', () => {
    const r = gen.generate(tree(), input(), { maxPerSpread: 2 });
    expect(r).toHaveLength(14);
  });

  it('uses per-beat default prompt type', () => {
    const r = gen.generate(tree(), input());
    for (const p of r) {
      // each spread is in a single beat — find which beat by index
      const beatId = (p.spreadIndex + 1) as BeatId;
      expect(p.type).toBe(BEAT_PROMPT_DEFAULTS[beatId]);
    }
  });

  it('uses kidName in prompt text', () => {
    const r = gen.generate(tree(), input({ kidName: 'Marigold' }));
    const usesName = r.filter((p) => p.text.includes('Marigold'));
    expect(usesName.length).toBeGreaterThan(0);
  });

  it('every prompt has peerFollowup or undefined', () => {
    const r = gen.generate(tree(), input());
    for (const p of r) {
      if (p.peerFollowup !== undefined) expect(typeof p.peerFollowup).toBe('string');
    }
  });
});

describe('DialogicPromptGenerator.normalize', () => {
  it('shapes partial LLM prompts and skips ones with missing text', () => {
    const t = tree();
    const llm = [
      { spreadIndex: 0, type: 'wh-question' as const, text: 'Where is the hero?' },
      { spreadIndex: 1, text: '' }, // skipped: empty text
      { spreadIndex: 2, text: 'Why?' }, // type defaulted from beat
    ];
    const r = gen.normalize(llm, t);
    expect(r).toHaveLength(2);
    expect(r[1].type).toBe(BEAT_PROMPT_DEFAULTS[3]); // beat 3 default
  });

  it('rejects unknown LLM-supplied `type` strings and falls back to beat default', () => {
    const t = tree();
    const llm = [
      // Hallucinated enum from a misbehaving LLM — must NOT leak through.
      { spreadIndex: 4, type: 'why-question' as unknown as 'wh-question', text: 'Why does it matter?' },
      // Valid enum stays intact.
      { spreadIndex: 5, type: 'open-ended' as const, text: 'What if?' },
    ];
    const r = gen.normalize(llm, t);
    expect(r).toHaveLength(2);
    expect(r[0].type).toBe(BEAT_PROMPT_DEFAULTS[5]); // beat 5 default — not the LLM's bogus value
    expect(r[1].type).toBe('open-ended');
  });
});
