// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/Tier2VocabPlanner.ts
//
// Picks 3-5 Tier-2 target words per book.
// Per goal markdown Phase 2 + spec §3.5/§7.1 #5 (Beck/McKeown/Kucan 2013):
//
//   - theme relevance (high weight)
//   - age-band match (HARD gate — words above kid's band rejected)
//   - anti-repetition against priorBooksWords (high weight, negative)
//   - spaced exposure: words 2-3 books back upweighted to reappear (~10-encounter rule, Nagy 1985)
//
// Pure function — no kernel deps. Deterministic given the same input + corpus.

import type { StoryInput, Tier2WordEntry, AgeBand, StoryTheme } from './types';
import { TIER2_VOCAB_CORPUS_DEDUPED } from './tier2-vocab-corpus';

export interface Tier2PlannerOptions {
  /** Override corpus for tests. */
  corpus?: Tier2WordEntry[];
  /** Default 4. Allowed range 3..5 per spec. */
  count?: number;
  /** Deterministic tie-breaker; default deterministic hash. */
  rngSeed?: number;
}

export interface Tier2PlannerResult {
  words: string[];
  /** Scored details for advanced-mode Vocabulary Inspector + tests. */
  details: { word: string; score: number; reasons: string[] }[];
}

/**
 * The series-level "re-exposure window" — Beck-McKeown says ~10 encounters
 * for solid acquisition; spaced over multiple books pays off more than
 * cramming in one. Books 2-3 prior get the strongest re-exposure weight.
 */
const RE_EXPOSURE_WINDOW = { minIdx: 2, maxIdx: 4 } as const;

const ageBandRank: Record<AgeBand, number> = {
  toddler: 0,
  preschool: 1,
  'grade-school': 2,
};

/** Pure helper: word passes age band gate (word.ageBandMin <= kid.ageBand). */
function ageBandPasses(wordBand: AgeBand, kidBand: AgeBand): boolean {
  return ageBandRank[wordBand] <= ageBandRank[kidBand];
}

/** Pure scoring fn. Higher = better candidate. */
function scoreWord(
  entry: Tier2WordEntry,
  theme: StoryTheme,
  kidBand: AgeBand,
  priorBooksWords: string[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1) theme relevance — primary signal
  if (entry.themeAffinities.includes(theme)) {
    score += 100;
    reasons.push(`theme:${theme}`);
  } else {
    score += 25; // off-theme words still eligible, just weaker
    reasons.push('off-theme');
  }

  // 2) age band match — also a soft boost when word is well within band
  const wordRank = ageBandRank[entry.ageBandMin];
  const kidRank = ageBandRank[kidBand];
  if (wordRank === kidRank) {
    score += 25;
    reasons.push('age-band:exact');
  } else if (wordRank < kidRank) {
    score += 5; // simpler than kid's band — still ok but less novel
    reasons.push('age-band:below');
  }

  // 3) anti-repetition: prior-book words penalized hard
  const priorIdx = priorBooksWords.indexOf(entry.word); // 0 = most recent
  if (priorIdx === 0) {
    score -= 200;
    reasons.push('penalty:appeared-last-book');
  } else if (priorIdx === 1) {
    score -= 60;
    reasons.push('penalty:appeared-2-books-ago');
  } else if (priorIdx >= RE_EXPOSURE_WINDOW.minIdx && priorIdx <= RE_EXPOSURE_WINDOW.maxIdx) {
    // 4) spaced exposure: words 2-3 books back (idx 2-4) get re-exposed
    score += 40;
    reasons.push(`spaced-exposure:idx=${priorIdx}`);
  } else if (priorIdx > RE_EXPOSURE_WINDOW.maxIdx) {
    // very old prior-words: neutral
    reasons.push('prior-old:neutral');
  }

  // 5) syllable preference — slight nudge toward 2-syllable mid-complexity
  if (entry.syllables === 2) {
    score += 3;
  }

  return { score, reasons };
}

/** Deterministic small RNG for stable tie-breaking. xorshift32. */
function makeRng(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

/** Stable hash of StoryInput → seed. */
function seedFromInput(input: StoryInput): number {
  const s = `${input.kidName}|${input.theme}|${input.ageBand}|${input.targetSpreads}|${input.localeBiome}`;
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Tier2VocabPlanner {
  pickWords(input: StoryInput, opts: Tier2PlannerOptions = {}): Tier2PlannerResult {
    const corpus = opts.corpus ?? TIER2_VOCAB_CORPUS_DEDUPED;
    const requested = clamp(opts.count ?? 4, 3, 5);
    const priorBooksWords = input.priorBooksWords ?? [];

    // 1) hard gate: only words at-or-below kid's age band
    const eligible = corpus.filter((e) => ageBandPasses(e.ageBandMin, input.ageBand));

    // 2) score all eligible
    const scored = eligible.map((e) => ({
      entry: e,
      ...scoreWord(e, input.theme, input.ageBand, priorBooksWords),
    }));

    // 3) deterministic tie-breaker via small RNG
    const rng = makeRng(opts.rngSeed ?? seedFromInput(input));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // stable tie-break: hash by word to avoid bias toward alphabet order
      const ra = rng();
      const rb = rng();
      return ra - rb;
    });

    // 4) take top N, ensuring no duplicates (corpus is already deduped but be safe)
    const seen = new Set<string>();
    const picked: typeof scored = [];
    for (const s of scored) {
      if (seen.has(s.entry.word)) continue;
      seen.add(s.entry.word);
      picked.push(s);
      if (picked.length >= requested) break;
    }

    return {
      words: picked.map((p) => p.entry.word),
      details: picked.map((p) => ({
        word: p.entry.word,
        score: p.score,
        reasons: p.reasons,
      })),
    };
  }

  /** Test/debug surface: score a single word. */
  scoreWord(entry: Tier2WordEntry, input: StoryInput): { score: number; reasons: string[] } {
    return scoreWord(entry, input.theme, input.ageBand, input.priorBooksWords ?? []);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export const tier2VocabPlanner = new Tier2VocabPlanner();
