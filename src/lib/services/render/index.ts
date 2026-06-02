// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * index.ts — Public barrel for the storybook-workshop render pipeline.
 *
 * All consumers (BookSpreadCanvas.svelte, BookAssembler, debug preview
 * page, vitest suites) import from this file rather than reaching into
 * individual modules — keeps the surface area discoverable.
 */

export * from './types';

export {
  DEFAULT_EFFECT_MAP,
  CLIMAX_ALT,
  getDefaultEffect,
  overrideEffect,
  resolveEffectMap,
} from './EmotionalEffectMap';

export {
  EHRI_PHASE_DEFAULTS,
  applyEasierReadingMode,
  getEhriTypography,
  toCssFontShorthand,
} from './EhriPhaseTypography';

export {
  DEFAULT_TIER2_CAP,
  highlight,
  runsToPlainText,
  countEmphasized,
} from './Tier2EmphasisHighlighter';

export {
  pickCorner,
  render as renderDialogicPrompts,
} from './DialogicPromptRenderer';
export type { MarginCorner } from './DialogicPromptRenderer';

export {
  BookSpreadSurfaceAdapter,
  compose as composeBookSpread,
} from './BookSpreadSurfaceAdapter';
export type { BookSpreadComposeInput } from './BookSpreadSurfaceAdapter';

export {
  PEAK_TIME_FRACTION,
  computePeakTimeMs,
  defaultStubRasterizer,
  capturePeakFrame,
} from './StaticFrameExporter';
export type { CapturePeakOpts, PeakFrameRasterizer } from './StaticFrameExporter';
