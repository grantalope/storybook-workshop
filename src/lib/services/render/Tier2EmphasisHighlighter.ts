// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * Tier2EmphasisHighlighter.ts — Subtle per-run emphasis for Tier-2 words.
 *
 * "Tier-2 vocabulary" per Beck-McKeown is the band of high-utility academic
 * words a young reader meets in print but rarely in conversation
 * (`gleam`, `wander`, `argue`, ...). The spec §7.1 calls Tier-2 density a
 * pedagogy knob — surface a few per book without flattening every page.
 *
 * Visual treatment defaults to `'weight'` (font-weight +1 step). Optional
 * `'italic'` or `'color'` alternatives are configurable per render call.
 *
 * Cap: spread emphasis is capped (default 2 words per spread) so the visual
 * "this word matters" signal stays meaningful.
 *
 * Returned `TextRun[]` is a per-spread emphasis manifest keyed by the
 * `ProseElement.id` it applies to; consumers (BookSpreadCanvas.svelte,
 * StaticFrameExporter) overlay the treatment after PretextCompositor lays
 * out the base prose.
 */

import type { TextRun } from './types';

export const DEFAULT_TIER2_CAP = 2;

/**
 * Split `spreadText` into TextRun[] runs. Word-bounded matching against
 * `tier2Words` (case-insensitive), but the run text preserves original
 * casing.
 *
 * The emphasis cap applies to the *count of emphasized runs*, not the
 * total Tier-2 occurrences in the string — the first N matches win.
 *
 * Punctuation is treated as run terminator: `cat,` and `cat` both match
 * the Tier-2 entry `cat`, with the punctuation preserved in its own
 * trailing `none` run.
 */
export function highlight(
  spreadText: string,
  tier2Words: string[],
  opts: { cap?: number } = {},
): TextRun[] {
  if (!spreadText) return [];
  const cap = Math.max(0, opts.cap ?? DEFAULT_TIER2_CAP);
  const targets = new Set(tier2Words.filter(Boolean).map(w => w.toLowerCase()));

  // Token boundaries: capture words (alphanumeric + apostrophe + hyphen) vs
  // the gaps (whitespace + punctuation). Preserve both in order.
  const tokens = spreadText.match(/[A-Za-z][A-Za-z'\-]*|[^A-Za-z]+/g) ?? [];

  const runs: TextRun[] = [];
  let emphasizedCount = 0;

  for (const token of tokens) {
    if (/^[A-Za-z][A-Za-z'\-]*$/.test(token)
        && targets.has(token.toLowerCase())
        && emphasizedCount < cap) {
      runs.push({ text: token, emphasis: 'tier2' });
      emphasizedCount += 1;
    } else {
      // Coalesce with previous `none` run for compactness.
      const prev = runs[runs.length - 1];
      if (prev && prev.emphasis === 'none') {
        prev.text += token;
      } else {
        runs.push({ text: token, emphasis: 'none' });
      }
    }
  }

  return runs;
}

/**
 * Build the plain prose string back from a TextRun[] — useful when handing
 * the runs to the PretextCompositor's `ProseElement.text` field while
 * storing the runs themselves out-of-band for the renderer to consult.
 */
export function runsToPlainText(runs: TextRun[]): string {
  return runs.map(r => r.text).join('');
}

/**
 * Count emphasized runs (for tests + the Vocabulary Inspector in
 * Advanced Mode).
 */
export function countEmphasized(runs: TextRun[]): number {
  let n = 0;
  for (const r of runs) if (r.emphasis === 'tier2') n += 1;
  return n;
}
