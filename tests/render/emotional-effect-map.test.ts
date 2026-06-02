import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EFFECT_MAP,
  CLIMAX_ALT,
  getDefaultEffect,
  overrideEffect,
  resolveEffectMap,
} from '$lib/services/render/EmotionalEffectMap';
import { BEAT_IDS } from '$lib/services/render/types';

describe('EmotionalEffectMap', () => {
  it('exposes a default for every Pixar beat', () => {
    for (const id of BEAT_IDS) {
      expect(DEFAULT_EFFECT_MAP[id]).toBeTruthy();
    }
  });

  it('uses spec §7.5 mapping: setup → flow', () => {
    expect(getDefaultEffect('setup')).toBe('flow');
  });

  it('uses spec §7.5 mapping: catalyst → bounce-in (engine literal of "bounce")', () => {
    expect(getDefaultEffect('catalyst')).toBe('bounce-in');
  });

  it('uses spec §7.5 mapping: debate → wave', () => {
    expect(getDefaultEffect('debate')).toBe('wave');
  });

  it('uses spec §7.5 mapping: midpoint → magnetic', () => {
    expect(getDefaultEffect('midpoint')).toBe('magnetic');
  });

  it('uses spec §7.5 mapping: trial → glitch', () => {
    expect(getDefaultEffect('trial')).toBe('glitch');
  });

  it('uses spec §7.5 mapping: climax → dragon (alt: vortex documented)', () => {
    expect(getDefaultEffect('climax')).toBe('dragon');
    expect(CLIMAX_ALT).toBe('vortex');
  });

  it('uses spec §7.5 mapping: resolution → rise', () => {
    expect(getDefaultEffect('resolution')).toBe('rise');
  });

  it('throws on unknown beat id rather than silently defaulting', () => {
    expect(() => getDefaultEffect('not-a-beat' as never)).toThrow(/unknown beatId/);
  });

  it('default map is frozen', () => {
    expect(Object.isFrozen(DEFAULT_EFFECT_MAP)).toBe(true);
  });

  it('overrideEffect returns 7-beat array in BEAT_IDS order when override is empty', () => {
    const arr = overrideEffect();
    expect(arr).toHaveLength(7);
    for (let i = 0; i < BEAT_IDS.length; i += 1) {
      expect(arr[i]).toBe(DEFAULT_EFFECT_MAP[BEAT_IDS[i]]);
    }
  });

  it('overrideEffect applies explicit overrides and falls back per-beat', () => {
    const arr = overrideEffect({ climax: 'vortex', setup: 'rise' });
    expect(arr[BEAT_IDS.indexOf('climax')]).toBe('vortex');
    expect(arr[BEAT_IDS.indexOf('setup')]).toBe('rise');
    expect(arr[BEAT_IDS.indexOf('debate')]).toBe('wave');
  });

  it('resolveEffectMap returns by-key dictionary with overrides applied', () => {
    const map = resolveEffectMap({ trial: 'scatter' });
    expect(map.trial).toBe('scatter');
    expect(map.setup).toBe('flow');
    expect(Object.keys(map).sort()).toEqual([...BEAT_IDS].sort());
  });

  it('resolveEffectMap returns a fresh object each call (callers may mutate)', () => {
    const a = resolveEffectMap();
    const b = resolveEffectMap();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
