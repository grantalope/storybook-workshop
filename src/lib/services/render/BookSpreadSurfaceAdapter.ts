// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * BookSpreadSurfaceAdapter.ts — Map (Spread, Beat, FocalPoint, opts) → a
 * `BookSpreadComposite` ready for the PretextCompositor.
 *
 * Pipeline (spec §3.8):
 *   a. Resolve emotional effect via `EmotionalEffectMap.getDefaultEffect`.
 *   b. Resolve Ehri-phase typography (honors `easierReadingMode`).
 *   c. Tier-2 emphasis runs (capped per spread).
 *   d. Build the focal-point obstacle as a 1×1 GridBlockElement so
 *      `PretextCompositor.rebuildObstacles` emits exactly one obstacle
 *      sized to the focal-point bbox. The base prose then flows around it
 *      via `PretextFlowEngine.computeAvailableWidth`.
 *   e. Dialogic prompt margin elements via `DialogicPromptRenderer`.
 *   f. Assemble the element tree (focal-obstacle + prose + dialogic).
 *
 * Output is consumed by `BookSpreadCanvas.svelte` (digital read-along, live
 * animation) and `StaticFrameExporter` (peak-frame PNG for the print PDF).
 */

import type {
  LayoutElement,
  GridBlockElement,
  ProseElement,
  PixelRect,
} from '$lib/pretext/CompositorTypes';
import type { AsciiCell } from '$lib/pretext/AsciiTypes';

import type {
  Beat,
  BookSpreadComposite,
  BookSpreadRenderOpts,
  EhriPhase,
  EhriPhaseTypography,
  EmotionalEffect,
  FocalPoint,
  Spread,
  TextRun,
} from './types';

import { getDefaultEffect } from './EmotionalEffectMap';
import { getEhriTypography, toCssFontShorthand } from './EhriPhaseTypography';
import { highlight, runsToPlainText } from './Tier2EmphasisHighlighter';
import { render as renderDialogic } from './DialogicPromptRenderer';

const PROSE_COLOR = '#1f2937';
const PROSE_Z = 2;
const FOCAL_Z = 1;

/**
 * Public input bundle. Callers pass the Spread + the Beat + the WB scene
 * focal point + render opts + an Ehri-phase choice (resolved upstream from
 * the kid's age band per spec §3.6).
 */
export interface BookSpreadComposeInput {
  spread: Spread;
  beat: Beat;
  sceneFocal: FocalPoint;
  ehriPhase: EhriPhase;
  /**
   * Spread pixel bounds. Independent of `scenePngWidth/Height` because the
   * spread frame is the typographic surface (slightly larger than the scene
   * to leave margin for dialogic prompts + Ehri leading).
   */
  spreadBounds: PixelRect;
  opts: BookSpreadRenderOpts;
  /**
   * Optional override for the spread's emotional effect (Advanced Mode
   * §7.6). When omitted, spec §7.5 default for `beat.id` is used.
   */
  effectOverride?: EmotionalEffect;
}

/** ── Internal helpers ─────────────────────────────────────────────────── */

function buildFocalObstacle(focal: FocalPoint): GridBlockElement {
  const w = focal.radius * 2;
  const h = focal.radius * 2;
  const cell: AsciiCell = { glyph: '█', fg: '#00000000' };
  const grid: AsciiCell[][] = [[cell]];
  return {
    type: 'grid',
    id: `book-spread-focal-${focal.x.toFixed(0)}-${focal.y.toFixed(0)}`,
    grid,
    bounds: { x: focal.x - focal.radius, y: focal.y - focal.radius, width: w, height: h },
    cellW: w,
    cellH: h,
    zIndex: FOCAL_Z,
    surface: 'book-spread',
  };
}

function buildProse(
  spread: Spread,
  fonts: EhriPhaseTypography,
  spreadBounds: PixelRect,
  emphasizedRuns: TextRun[],
): ProseElement {
  const plain = runsToPlainText(emphasizedRuns);
  return {
    type: 'prose',
    id: `book-spread-prose-${spread.spreadIndex}`,
    text: plain,
    font: toCssFontShorthand(fonts),
    color: PROSE_COLOR,
    maxWidth: spreadBounds.width,
    origin: { x: spreadBounds.x, y: spreadBounds.y },
    lineHeight: Math.round(fonts.sizePx * fonts.leading),
    zIndex: PROSE_Z,
    surface: 'book-spread',
  };
}

/** ── Public adapter ───────────────────────────────────────────────────── */

export function compose(input: BookSpreadComposeInput): BookSpreadComposite {
  const { spread, beat, sceneFocal, ehriPhase, spreadBounds, opts, effectOverride } = input;

  // a) Effect resolution
  const effect: EmotionalEffect = effectOverride ?? getDefaultEffect(beat.id);

  // b) Typography
  const fonts = getEhriTypography(ehriPhase, {
    easierReadingMode: opts.easierReadingMode,
  });

  // c) Tier-2 emphasis runs
  const emphasizedRuns = highlight(spread.text, spread.tier2Words, {
    cap: opts.tier2EmphasisCap,
  });

  // d) Focal obstacle (one 1×1 grid sized to the focal-point bbox)
  const focalEl = buildFocalObstacle(sceneFocal);

  // e) Prose element (the compositor's `tick()` will flow it around `focalEl`)
  const proseEl = buildProse(spread, fonts, spreadBounds, emphasizedRuns);

  // f) Dialogic prompts (margin), if enabled and present
  const dialogicEls = opts.dialogicPromptsEnabled
    ? renderDialogic(spread.dialogicPrompts, spread.spreadIndex, spreadBounds)
    : [];

  const elements: LayoutElement[] = [focalEl, proseEl, ...dialogicEls];

  return {
    spreadIndex: spread.spreadIndex,
    effect,
    elements,
    focalPointFromScene: { ...sceneFocal },
    fonts,
    emphasis: { [proseEl.id]: emphasizedRuns },
  };
}

/**
 * Convenience class form mirroring the existing surface-adapter pattern
 * (other adapters export plain `adapt…()` functions; for book spreads we
 * export both — the function for terse usage, a class for callers that
 * want to inject defaults).
 */
export class BookSpreadSurfaceAdapter {
  composite(input: BookSpreadComposeInput): BookSpreadComposite {
    return compose(input);
  }
}
