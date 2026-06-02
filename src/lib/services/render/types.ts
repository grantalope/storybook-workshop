// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * types.ts — Shape definitions for the Storybook Workshop book-spread render
 * pipeline. Per spec §3.8 + §7.5.
 *
 * The BookSpreadSurfaceAdapter turns a (Spread, Beat, FocalPoint, opts) tuple
 * into a `BookSpreadComposite` carrying the LayoutElement array ready for
 * `PretextCompositor.setElements('book-spread', ...)`, plus the metadata that
 * StaticFrameExporter + BookSpreadCanvas.svelte need to render the digital
 * read-along (animated) and capture the print PNG (static).
 */

import type { LayoutElement } from '$lib/pretext/CompositorTypes';
import type { EffectMode } from '$lib/pretext/PretextEffectEngine';

// ── Beat identity ───────────────────────────────────────────────────────────

/** Pixar 7-beat structure per spec §3.5 + §7.5. */
export type BeatId =
  | 'setup'
  | 'catalyst'
  | 'debate'
  | 'midpoint'
  | 'trial'
  | 'climax'
  | 'resolution';

export const BEAT_IDS: readonly BeatId[] = [
  'setup', 'catalyst', 'debate', 'midpoint', 'trial', 'climax', 'resolution',
] as const;

// ── Effect alias ────────────────────────────────────────────────────────────

/**
 * Alias of `PretextEffectEngine.EffectMode`. The goal markdown lists 12 modes;
 * the engine literal for Catalyst's "bounce" is `'bounce-in'`. We mirror the
 * engine literal so no extension to PretextEffectEngine is needed.
 */
export type EmotionalEffect = EffectMode;

// ── Ehri reading phase ──────────────────────────────────────────────────────

/**
 * Ehri (2005) phases of reading acquisition. Drives typography weight + size.
 * `pre-alphabetic` and `partial-alphabetic` are the Bedtime tier and Magic
 * tier defaults; `consolidated-alphabetic` is fluent independent readers.
 */
export type EhriPhase =
  | 'pre-alphabetic'
  | 'partial-alphabetic'
  | 'full-alphabetic'
  | 'consolidated-alphabetic';

/**
 * Pure-data typography config for a single Ehri phase. JSON-serializable so
 * it can be embedded in a draft / surfaced in Advanced Mode inspectors.
 */
export interface EhriPhaseTypography {
  phase: EhriPhase;
  /** Primary kid-readable font family, applied as a CSS font shorthand. */
  fontFamily: string;
  /** Secondary fallback font family (also kid-readable). */
  fontFamilyAlt: string;
  /** Body text size in CSS px at 1.0 zoom. */
  sizePx: number;
  /** Leading (line-height) as a multiplier of `sizePx`. */
  leading: number;
  /** Letter-spacing in `em` units. Positive = wider tracking. */
  kerningEm: number;
  /** Same as `kerningEm` for now (kept distinct to allow future divergence). */
  trackingEm: number;
  /**
   * Max line length in characters (approx). Per Marinus 2016 evidence:
   * shorter lines for earlier phases.
   */
  maxLineLengthChars: number;
  /** Default font weight (400=regular, 700=bold). */
  weight: number;
}

// ── Focal point ─────────────────────────────────────────────────────────────

/**
 * Scene focal point in spread coordinates. Text wraps AROUND this circle via
 * `PretextFlowEngine`'s obstacle list. Coords are in spread-px space (the
 * same space `BookSpreadRenderOpts.scenePngWidth/Height` is sized in).
 */
export interface FocalPoint {
  x: number;
  y: number;
  /** Half-extent of the focal-point bbox; pipeline converts to a rect obstacle. */
  radius: number;
}

// ── Tier-2 emphasis ─────────────────────────────────────────────────────────

/**
 * A typed text run produced by `Tier2EmphasisHighlighter`. The compositor's
 * `ProseElement` does not yet support per-run emphasis natively; runs are
 * collapsed into prose text + an out-of-band emphasis map that
 * `BookSpreadCanvas.svelte` reads to apply the visual treatment.
 */
export interface TextRun {
  text: string;
  emphasis: 'none' | 'tier2';
}

export type Tier2EmphasisTreatment = 'weight' | 'italic' | 'color';

// ── Dialogic prompts ────────────────────────────────────────────────────────

/** A single PEER/CROWD-style prompt rendered in the spread margin. */
export interface DialogicPrompt {
  id: string;
  /** Crowd taxonomy (Completion / Recall / Open / Wh-question / Distancing). */
  kind: 'completion' | 'recall' | 'open' | 'wh-question' | 'distancing';
  /** The prompt sentence shown to parent + child. */
  text: string;
}

// ── Spread + beat ───────────────────────────────────────────────────────────

/**
 * The minimum spread shape this adapter consumes. The Workshop's full
 * `Spread` shape will live in a sibling goal (BookAssembler / story-author);
 * we define just enough to type the adapter input.
 */
export interface Spread {
  spreadIndex: number;
  /** Primary prose body for the spread (already age-band calibrated). */
  text: string;
  /** Words flagged Tier-2 by the vocabulary pipeline. */
  tier2Words: string[];
  /** PEER/CROWD prompts for this spread (optional; empty if disabled). */
  dialogicPrompts: DialogicPrompt[];
}

/** The beat this spread belongs to. */
export interface Beat {
  id: BeatId;
  /** Title shown in inspectors, not in the rendered spread. */
  title?: string;
}

// ── Composite + opts ────────────────────────────────────────────────────────

export interface BookSpreadRenderOpts {
  scenePngWidth: number;
  scenePngHeight: number;
  /** 300 dpi = print, 72 dpi = screen. */
  dpi: 300 | 72;
  easierReadingMode: boolean;
  dialogicPromptsEnabled: boolean;
  /** Optional Tier-2 visual treatment override; default = weight bump. */
  tier2Treatment?: Tier2EmphasisTreatment;
  /** Optional cap override (default 2 per spread). */
  tier2EmphasisCap?: number;
}

/**
 * Output of `BookSpreadSurfaceAdapter.composite()`. Consumed by
 * `BookSpreadCanvas.svelte` (digital) and `StaticFrameExporter` (print).
 */
export interface BookSpreadComposite {
  spreadIndex: number;
  /** Resolved effect for this spread's beat (default or override). */
  effect: EmotionalEffect;
  /** All elements ready for `PretextCompositor.setElements('book-spread', ...)`. */
  elements: LayoutElement[];
  /** Focal point copied from the scene-render output. */
  focalPointFromScene: FocalPoint;
  /** Resolved Ehri typography config. */
  fonts: EhriPhaseTypography;
  /** Tier-2 emphasis runs keyed by `ProseElement.id`. */
  emphasis: Record<string, TextRun[]>;
  /** Optional captured static frame for the print PDF. */
  exportedStaticFrame?: {
    png: Blob;
    capturedAtMs: number;
  };
}
