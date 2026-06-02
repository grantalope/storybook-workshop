// tests/storybook-workshop/author/age-band-calibrator.test.ts

import { describe, expect, it } from 'vitest';

import {
  AgeBandCalibrator,
  countSyllablesInWord,
  countWords,
  fleschKincaidGrade,
  splitSentences,
} from '$lib/services/author/AgeBandCalibrator';
import { AGE_BAND_CAPS, type SceneTree } from '$lib/services/author/types';

function singleSpreadTree(text: string): SceneTree {
  return {
    title: 't',
    back_cover_blurb: 'b',
    page_budget: 1,
    tier2_words: [],
    beats: [
      {
        id: 1,
        beat_name: 'setup',
        emotional_arc: 'a',
        scenes: [
          {
            sceneId: 'a-1',
            spreadCount: 1,
            sceneBrief: 'brief',
            spreads: [{ spreadIndex: 0, spread_text: text, text_focus: 'left' }],
          },
        ],
      },
    ] as unknown as SceneTree['beats'],
  };
}

const cal = new AgeBandCalibrator();

describe('AgeBandCalibrator.calibrate', () => {
  it('passes toddler-appropriate short text', () => {
    const tree = singleSpreadTree('Eli ran. The dog jumped.');
    const r = cal.calibrate(tree, 'toddler');
    expect(r.passed).toBe(true);
  });

  it('flags 12-word sentence as overflow for toddler (cap 8)', () => {
    const tree = singleSpreadTree(
      'Eli ran very quickly past the big silver tree near the rushing river.',
    );
    const r = cal.calibrate(tree, 'toddler');
    expect(r.passed).toBe(false);
    expect(r.overflows.some((o) => o.metric === 'sentence_length_words')).toBe(true);
  });

  it('accepts a 12-word sentence under sentence_length cap for grade-school (cap 22)', () => {
    const tree = singleSpreadTree(
      'Eli walked along the river quietly listening for the gentle sound of birds.',
    );
    const r = cal.calibrate(tree, 'grade-school');
    // sentence_length specifically is within cap; FK may exceed for a single
    // short paragraph (formula penalty), but THAT metric isn't what this test
    // exercises — verify the sentence-length metric is NOT among overflows.
    expect(r.overflows.some((o) => o.metric === 'sentence_length_words')).toBe(false);
  });

  it('flags long-syllable word for toddler (cap 3)', () => {
    const tree = singleSpreadTree('She felt extraordinary.');
    const r = cal.calibrate(tree, 'toddler');
    expect(r.overflows.some((o) => o.metric === 'syllables_per_word')).toBe(true);
  });

  it('flags too-many-sentences paragraph for toddler (cap 2)', () => {
    const tree = singleSpreadTree('Eli sat. The sun rose. Birds sang. The day began.');
    const r = cal.calibrate(tree, 'toddler');
    expect(r.overflows.some((o) => o.metric === 'paragraph_length_sentences')).toBe(true);
  });

  it('builds a correctionPrompt with caps for the band', () => {
    const tree = singleSpreadTree(
      'Eli ran very quickly past the big silver tree near the rushing river.',
    );
    const r = cal.calibrate(tree, 'toddler');
    const prompt = cal.correctionPrompt(r, 'toddler');
    expect(prompt).toContain(`${AGE_BAND_CAPS.toddler.sentence_length_words}`);
    expect(prompt).toContain('Spread 0');
  });

  it('returns empty correctionPrompt when passed', () => {
    const tree = singleSpreadTree('Eli ran. The sun shone.');
    const r = cal.calibrate(tree, 'toddler');
    expect(cal.correctionPrompt(r, 'toddler')).toBe('');
  });
});

describe('AgeBandCalibrator text utilities', () => {
  it('countWords ignores punctuation', () => {
    expect(countWords('Hello, world! Foo.')).toBe(3);
  });

  it('countSyllablesInWord short word is 1', () => {
    expect(countSyllablesInWord('cat')).toBe(1);
    expect(countSyllablesInWord('the')).toBe(1);
  });

  it('countSyllablesInWord polysyllabic word > 1', () => {
    expect(countSyllablesInWord('elephant')).toBeGreaterThanOrEqual(3);
    expect(countSyllablesInWord('extraordinary')).toBeGreaterThanOrEqual(5);
  });

  it('splitSentences finds 3 sentences', () => {
    expect(splitSentences('A. B! C?')).toHaveLength(3);
  });

  it('fleschKincaidGrade for short simple text is low', () => {
    const fk = fleschKincaidGrade(3, 1, 3);
    expect(fk).toBeLessThan(5);
  });
});
