import { describe, it, expect } from 'vitest';
import {
  PEAK_TIME_FRACTION,
  computePeakTimeMs,
  defaultStubRasterizer,
  capturePeakFrame,
} from '$lib/services/render/StaticFrameExporter';
import type {
  BookSpreadComposite,
  EmotionalEffect,
} from '$lib/services/render/types';

function makeComposite(effect: EmotionalEffect): BookSpreadComposite {
  return {
    spreadIndex: 1,
    effect,
    elements: [],
    focalPointFromScene: { x: 100, y: 100, radius: 50 },
    fonts: {
      phase: 'full-alphabetic',
      fontFamily: 'sans-serif', fontFamilyAlt: 'sans-serif',
      sizePx: 18, leading: 1.4, kerningEm: 0, trackingEm: 0,
      maxLineLengthChars: 40, weight: 500,
    },
    emphasis: {},
  };
}

describe('StaticFrameExporter — peak time map', () => {
  it('PEAK_TIME_FRACTION covers every spec §7.5 effect', () => {
    const required: EmotionalEffect[] = [
      'flow', 'bounce-in', 'wave', 'magnetic', 'glitch', 'dragon', 'vortex', 'rise',
    ];
    for (const ef of required) {
      expect(PEAK_TIME_FRACTION[ef]).toBeGreaterThan(0);
      expect(PEAK_TIME_FRACTION[ef]).toBeLessThan(1);
    }
  });

  it('throws on missing effect', () => {
    expect(() => computePeakTimeMs('nope' as never, 1000)).toThrow(/no peak fraction/);
  });

  it('throws when animation duration is non-positive or non-finite', () => {
    expect(() => computePeakTimeMs('flow', 0)).toThrow();
    expect(() => computePeakTimeMs('flow', -100)).toThrow();
    expect(() => computePeakTimeMs('flow', Number.POSITIVE_INFINITY)).toThrow();
  });

  it('computes peak time = fraction × duration', () => {
    expect(computePeakTimeMs('flow', 1000)).toBe(500);
    expect(computePeakTimeMs('bounce-in', 1000)).toBe(700);
    expect(computePeakTimeMs('rise', 2000)).toBe(1300);
  });
});

describe('StaticFrameExporter — rasterizer', () => {
  it('defaultStubRasterizer returns a non-empty Blob of image/png', async () => {
    const composite = makeComposite('bounce-in');
    const blob = await defaultStubRasterizer({
      composite,
      capturedAtMs: 700,
      widthPx: 100,
      heightPx: 100,
      dpi: 72,
    });
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('image/png');
  });

  it('rasterizer scales byte count with dpi/72 ratio', async () => {
    const composite = makeComposite('flow');
    const a = await defaultStubRasterizer({
      composite, capturedAtMs: 0, widthPx: 100, heightPx: 100, dpi: 72,
    });
    const b = await defaultStubRasterizer({
      composite, capturedAtMs: 0, widthPx: 100, heightPx: 100, dpi: 300,
    });
    expect(b.size).toBeGreaterThan(a.size);
  });

  it('capturePeakFrame returns blob + capturedAtMs + mutated composite', async () => {
    const composite = makeComposite('dragon');
    const out = await capturePeakFrame(composite, 1000, {
      widthPx: 200, heightPx: 200, dpi: 72,
    });
    expect(out.blob.size).toBeGreaterThan(0);
    expect(out.capturedAtMs).toBe(750);
    expect(out.composite.exportedStaticFrame).toBeTruthy();
    expect(out.composite.exportedStaticFrame?.capturedAtMs).toBe(750);
    expect(out.composite.exportedStaticFrame?.png).toBe(out.blob);
  });

  it('capturePeakFrame uses caller-supplied rasterizer when given', async () => {
    const composite = makeComposite('flow');
    const seen: number[] = [];
    const out = await capturePeakFrame(composite, 1000, {
      widthPx: 50, heightPx: 50, dpi: 72,
      rasterize: async ({ capturedAtMs }) => {
        seen.push(capturedAtMs);
        return new Blob(['x'], { type: 'image/png' });
      },
    });
    expect(seen).toEqual([500]);
    expect(out.blob.type).toBe('image/png');
  });

  it('per-effect peak coverage: 7 spec effects × 1 deterministic timing', async () => {
    const cases: Array<{ effect: EmotionalEffect; duration: number; expectedMs: number }> = [
      { effect: 'flow', duration: 1000, expectedMs: 500 },
      { effect: 'bounce-in', duration: 1000, expectedMs: 700 },
      { effect: 'wave', duration: 1000, expectedMs: 330 },
      { effect: 'magnetic', duration: 1000, expectedMs: 800 },
      { effect: 'glitch', duration: 1000, expectedMs: 650 },
      { effect: 'dragon', duration: 1000, expectedMs: 750 },
      { effect: 'vortex', duration: 1000, expectedMs: 500 },
      { effect: 'rise', duration: 1000, expectedMs: 650 },
    ];
    for (const c of cases) {
      const composite = makeComposite(c.effect);
      const out = await capturePeakFrame(composite, c.duration, {
        widthPx: 32, heightPx: 32, dpi: 72,
      });
      expect(out.capturedAtMs).toBe(c.expectedMs);
    }
  });

  it('does not mutate the input composite', async () => {
    const composite = makeComposite('flow');
    const before = JSON.parse(JSON.stringify({ ...composite, emphasis: {} }));
    await capturePeakFrame(composite, 500, { widthPx: 10, heightPx: 10, dpi: 72 });
    expect(composite.exportedStaticFrame).toBeUndefined();
    expect(composite.spreadIndex).toBe(before.spreadIndex);
  });
});
