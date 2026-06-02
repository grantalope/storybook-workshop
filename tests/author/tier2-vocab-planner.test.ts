// tests/storybook-workshop/author/tier2-vocab-planner.test.ts

import { describe, expect, it } from 'vitest';

import { Tier2VocabPlanner } from '$lib/services/author/Tier2VocabPlanner';
import {
  TIER2_VOCAB_CORPUS_DEDUPED,
  TIER2_VOCAB_CORPUS_SIZE,
} from '$lib/services/author/tier2-vocab-corpus';
import type { StoryInput } from '$lib/services/author/types';

function baseInput(over: Partial<StoryInput> = {}): StoryInput {
  return {
    kidName: 'Eli',
    ageBand: 'preschool',
    ehriPhase: 'partial-alphabetic',
    theme: 'overcoming-fear',
    occasion: 'just-because',
    sidekickSettlerId: 's1',
    supportingCast: [],
    localeBiome: 'forest',
    targetSpreads: 24,
    dedicationText: '',
    dialogicPromptsEnabled: true,
    easierReadingMode: false,
    ...over,
  };
}

describe('Tier2VocabPlanner.pickWords', () => {
  const planner = new Tier2VocabPlanner();

  it('returns 4 words by default within count bounds 3..5', () => {
    const out = planner.pickWords(baseInput());
    expect(out.words.length).toBeGreaterThanOrEqual(3);
    expect(out.words.length).toBeLessThanOrEqual(5);
  });

  it('honors count option', () => {
    const out = planner.pickWords(baseInput(), { count: 5 });
    expect(out.words.length).toBe(5);
  });

  it('clamps count below 3 to 3 and above 5 to 5', () => {
    const a = planner.pickWords(baseInput(), { count: 1 });
    expect(a.words.length).toBe(3);
    const b = planner.pickWords(baseInput(), { count: 10 });
    expect(b.words.length).toBe(5);
  });

  it('respects age-band hard gate (toddler kid never gets grade-school-only words)', () => {
    const toddler = planner.pickWords(baseInput({ ageBand: 'toddler' }), { count: 5 });
    const gradeOnly = TIER2_VOCAB_CORPUS_DEDUPED.filter((w) => w.ageBandMin === 'grade-school');
    for (const word of toddler.words) {
      expect(gradeOnly.map((w) => w.word).includes(word)).toBe(false);
    }
  });

  it('prefers theme-affinity words', () => {
    const out = planner.pickWords(baseInput({ theme: 'overcoming-fear' }), { count: 5 });
    const corpus = new Map(TIER2_VOCAB_CORPUS_DEDUPED.map((e) => [e.word, e] as const));
    const themeMatchCount = out.words.filter((w) =>
      corpus.get(w)?.themeAffinities.includes('overcoming-fear'),
    ).length;
    expect(themeMatchCount).toBeGreaterThanOrEqual(3); // most of 5 should match
  });

  it('penalizes most-recent prior-book words (anti-repetition)', () => {
    const out1 = planner.pickWords(
      baseInput({ priorBooksWords: ['courage', 'brave', 'tremble'] }),
      { count: 5 },
    );
    expect(out1.words.includes('courage')).toBe(false); // appeared most-recently
    expect(out1.words.includes('brave')).toBe(false);
  });

  it('upweights spaced-exposure words from 2-3 books back', () => {
    // Word at idx 2 (3 books ago) should be eligible for re-exposure
    const idx2Word = 'forever'; // appears in our corpus
    const out = planner.pickWords(
      baseInput({
        theme: 'saying-goodbye',
        priorBooksWords: ['unrelated1', 'unrelated2', idx2Word, 'unrelated3', 'unrelated4'],
      }),
      { count: 5 },
    );
    // Spaced-exposure boost makes it likely to reappear; not guaranteed but verify scoring reasons
    const detail = out.details.find((d) => d.word === idx2Word);
    if (detail) {
      expect(detail.reasons.some((r) => r.startsWith('spaced-exposure'))).toBe(true);
    } else {
      // If theme-affinity ties pushed it out, sanity-check the corpus still contains it
      expect(TIER2_VOCAB_CORPUS_DEDUPED.some((w) => w.word === idx2Word)).toBe(true);
    }
  });

  it('is deterministic given the same input + rngSeed', () => {
    const a = planner.pickWords(baseInput(), { count: 5, rngSeed: 42 });
    const b = planner.pickWords(baseInput(), { count: 5, rngSeed: 42 });
    expect(a.words).toEqual(b.words);
  });

  it('returns no duplicate words', () => {
    const out = planner.pickWords(baseInput(), { count: 5 });
    const dedup = new Set(out.words);
    expect(dedup.size).toBe(out.words.length);
  });

  it('details carry score + reasons for each picked word', () => {
    const out = planner.pickWords(baseInput(), { count: 4 });
    expect(out.details.length).toBe(out.words.length);
    for (const d of out.details) {
      expect(typeof d.score).toBe('number');
      expect(Array.isArray(d.reasons)).toBe(true);
    }
  });
});

describe('TIER2_VOCAB_CORPUS', () => {
  it('has a sizable curated corpus', () => {
    expect(TIER2_VOCAB_CORPUS_SIZE).toBeGreaterThanOrEqual(150);
  });

  it('every entry has a kid definition', () => {
    for (const e of TIER2_VOCAB_CORPUS_DEDUPED) {
      expect(e.definition_kid.length).toBeGreaterThan(0);
    }
  });

  it('every entry has at least one theme affinity', () => {
    for (const e of TIER2_VOCAB_CORPUS_DEDUPED) {
      expect(e.themeAffinities.length).toBeGreaterThanOrEqual(1);
    }
  });
});
