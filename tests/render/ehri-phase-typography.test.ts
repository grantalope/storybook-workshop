import { describe, it, expect } from 'vitest';
import {
  EHRI_PHASE_DEFAULTS,
  applyEasierReadingMode,
  getEhriTypography,
  toCssFontShorthand,
} from '$lib/services/render/EhriPhaseTypography';
import type { EhriPhase } from '$lib/services/render/types';

const PHASES: EhriPhase[] = [
  'pre-alphabetic',
  'partial-alphabetic',
  'full-alphabetic',
  'consolidated-alphabetic',
];

describe('EhriPhaseTypography', () => {
  it('exposes a default config for every Ehri phase', () => {
    for (const phase of PHASES) {
      expect(EHRI_PHASE_DEFAULTS[phase]).toBeTruthy();
      expect(EHRI_PHASE_DEFAULTS[phase].phase).toBe(phase);
    }
  });

  it('pre-alphabetic ships chunky 28pt sans-serif at generous tracking', () => {
    const cfg = EHRI_PHASE_DEFAULTS['pre-alphabetic'];
    expect(cfg.sizePx).toBe(28);
    expect(cfg.weight).toBe(700);
    expect(cfg.kerningEm).toBeGreaterThan(0);
    expect(cfg.fontFamily).toMatch(/Atkinson|Lexend|sans-serif/i);
  });

  it('size monotonically shrinks from pre- to consolidated-alphabetic', () => {
    const sizes = PHASES.map(p => EHRI_PHASE_DEFAULTS[p].sizePx);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    }
  });

  it('max-line-length monotonically grows with phase', () => {
    const lens = PHASES.map(p => EHRI_PHASE_DEFAULTS[p].maxLineLengthChars);
    for (let i = 1; i < lens.length; i += 1) {
      expect(lens[i]).toBeGreaterThan(lens[i - 1]);
    }
  });

  it('easier-reading mode bumps leading +20%', () => {
    const base = EHRI_PHASE_DEFAULTS['full-alphabetic'];
    const easier = applyEasierReadingMode(base);
    expect(easier.leading).toBeCloseTo(base.leading * 1.2, 3);
  });

  it('easier-reading mode shrinks max line length by 15%', () => {
    const base = EHRI_PHASE_DEFAULTS['consolidated-alphabetic'];
    const easier = applyEasierReadingMode(base);
    expect(easier.maxLineLengthChars).toBe(Math.round(base.maxLineLengthChars * 0.85));
  });

  it('easier-reading mode forces a sans-serif when default is serif (consolidated)', () => {
    const base = EHRI_PHASE_DEFAULTS['consolidated-alphabetic'];
    expect(base.fontFamily).toMatch(/serif/i);
    const easier = applyEasierReadingMode(base);
    expect(easier.fontFamily).toMatch(/sans-serif/i);
  });

  it('easier-reading mode is non-mutating', () => {
    const base = EHRI_PHASE_DEFAULTS['full-alphabetic'];
    const baseCopy = { ...base };
    applyEasierReadingMode(base);
    expect(base).toEqual(baseCopy);
  });

  it('getEhriTypography returns the easier-reading variant when flag is set', () => {
    const cfg = getEhriTypography('full-alphabetic', { easierReadingMode: true });
    const baseLeading = EHRI_PHASE_DEFAULTS['full-alphabetic'].leading;
    expect(cfg.leading).toBeCloseTo(baseLeading * 1.2, 3);
  });

  it('getEhriTypography returns a copy (mutation-safe)', () => {
    const a = getEhriTypography('partial-alphabetic');
    const b = getEhriTypography('partial-alphabetic');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('getEhriTypography throws on unknown phase', () => {
    expect(() => getEhriTypography('toddler' as never)).toThrow(/unknown phase/);
  });

  it('toCssFontShorthand emits the canonical CSS string', () => {
    const cfg = getEhriTypography('pre-alphabetic');
    const css = toCssFontShorthand(cfg);
    expect(css).toMatch(/^700 28px /);
  });
});
