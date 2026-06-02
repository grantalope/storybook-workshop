/**
 * Advanced Mode Orchestration — 7 vs 10 station flow.
 *
 * Goal Phase 1 / Phase 9 #16.
 */

import { describe, it, expect } from 'vitest';
import {
  STANDARD_FLOW,
  ADVANCED_FLOW,
  expandStationFlow,
  nextStation,
  prevStation,
  flowProgress,
  isAdvancedStation,
} from '$lib/workshop/advanced/AdvancedModeOrchestrator';

describe('expandStationFlow', () => {
  it('returns the 7 standard stations when advanced is off', () => {
    const flow = expandStationFlow(STANDARD_FLOW, false);
    expect(flow.totalSteps).toBe(7);
    expect(flow.stations).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
  });

  it('returns the 10 advanced stations when advanced is on', () => {
    const flow = expandStationFlow(STANDARD_FLOW, true);
    expect(flow.totalSteps).toBe(10);
    expect(flow.stations).toEqual([
      's1', 's1.5', 's2', 's3', 's3.5', 's4', 's5', 's5.5', 's6', 's7',
    ]);
  });

  it('interleaves s1.5 immediately after s1', () => {
    const flow = expandStationFlow(STANDARD_FLOW, true);
    const i1 = flow.stations.indexOf('s1');
    const i15 = flow.stations.indexOf('s1.5');
    expect(i15).toBe(i1 + 1);
  });

  it('interleaves s3.5 immediately after s3', () => {
    const flow = expandStationFlow(STANDARD_FLOW, true);
    const i3 = flow.stations.indexOf('s3');
    const i35 = flow.stations.indexOf('s3.5');
    expect(i35).toBe(i3 + 1);
  });

  it('interleaves s5.5 immediately after s5', () => {
    const flow = expandStationFlow(STANDARD_FLOW, true);
    const i5 = flow.stations.indexOf('s5');
    const i55 = flow.stations.indexOf('s5.5');
    expect(i55).toBe(i5 + 1);
  });

  it('is idempotent when called on an already-expanded flow', () => {
    const once = expandStationFlow(STANDARD_FLOW, true);
    const twice = expandStationFlow(once.stations, true);
    expect(twice.stations).toEqual(once.stations);
  });

  it('strips advanced stations when toggling off after on', () => {
    const adv = expandStationFlow(STANDARD_FLOW, true);
    const back = expandStationFlow(adv.stations, false);
    expect(back.stations).toEqual(STANDARD_FLOW);
  });

  it('exports the ADVANCED_FLOW constant matching the expanded form', () => {
    expect(ADVANCED_FLOW).toEqual(expandStationFlow(STANDARD_FLOW, true).stations);
  });
});

describe('nextStation / prevStation', () => {
  it('walks forward through the advanced flow', () => {
    const flow = expandStationFlow(STANDARD_FLOW, true);
    expect(nextStation(flow, 's1')).toBe('s1.5');
    expect(nextStation(flow, 's1.5')).toBe('s2');
    expect(nextStation(flow, 's3')).toBe('s3.5');
    expect(nextStation(flow, 's5')).toBe('s5.5');
    expect(nextStation(flow, 's5.5')).toBe('s6');
  });

  it('walks backward through the advanced flow', () => {
    const flow = expandStationFlow(STANDARD_FLOW, true);
    expect(prevStation(flow, 's2')).toBe('s1.5');
    expect(prevStation(flow, 's1.5')).toBe('s1');
    expect(prevStation(flow, 's4')).toBe('s3.5');
    expect(prevStation(flow, 's6')).toBe('s5.5');
  });

  it('returns null at the bounds', () => {
    const flow = expandStationFlow(STANDARD_FLOW, true);
    expect(prevStation(flow, 's1')).toBeNull();
    expect(nextStation(flow, 's7')).toBeNull();
  });
});

describe('flowProgress', () => {
  it('is 0 at the first station', () => {
    const flow = expandStationFlow(STANDARD_FLOW, false);
    expect(flowProgress(flow, 's1')).toBe(0);
  });

  it('is 1 at the last station', () => {
    const flow = expandStationFlow(STANDARD_FLOW, false);
    expect(flowProgress(flow, 's7')).toBe(1);
  });

  it('is a sensible fraction mid-flow', () => {
    const flow = expandStationFlow(STANDARD_FLOW, true);
    // s5 is index 6 of 10 — fraction = 6/9
    expect(flowProgress(flow, 's5')).toBeCloseTo(6 / 9, 5);
  });
});

describe('isAdvancedStation', () => {
  it('flags 1.5/3.5/5.5 as advanced', () => {
    expect(isAdvancedStation('s1.5')).toBe(true);
    expect(isAdvancedStation('s3.5')).toBe(true);
    expect(isAdvancedStation('s5.5')).toBe(true);
  });

  it('rejects all base stations', () => {
    for (const s of ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const) {
      expect(isAdvancedStation(s)).toBe(false);
    }
  });
});
