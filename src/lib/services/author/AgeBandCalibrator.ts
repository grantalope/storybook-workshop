// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/AgeBandCalibrator.ts
//
// Per-spec §3.6 sentence-length / syllable / paragraph-length caps per age band:
//
//   toddler     (2-4y) :  ≤8 words / sentence,  ≤3 syllables / word,  ≤2 sentences / paragraph
//   preschool   (4-6y) : ≤14 words / sentence,  ≤4 syllables / word,  ≤4 sentences / paragraph
//   grade-school(6-9y) : ≤22 words / sentence,  ≤6 syllables / word,  ≤6 sentences / paragraph
//
// Plus a Flesch-Kincaid grade-level cap (1 / 3 / 5).
//
// Uses an inlined FK formula (no `text-readability` dep — keeps the worker
// portable on Windows + CI envs without a Linux-only readability pkg).
//
// Returns CalibrationResult; caller (StoryAuthorService) decides whether to
// trigger a regen pass.

import {
  AGE_BAND_CAPS,
  type AgeBand,
  type CalibrationOverflow,
  type CalibrationResult,
  type SceneTree,
} from './types';

export class AgeBandCalibrator {
  calibrate(tree: SceneTree, ageBand: AgeBand): CalibrationResult {
    const caps = AGE_BAND_CAPS[ageBand];
    const overflows: CalibrationOverflow[] = [];

    // Per-spread structural caps (sentence length, syllables/word, paragraph length).
    // These DO read sensibly at single-spread scale.
    for (const beat of tree.beats) {
      for (const scene of beat.scenes) {
        for (const spread of scene.spreads) {
          const text = spread.spread_text ?? '';
          if (text.trim().length === 0) continue;

          const sentences = splitSentences(text);

          let longestSentenceWords = 0;
          let longestWordSyllables = 0;
          for (const s of sentences) {
            const sw = countWords(s);
            if (sw > longestSentenceWords) longestSentenceWords = sw;
            for (const w of tokenize(s)) {
              const sy = countSyllablesInWord(w);
              if (sy > longestWordSyllables) longestWordSyllables = sy;
            }
          }

          if (longestSentenceWords > caps.sentence_length_words) {
            overflows.push({
              spreadIndex: spread.spreadIndex,
              metric: 'sentence_length_words',
              actual: longestSentenceWords,
              cap: caps.sentence_length_words,
            });
          }
          if (longestWordSyllables > caps.syllables_per_word) {
            overflows.push({
              spreadIndex: spread.spreadIndex,
              metric: 'syllables_per_word',
              actual: longestWordSyllables,
              cap: caps.syllables_per_word,
            });
          }
          if (sentences.length > caps.paragraph_length_sentences) {
            overflows.push({
              spreadIndex: spread.spreadIndex,
              metric: 'paragraph_length_sentences',
              actual: sentences.length,
              cap: caps.paragraph_length_sentences,
            });
          }
        }
      }
    }

    // Flesch-Kincaid is aggregated at BOOK level. The formula is designed for
    // paragraph-scale prose; on single short kid-book spreads it would over-
    // fire (a 7-word sentence with 14 syllables grades ~10). Aggregating across
    // every spread in the tree gives a representative book-wide grade.
    let bookWords = 0;
    let bookSentences = 0;
    let bookSyllables = 0;
    for (const beat of tree.beats) {
      for (const scene of beat.scenes) {
        for (const spread of scene.spreads) {
          const text = spread.spread_text ?? '';
          if (text.trim().length === 0) continue;
          bookSentences += splitSentences(text).length;
          bookWords += countWords(text);
          bookSyllables += sumSyllables(text);
        }
      }
    }
    const fk = fleschKincaidGrade(bookWords, bookSentences, bookSyllables);
    if (fk > caps.flesch_kincaid_grade_max) {
      overflows.push({
        spreadIndex: -1, // book-level
        metric: 'flesch_kincaid_grade',
        actual: Math.round(fk * 10) / 10,
        cap: caps.flesch_kincaid_grade_max,
      });
    }

    return { passed: overflows.length === 0, overflows };
  }

  /** Build corrective prompt addendum from overflows. */
  correctionPrompt(result: CalibrationResult, ageBand: AgeBand): string {
    if (result.passed) return '';
    const caps = AGE_BAND_CAPS[ageBand];
    const lines: string[] = [
      `Several spreads exceed the ${ageBand} reading caps:`,
      `- Max sentence length: ${caps.sentence_length_words} words`,
      `- Max syllables per word: ${caps.syllables_per_word}`,
      `- Max sentences per paragraph: ${caps.paragraph_length_sentences}`,
      `- Max Flesch-Kincaid grade: ${caps.flesch_kincaid_grade_max}`,
    ];
    const bySpread = new Map<number, CalibrationOverflow[]>();
    for (const o of result.overflows) {
      const arr = bySpread.get(o.spreadIndex) ?? [];
      arr.push(o);
      bySpread.set(o.spreadIndex, arr);
    }
    const spreadList = Array.from(bySpread.keys()).sort((a, b) => a - b);
    for (const idx of spreadList) {
      const items = bySpread.get(idx) ?? [];
      const fmt = items.map((i) => `${i.metric}=${i.actual} (cap ${i.cap})`).join(', ');
      lines.push(`- Spread ${idx}: ${fmt}`);
    }
    lines.push(
      'Rewrite the offending spreads with shorter sentences and simpler vocabulary while keeping the story beats intact.',
    );
    return lines.join('\n');
  }
}

// ─── Text utilities (pure) ──────────────────────────────────────────────────

const SENTENCE_SPLIT_RE = /[.!?]+/;
const TOKEN_RE = /[a-z'’]+/gi;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

/** Lightweight syllable estimator. Vowel-group method with common refinements. */
export function countSyllablesInWord(rawWord: string): number {
  const w = rawWord.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;

  // Strip a silent trailing 'e' but not 'le' endings
  let trimmed = w;
  if (trimmed.endsWith('e') && !trimmed.endsWith('le')) {
    trimmed = trimmed.slice(0, -1);
  }
  // Count vowel groups (avoid double-counting consecutive vowels)
  const groups = trimmed.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;
  // Adjust for common diphthongs that read as 1 syllable but get split
  count = Math.max(1, count);
  return count;
}

export function sumSyllables(text: string): number {
  let total = 0;
  for (const w of tokenize(text)) total += countSyllablesInWord(w);
  return total;
}

/**
 * Flesch-Kincaid grade level.
 *   FKGL = 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
 *
 * Negative values (very simple text) are clamped to 0 for the cap check.
 */
export function fleschKincaidGrade(
  words: number,
  sentences: number,
  syllables: number,
): number {
  if (words === 0 || sentences === 0) return 0;
  const fk = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
  return Math.max(0, fk);
}

export const ageBandCalibrator = new AgeBandCalibrator();
