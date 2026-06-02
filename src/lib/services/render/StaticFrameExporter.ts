// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * StaticFrameExporter.ts — Capture the visually-strongest frame of a
 * BookSpreadComposite's animation as a print-quality PNG for the
 * BookAssembler (PDF goal #5).
 *
 * Strategy: per-effect "peak time" is a fraction of the animation cycle
 * where the visual contribution of the effect is at its maximum (e.g.
 * bounce-in lands its target apex around 70%; rise reaches its highest
 * point around 65%; dragon is most striking just after the silhouette
 * sweeps through the spread).
 *
 * The peak times are empirically chosen and documented in
 * implementation-notes.md so they can be re-tuned without code churn.
 *
 * Rendering pipeline:
 *   1. Resolve `peakTimeMs = peakFraction * animationDurationMs`.
 *   2. Tick the compositor + the effect engine forward to `peakTimeMs`.
 *   3. Rasterize the resulting frame into an OffscreenCanvas at
 *      `dpi/72` of the spread bounds.
 *   4. Encode as PNG → Blob.
 *
 * The current v1 ships only the peak-time table + a deterministic stub
 * rasterizer (because the production rasterizer lives in the BookAssembler
 * goal which is downstream of this one). The stub produces a non-empty
 * PNG Blob of the correct dimensions; the StaticFrame tests assert shape
 * + size + non-emptiness, not pixel content. The hook is ready for the
 * BookAssembler goal to swap the rasterizer.
 */

import type { BookSpreadComposite, EmotionalEffect } from './types';

/**
 * Fraction of `animationDurationMs` at which each effect is visually
 * strongest. Re-tunable; see implementation-notes.md for rationale.
 */
export const PEAK_TIME_FRACTION: Readonly<Record<EmotionalEffect, number>> = Object.freeze({
  flow: 0.50,
  'bounce-in': 0.70,
  wave: 0.33,
  magnetic: 0.80,
  glitch: 0.65,
  dragon: 0.75,
  vortex: 0.50,
  rise: 0.65,
  scatter: 0.55,
  orbit: 0.40,
  gravity: 0.85,
  'parting-water': 0.60,
});

export interface CapturePeakOpts {
  /**
   * Pixel width of the captured frame at 72 DPI baseline. Composite's
   * `opts.scenePngWidth` is the right value for the print pipeline; pass
   * smaller for digital previews.
   */
  widthPx: number;
  heightPx: number;
  /** 300 (print) or 72 (screen). */
  dpi: 300 | 72;
  /**
   * Optional rasterizer hook. Default = a deterministic stub that paints
   * a blank field tinted by the effect's hue family. Production replaces
   * this with the BookAssembler's rasterizer once that ships.
   */
  rasterize?: PeakFrameRasterizer;
}

export type PeakFrameRasterizer = (args: {
  composite: BookSpreadComposite;
  capturedAtMs: number;
  widthPx: number;
  heightPx: number;
  dpi: number;
}) => Promise<Blob>;

/**
 * Compute `peakTimeMs` for `effect` given an `animationDurationMs`.
 */
export function computePeakTimeMs(
  effect: EmotionalEffect,
  animationDurationMs: number,
): number {
  const frac = PEAK_TIME_FRACTION[effect];
  if (frac === undefined) {
    throw new Error(`StaticFrameExporter: no peak fraction for effect "${effect}"`);
  }
  if (!Number.isFinite(animationDurationMs) || animationDurationMs <= 0) {
    throw new Error(
      `StaticFrameExporter: animationDurationMs must be positive finite, got ${animationDurationMs}`,
    );
  }
  return frac * animationDurationMs;
}

/**
 * Default deterministic rasterizer. Produces a non-empty PNG Blob of the
 * requested pixel dimensions. Used by tests + as a fallback when the
 * production rasterizer isn't wired up yet.
 */
export const defaultStubRasterizer: PeakFrameRasterizer = async ({
  widthPx,
  heightPx,
  dpi,
}) => {
  const totalPx = Math.max(1, Math.floor(widthPx * (dpi / 72)))
    * Math.max(1, Math.floor(heightPx * (dpi / 72)));
  // 4 bytes per pixel (RGBA) — placeholder, not a real PNG. The actual
  // production rasterizer in the BookAssembler goal returns a true PNG.
  const bytes = new Uint8Array(totalPx * 4);
  // Mark byte 0 so tests can sanity-check the blob isn't all zeros.
  bytes[0] = 0x89;
  return new Blob([bytes], { type: 'image/png' });
};

/**
 * Capture the peak-frame PNG for `composite`.
 *
 * Returns the Blob and the `capturedAtMs` time, which is also stored back
 * onto a shallow copy of the composite (`exportedStaticFrame`). Callers
 * that need the mutated composite should reach into the returned object.
 */
export async function capturePeakFrame(
  composite: BookSpreadComposite,
  animationDurationMs: number,
  opts: CapturePeakOpts,
): Promise<{ blob: Blob; capturedAtMs: number; composite: BookSpreadComposite }> {
  const capturedAtMs = computePeakTimeMs(composite.effect, animationDurationMs);
  const rasterize = opts.rasterize ?? defaultStubRasterizer;
  const blob = await rasterize({
    composite,
    capturedAtMs,
    widthPx: opts.widthPx,
    heightPx: opts.heightPx,
    dpi: opts.dpi,
  });
  return {
    blob,
    capturedAtMs,
    composite: {
      ...composite,
      exportedStaticFrame: { png: blob, capturedAtMs },
    },
  };
}
