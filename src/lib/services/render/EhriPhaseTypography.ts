// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * EhriPhaseTypography.ts — Per-Ehri-phase typography config.
 *
 * Phase ranges roughly per Ehri (2005):
 *   pre-alphabetic           ~age 3-4   logographic, no decoding
 *   partial-alphabetic       ~age 4-5   partial GP correspondences
 *   full-alphabetic          ~age 5-6   full GP, slow decoding
 *   consolidated-alphabetic  ~age 7+    fluent independent reading
 *
 * Defaults sized for kid-book trim (8x8, 8.5x8.5, 10x10 hardcover; reduced for
 * saddle-stitch Bedtime tier). Sizes in CSS px at 1.0 zoom.
 *
 * `easierReadingMode` (the spec §7.1 evidence-backed knob) bumps leading
 * +20%, drops max line length -15%, and forces a sans-serif default —
 * per Marinus 2016 + Atkinson dyslexia-friendly typography research.
 *
 * Font choices and citations are documented in implementation-notes.md.
 *
 * The output is JSON-serializable so the Advanced Mode pedagogy inspector
 * (spec §7.6) can show parents the actual config a spread was rendered with.
 */

import type { EhriPhase, EhriPhaseTypography } from './types';

/**
 * Curated kid-friendly font stacks. Atkinson Hyperlegible is the Braille
 * Institute's high-legibility face (Apache-2.0). Lexend is the LFT-tuned
 * sibling. Both ship reliably as Google Fonts.
 *
 * Note: the values here are CSS `font-family` strings. The compositor
 * stringifies them into a CSS shorthand (`{weight} {sizepx}px ${family}`)
 * at adapter time.
 */
const ATKINSON = '"Atkinson Hyperlegible", system-ui, sans-serif';
const LEXEND = 'Lexend, system-ui, sans-serif';
const CORMORANT = '"Cormorant Garamond", "Iowan Old Style", Georgia, serif';
const OUTFIT = 'Outfit, system-ui, sans-serif';

/**
 * Spec-default Ehri-phase configs. Read-only; pass them through
 * `applyEasierReadingMode()` to derive the easier-reading variant.
 */
export const EHRI_PHASE_DEFAULTS: Readonly<Record<EhriPhase, EhriPhaseTypography>> = Object.freeze({
  'pre-alphabetic': {
    phase: 'pre-alphabetic',
    fontFamily: ATKINSON,
    fontFamilyAlt: LEXEND,
    sizePx: 28,
    leading: 1.6,
    kerningEm: 0.04,
    trackingEm: 0.04,
    maxLineLengthChars: 22,
    weight: 700,
  },
  'partial-alphabetic': {
    phase: 'partial-alphabetic',
    fontFamily: ATKINSON,
    fontFamilyAlt: LEXEND,
    sizePx: 22,
    leading: 1.5,
    kerningEm: 0.02,
    trackingEm: 0.02,
    maxLineLengthChars: 32,
    weight: 600,
  },
  'full-alphabetic': {
    phase: 'full-alphabetic',
    fontFamily: LEXEND,
    fontFamilyAlt: OUTFIT,
    sizePx: 18,
    leading: 1.45,
    kerningEm: 0.005,
    trackingEm: 0.005,
    maxLineLengthChars: 48,
    weight: 500,
  },
  'consolidated-alphabetic': {
    phase: 'consolidated-alphabetic',
    fontFamily: CORMORANT,
    fontFamilyAlt: OUTFIT,
    sizePx: 16,
    leading: 1.4,
    kerningEm: 0,
    trackingEm: 0,
    maxLineLengthChars: 62,
    weight: 400,
  },
});

/**
 * Apply the §7.1 easier-reading knob:
 *   • leading × 1.20
 *   • maxLineLengthChars × 0.85
 *   • force the sans-serif `fontFamily` (already ATKINSON/LEXEND for the
 *     earlier phases; force ATKINSON for consolidated which defaults to
 *     a serif).
 *
 * Pure function: input config is not mutated.
 */
export function applyEasierReadingMode(cfg: EhriPhaseTypography): EhriPhaseTypography {
  const sansFamily = cfg.fontFamily.includes('serif') && !cfg.fontFamily.includes('sans-serif')
    ? ATKINSON
    : cfg.fontFamily;
  return {
    ...cfg,
    fontFamily: sansFamily,
    leading: Number((cfg.leading * 1.20).toFixed(3)),
    maxLineLengthChars: Math.max(1, Math.round(cfg.maxLineLengthChars * 0.85)),
  };
}

/**
 * Resolve a typography config for `phase`. Honors `easierReadingMode`.
 * Throws on unknown phase rather than silently defaulting — silent fallback
 * masks story-authoring bugs in inspectors.
 */
export function getEhriTypography(
  phase: EhriPhase,
  opts: { easierReadingMode?: boolean } = {},
): EhriPhaseTypography {
  const base = EHRI_PHASE_DEFAULTS[phase];
  if (!base) {
    throw new Error(`EhriPhaseTypography: unknown phase "${phase as string}"`);
  }
  return opts.easierReadingMode ? applyEasierReadingMode(base) : { ...base };
}

/**
 * Build a CSS `font` shorthand from a config (for the compositor's
 * `ProseElement.font` field).
 */
export function toCssFontShorthand(cfg: EhriPhaseTypography): string {
  return `${cfg.weight} ${cfg.sizePx}px ${cfg.fontFamily}`;
}
