import { describe, it, expect } from 'vitest';
import {
  compose,
  BookSpreadSurfaceAdapter,
} from '$lib/services/render/BookSpreadSurfaceAdapter';
import type {
  Beat,
  Spread,
  FocalPoint,
  BookSpreadRenderOpts,
  EhriPhase,
} from '$lib/services/render/types';

const SPREAD_BOUNDS = { x: 0, y: 0, width: 720, height: 540 };

const baseSpread = (): Spread => ({
  spreadIndex: 0,
  text: 'In the garden the dragon learned to whisper kindly.',
  tier2Words: ['whisper', 'kindly'],
  dialogicPrompts: [
    { id: 'p1', kind: 'open', text: 'What might the dragon say next?' },
  ],
});

const baseBeat: Beat = { id: 'setup', title: 'Setup' };

const baseFocal: FocalPoint = { x: 360, y: 270, radius: 80 };

const baseOpts: BookSpreadRenderOpts = {
  scenePngWidth: 720,
  scenePngHeight: 540,
  dpi: 300,
  easierReadingMode: false,
  dialogicPromptsEnabled: true,
};

const basePhase: EhriPhase = 'partial-alphabetic';

function buildInput(over: Partial<{
  spread: Spread; beat: Beat; sceneFocal: FocalPoint; ehriPhase: EhriPhase;
  spreadBounds: typeof SPREAD_BOUNDS; opts: BookSpreadRenderOpts;
}> = {}) {
  return {
    spread: over.spread ?? baseSpread(),
    beat: over.beat ?? baseBeat,
    sceneFocal: over.sceneFocal ?? baseFocal,
    ehriPhase: over.ehriPhase ?? basePhase,
    spreadBounds: over.spreadBounds ?? SPREAD_BOUNDS,
    opts: over.opts ?? baseOpts,
  };
}

describe('BookSpreadSurfaceAdapter', () => {
  it('compose returns a composite with the spread index propagated', () => {
    const out = compose(buildInput());
    expect(out.spreadIndex).toBe(0);
  });

  it('emits a focal-point grid obstacle sized to the focal-point bbox', () => {
    const out = compose(buildInput());
    const focal = out.elements.find(el => el.type === 'grid');
    expect(focal).toBeTruthy();
    if (focal && focal.type === 'grid') {
      expect(focal.bounds.x).toBe(baseFocal.x - baseFocal.radius);
      expect(focal.bounds.y).toBe(baseFocal.y - baseFocal.radius);
      expect(focal.bounds.width).toBe(baseFocal.radius * 2);
      expect(focal.bounds.height).toBe(baseFocal.radius * 2);
    }
  });

  it('emits a prose element using Ehri-phase typography', () => {
    const out = compose(buildInput());
    const prose = out.elements.find(el => el.type === 'prose');
    expect(prose).toBeTruthy();
    if (prose && prose.type === 'prose') {
      expect(prose.font).toMatch(/22px|600/);
      expect(prose.maxWidth).toBe(SPREAD_BOUNDS.width);
    }
  });

  it('resolves the spec-default emotional effect for beat.id', () => {
    expect(compose(buildInput({ beat: { id: 'setup' } })).effect).toBe('flow');
    expect(compose(buildInput({ beat: { id: 'catalyst' } })).effect).toBe('bounce-in');
    expect(compose(buildInput({ beat: { id: 'climax' } })).effect).toBe('dragon');
  });

  it('applies an effect override when provided', () => {
    const out = compose({ ...buildInput(), effectOverride: 'vortex' });
    expect(out.effect).toBe('vortex');
  });

  it('honors easierReadingMode by bumping leading on resolved fonts', () => {
    const a = compose(buildInput()).fonts.leading;
    const b = compose(buildInput({ opts: { ...baseOpts, easierReadingMode: true } })).fonts.leading;
    expect(b).toBeGreaterThan(a);
  });

  it('emits dialogic Speech elements when dialogicPromptsEnabled', () => {
    const out = compose(buildInput());
    const speechEls = out.elements.filter(el => el.type === 'speech');
    expect(speechEls).toHaveLength(1);
  });

  it('omits dialogic Speech elements when disabled', () => {
    const out = compose(buildInput({ opts: { ...baseOpts, dialogicPromptsEnabled: false } }));
    const speechEls = out.elements.filter(el => el.type === 'speech');
    expect(speechEls).toHaveLength(0);
  });

  it('tier-2 emphasis runs keyed by the prose element id', () => {
    const out = compose(buildInput());
    const prose = out.elements.find(el => el.type === 'prose');
    expect(prose).toBeTruthy();
    if (prose) {
      expect(out.emphasis[prose.id]).toBeTruthy();
      const emphasized = out.emphasis[prose.id].filter(r => r.emphasis === 'tier2');
      expect(emphasized.length).toBeGreaterThan(0);
    }
  });

  it('honors tier2EmphasisCap override', () => {
    const opts: BookSpreadRenderOpts = { ...baseOpts, tier2EmphasisCap: 0 };
    const out = compose(buildInput({ opts }));
    const proseId = out.elements.find(el => el.type === 'prose')?.id ?? '';
    const emphasized = out.emphasis[proseId].filter(r => r.emphasis === 'tier2');
    expect(emphasized).toHaveLength(0);
  });

  it('does NOT mutate the input focal point', () => {
    const focal = { ...baseFocal };
    const out = compose(buildInput({ sceneFocal: focal }));
    expect(focal).toEqual(baseFocal);
    out.focalPointFromScene.x = 9999;
    expect(focal.x).toBe(baseFocal.x);
  });

  it('all elements carry surface="book-spread"', () => {
    const out = compose(buildInput());
    for (const el of out.elements) {
      expect(el.surface).toBe('book-spread');
    }
  });

  it('class form composite() behaves identically to compose()', () => {
    const adapter = new BookSpreadSurfaceAdapter();
    const a = adapter.composite(buildInput());
    const b = compose(buildInput());
    expect(a.effect).toBe(b.effect);
    expect(a.elements.length).toBe(b.elements.length);
  });

  it('focal-point obstacle bounds do not overlap prose origin', () => {
    const out = compose(buildInput({
      sceneFocal: { x: 600, y: 300, radius: 50 },
    }));
    const focal = out.elements.find(el => el.type === 'grid');
    const prose = out.elements.find(el => el.type === 'prose');
    if (focal && focal.type === 'grid' && prose && prose.type === 'prose') {
      const focalRight = focal.bounds.x + focal.bounds.width;
      const focalBottom = focal.bounds.y + focal.bounds.height;
      const proseOriginInsideFocal =
        prose.origin.x >= focal.bounds.x && prose.origin.x <= focalRight &&
        prose.origin.y >= focal.bounds.y && prose.origin.y <= focalBottom;
      expect(proseOriginInsideFocal).toBe(false);
    }
  });
});
