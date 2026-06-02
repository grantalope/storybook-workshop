// tests/storybook-workshop/author/story-budget-allocator.test.ts
//
// Exercises the Pixar-7-beat budget distribution + structural validator.

import { describe, expect, it } from 'vitest';

import {
  StoryBudgetAllocator,
  storyBudgetAllocator,
} from '$lib/services/author/StoryBudgetAllocator';
import {
  DEFAULT_BEAT_WEIGHTS,
  type Beat,
  type BeatId,
} from '$lib/services/author/types';

function totalSpreads(budget: Record<BeatId, number>): number {
  return ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).reduce((s, k) => s + budget[k], 0);
}

describe('StoryBudgetAllocator.allocate', () => {
  it('distributes 24 spreads with no beat receiving zero', () => {
    const out = storyBudgetAllocator.allocate(24);
    expect(totalSpreads(out)).toBe(24);
    for (const id of [1, 2, 3, 4, 5, 6, 7] as BeatId[]) expect(out[id]).toBeGreaterThanOrEqual(1);
  });

  it('distributes 16 spreads exactly', () => {
    const out = storyBudgetAllocator.allocate(16);
    expect(totalSpreads(out)).toBe(16);
    for (const id of [1, 2, 3, 4, 5, 6, 7] as BeatId[]) expect(out[id]).toBeGreaterThanOrEqual(1);
  });

  it('distributes 32 spreads exactly', () => {
    const out = storyBudgetAllocator.allocate(32);
    expect(totalSpreads(out)).toBe(32);
  });

  it('distributes 48 spreads exactly', () => {
    const out = storyBudgetAllocator.allocate(48);
    expect(totalSpreads(out)).toBe(48);
  });

  it('respects default Pixar weights (midpoint > setup)', () => {
    const out = storyBudgetAllocator.allocate(32);
    expect(out[4]).toBeGreaterThan(out[1]); // midpoint 22% > setup 12%
    expect(out[5]).toBeGreaterThan(out[2]); // trial 18%   > catalyst 6%
    expect(out[6]).toBeGreaterThan(out[7]); // climax 18%  > resolution 12%
  });

  it('handles minimum 7-spread input with 1 per beat', () => {
    const out = storyBudgetAllocator.allocate(7);
    expect(totalSpreads(out)).toBe(7);
    for (const id of [1, 2, 3, 4, 5, 6, 7] as BeatId[]) expect(out[id]).toBe(1);
  });

  it('produces a viable map for sub-7 inputs (rejected upstream)', () => {
    const out = storyBudgetAllocator.allocate(4);
    // Below-floor returns 1-per-beat (sum=7), caller must reject.
    expect(totalSpreads(out)).toBe(7);
    for (const id of [1, 2, 3, 4, 5, 6, 7] as BeatId[]) expect(out[id]).toBe(1);
  });

  it('accepts weight override', () => {
    const allocator = new StoryBudgetAllocator();
    const out = allocator.allocate(20, {
      weights: { 1: 50, 2: 5, 3: 5, 4: 30, 5: 4, 6: 3, 7: 3 },
    });
    expect(totalSpreads(out)).toBe(20);
    expect(out[1]).toBeGreaterThan(out[4]); // 50% > 30%
  });
});

describe('StoryBudgetAllocator.validate', () => {
  function makeBeats(perBeat: number[]): Beat[] {
    return perBeat.map((spreadCount, idx) => ({
      id: (idx + 1) as BeatId,
      beat_name:
        ['setup', 'catalyst', 'debate', 'midpoint', 'trial', 'climax', 'resolution'][idx] as Beat['beat_name'],
      emotional_arc: 'arc',
      scenes: [
        {
          sceneId: `scene-${idx + 1}`,
          spreadCount: spreadCount as 1 | 2 | 3 | 4 | 5,
          sceneBrief: 'brief',
          spreads: Array.from({ length: spreadCount }).map((_, s) => ({
            spreadIndex: s,
            spread_text: 'text',
            text_focus: 'left' as const,
          })),
        },
      ],
    }));
  }

  it('passes a well-formed beats[] matching target', () => {
    const beats = makeBeats([3, 2, 3, 5, 4, 4, 3]); // sum 24
    const r = storyBudgetAllocator.validate(beats, 24);
    expect(r.passed).toBe(true);
    expect(r.sum).toBe(24);
  });

  it('flags wrong total', () => {
    const beats = makeBeats([3, 2, 3, 5, 4, 4, 4]); // sum 25 not 24
    const r = storyBudgetAllocator.validate(beats, 24);
    expect(r.passed).toBe(false);
    expect(r.issues.some((s) => s.includes('total spreads'))).toBe(true);
  });

  it('flags a beat with 0 spreads', () => {
    const beats = makeBeats([3, 0, 3, 5, 4, 4, 5]);
    const r = storyBudgetAllocator.validate(beats, 24);
    expect(r.passed).toBe(false);
    expect(r.issues.some((s) => s.includes('beat 2'))).toBe(true);
  });

  it('flags spreadCount mismatch', () => {
    const beats = makeBeats([3, 2, 3, 5, 4, 4, 3]);
    beats[0].scenes[0].spreadCount = 2; // declared 2 but spreads.length=3
    const r = storyBudgetAllocator.validate(beats, 24);
    expect(r.passed).toBe(false);
    expect(r.issues.some((s) => s.includes('spreadCount'))).toBe(true);
  });
});

describe('StoryBudgetAllocator.redistribute', () => {
  it('rebalances to target while keeping LLM emphasis', () => {
    const current = { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5 }; // sum 35
    const out = storyBudgetAllocator.redistribute(current, 24);
    expect(totalSpreads(out)).toBe(24);
    for (const id of [1, 2, 3, 4, 5, 6, 7] as BeatId[]) expect(out[id]).toBeGreaterThanOrEqual(1);
  });

  it('no-ops when already at target', () => {
    const current = storyBudgetAllocator.allocate(24);
    const out = storyBudgetAllocator.redistribute(current, 24);
    expect(out).toEqual(current);
  });

  it('grows total when under target', () => {
    const current = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 }; // sum 7
    const out = storyBudgetAllocator.redistribute(current, 24);
    expect(totalSpreads(out)).toBe(24);
  });
});

describe('DEFAULT_BEAT_WEIGHTS', () => {
  it('sums to 100', () => {
    const s = (Object.values(DEFAULT_BEAT_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);
    expect(s).toBe(100);
  });
});
