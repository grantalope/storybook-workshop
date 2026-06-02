// tests/storybook-workshop/author/story-grammar-validator.test.ts

import { describe, expect, it } from 'vitest';

import { StoryGrammarValidator } from '$lib/services/author/StoryGrammarValidator';
import { BEAT_NAMES, type Beat, type SceneTree, type BeatId } from '$lib/services/author/types';

function tree(beatTexts: Record<BeatId, string>): SceneTree {
  const beats: Beat[] = ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).map((id) => ({
    id,
    beat_name: BEAT_NAMES[id],
    emotional_arc: 'a',
    scenes: [
      {
        sceneId: `${BEAT_NAMES[id]}-1`,
        spreadCount: 1,
        sceneBrief: 'brief',
        spreads: [{ spreadIndex: id - 1, spread_text: beatTexts[id] ?? '', text_focus: 'left' }],
      },
    ],
  }));
  return { title: 't', back_cover_blurb: 'b', page_budget: 7, tier2_words: [], beats };
}

const v = new StoryGrammarValidator();

describe('StoryGrammarValidator.validate', () => {
  it('passes a tree with all 6 elements expressed in canonical beat positions', () => {
    const r = v.validate(
      tree({
        1: 'Once upon a time, Eli lived in the forest.',
        2: 'Suddenly a stranger arrived with a letter.',
        3: 'Eli felt nervous and wondered what to do.',
        4: 'So Eli tried to open the letter.',
        5: 'But the wind blew it away. Eli tried again.',
        6: 'Finally, Eli managed to read the news.',
        7: 'That night, Eli smiled and felt warm and safe.',
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.missing.length).toBe(0);
  });

  it('flags missing internal_response (beat 3) with correct gap report', () => {
    const r = v.validate(
      tree({
        1: 'Once upon a time in the meadow.',
        2: 'Suddenly a noise came.',
        3: 'Mute beat. No worry. No wonder.', // missing internal_response indicators
        4: 'Eli tried to look.',
        5: 'But it did not work. Eli tried again.',
        6: 'Finally she succeeded.',
        7: 'The end. Eli felt proud.',
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.beatGaps[3]).toContain('internal_response');
  });

  it('flags missing initiating_event (beat 2)', () => {
    const r = v.validate(
      tree({
        1: 'Once upon a time, Eli lived in the meadow.',
        2: 'Empty content here.',
        3: 'Eli felt nervous and wondered.',
        4: 'Eli tried.',
        5: 'But it failed. So Eli tried again.',
        6: 'Finally Eli succeeded.',
        7: 'Eli felt proud and the end.',
      }),
    );
    expect(r.beatGaps[2]).toContain('initiating_event');
  });

  it('flags missing reaction (beat 7) when finale skips the resolution language', () => {
    const r = v.validate(
      tree({
        1: 'Once upon a time, Eli lived in the meadow.',
        2: 'Suddenly a letter arrived.',
        3: 'Eli felt curious.',
        4: 'Eli tried opening it.',
        5: 'But the wind. Eli tried again.',
        6: 'Finally she read it.',
        7: 'A perfunctory closing without feelings.',
      }),
    );
    expect(r.beatGaps[7]).toContain('reaction');
  });

  it('correctionPrompt mentions each missing element and beat gap', () => {
    const r = v.validate(
      tree({
        1: 'Setting line.',
        2: 'No initiating signal here.',
        3: 'Eli felt curious.',
        4: 'Eli tried.',
        5: 'But it failed. So Eli tried.',
        6: 'Finally she succeeded.',
        7: 'Eli smiled and the end.',
      }),
    );
    const prompt = v.correctionPrompt(r);
    expect(prompt).toContain('Beat 2');
  });

  it('returns empty correction when passed', () => {
    const r = v.validate(
      tree({
        1: 'Once upon a time, Eli lived in the meadow.',
        2: 'Suddenly a letter arrived.',
        3: 'Eli felt nervous and wondered.',
        4: 'Eli tried.',
        5: 'But it failed. So Eli tried again.',
        6: 'Finally she succeeded.',
        7: 'Eli smiled and felt proud. The end.',
      }),
    );
    expect(v.correctionPrompt(r)).toBe('');
  });

  it('does not crash on empty beat scenes', () => {
    const empty: SceneTree = tree({ 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '' });
    const r = v.validate(empty);
    expect(r.passed).toBe(false);
  });

  it('beat 5 must show both attempt + consequence', () => {
    const r = v.validate(
      tree({
        1: 'Once upon a time, Eli lived.',
        2: 'Suddenly the letter arrived.',
        3: 'Eli felt nervous.',
        4: 'Eli tried.',
        5: 'Just walked around.', // no attempt/consequence keywords
        6: 'Finally Eli succeeded.',
        7: 'Eli smiled. The end.',
      }),
    );
    expect(r.beatGaps[5].length).toBeGreaterThan(0);
  });
});
