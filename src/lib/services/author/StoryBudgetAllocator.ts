// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/StoryBudgetAllocator.ts
//
// Distribute `targetSpreads` across 7 Pixar beats per the default weight map
// (DEFAULT_BEAT_WEIGHTS = 12/6/12/22/18/18/12). Round to whole spreads, keep
// sum exact, and guarantee no beat gets 0 spreads (every beat must show up
// in the book or Stein-Glenn 1979 grammar can't pin to a beat).
//
// Pure functions. No kernel deps.

import {
  type Beat,
  type BeatId,
  type BeatBudgetMap,
  DEFAULT_BEAT_WEIGHTS,
} from './types';

export interface AllocatorOptions {
  /** Override default Pixar weights for tests. */
  weights?: BeatBudgetMap;
}

/**
 * Distribute `targetSpreads` across the 7 beats using `weights` (must sum to 100).
 *
 * Algorithm (largest-remainder method aka Hamilton's method, adapted):
 *   1. compute floor(targetSpreads * weight/100) per beat
 *   2. if any beat is 0, give it 1 (rob largest-remainder pool, repeat until none zero)
 *   3. distribute remainder spreads to beats with largest fractional parts
 *
 * Postcondition: sum(allocated) === targetSpreads AND every beat >= 1.
 *
 * Minimum supportable `targetSpreads` is 7 (one per beat). Below that we
 * still return a valid map (every beat >= 1) but the sum will exceed input
 * — caller must reject sub-7 inputs upstream.
 */
export class StoryBudgetAllocator {
  allocate(targetSpreads: number, opts: AllocatorOptions = {}): BeatBudgetMap {
    if (!Number.isInteger(targetSpreads) || targetSpreads < 7) {
      // Below the floor: return min viable (1 per beat). Caller rejects upstream.
      return { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 };
    }

    const weights = opts.weights ?? DEFAULT_BEAT_WEIGHTS;
    const weightSum = sumValues(weights);
    if (weightSum <= 0) throw new Error('weights must sum > 0');

    // Step 1: fractional per-beat quotas + integer floor
    const beatIds: BeatId[] = [1, 2, 3, 4, 5, 6, 7];
    const quotas = beatIds.map((id) => ({
      id,
      raw: (targetSpreads * weights[id]) / weightSum,
    }));
    const floors: BeatBudgetMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    const remainders: { id: BeatId; frac: number }[] = [];
    for (const q of quotas) {
      const f = Math.floor(q.raw);
      floors[q.id] = f;
      remainders.push({ id: q.id, frac: q.raw - f });
    }

    // Step 2: lift any zero beats to 1 by stealing from the highest non-zero
    // (we need every beat to have ≥1 spread).
    const ensureMinOne = (): void => {
      // sort beats by current allocation descending
      const orderDesc = (): BeatId[] =>
        beatIds.slice().sort((a, b) => floors[b] - floors[a]);
      for (const beat of beatIds) {
        if (floors[beat] === 0) {
          const donor = orderDesc().find((b) => b !== beat && floors[b] > 1);
          if (!donor) break; // shouldn't happen above floor of 7
          floors[donor] -= 1;
          floors[beat] = 1;
        }
      }
    };
    ensureMinOne();

    // Step 3: distribute leftover (targetSpreads - sum(floors)) by largest-remainder
    let placed = sumMap(floors);
    let leftover = targetSpreads - placed;
    if (leftover > 0) {
      const sortedRem = remainders.slice().sort((a, b) => {
        if (b.frac !== a.frac) return b.frac - a.frac;
        // stable secondary: lower id first (setup grows before catalyst in a tie)
        return a.id - b.id;
      });
      let i = 0;
      while (leftover > 0) {
        floors[sortedRem[i % sortedRem.length].id] += 1;
        leftover--;
        i++;
      }
    } else if (leftover < 0) {
      // floor over-allocated due to ensureMinOne robbing — shave from largest beats
      // that exceed their fair share, in descending order
      let toShave = -leftover;
      while (toShave > 0) {
        const orderDesc = beatIds
          .slice()
          .sort((a, b) => floors[b] - floors[a]);
        const target = orderDesc.find((b) => floors[b] > 1);
        if (!target) break;
        floors[target] -= 1;
        toShave--;
      }
    }

    // Step 4: final min-one sweep — leftover distribution may have skipped
    // zero beats. Rob from the largest non-zero (now >1 after leftover added).
    ensureMinOne();

    return floors;
  }

  /**
   * Validate that an LLM-generated beat array sums to the original `targetSpreads`
   * and every beat has ≥1 scene with ≥1 spread.
   */
  validate(beats: Beat[], targetSpreads: number): {
    passed: boolean;
    sum: number;
    perBeat: BeatBudgetMap;
    issues: string[];
  } {
    const issues: string[] = [];
    const perBeat: BeatBudgetMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    const seenIds = new Set<BeatId>();
    let totalSpreads = 0;

    if (beats.length !== 7) issues.push(`expected 7 beats, got ${beats.length}`);

    for (const b of beats) {
      if (seenIds.has(b.id)) issues.push(`duplicate beat id ${b.id}`);
      seenIds.add(b.id);
      if (b.id < 1 || b.id > 7) issues.push(`beat id ${b.id} out of range 1..7`);
      if (!b.scenes || b.scenes.length === 0)
        issues.push(`beat ${b.id} has no scenes`);
      let beatSpreads = 0;
      for (const s of b.scenes ?? []) {
        if (!s.spreads || s.spreads.length === 0)
          issues.push(`beat ${b.id} scene ${s.sceneId} has no spreads`);
        if (s.spreads.length !== s.spreadCount)
          issues.push(
            `beat ${b.id} scene ${s.sceneId} spreadCount=${s.spreadCount} but spreads.length=${s.spreads.length}`,
          );
        beatSpreads += s.spreads.length;
      }
      if (beatSpreads === 0) issues.push(`beat ${b.id} has 0 total spreads`);
      perBeat[b.id as BeatId] = beatSpreads;
      totalSpreads += beatSpreads;
    }

    if (totalSpreads !== targetSpreads)
      issues.push(`total spreads ${totalSpreads} ≠ target ${targetSpreads}`);

    return { passed: issues.length === 0, sum: totalSpreads, perBeat, issues };
  }

  /**
   * Deterministic redistribution: given current per-beat spread counts (from
   * an LLM mismatch) + target, rebalance to match `targetSpreads` while
   * preserving the LLM's intent as much as possible (proportional shave-or-grow).
   */
  redistribute(
    currentPerBeat: BeatBudgetMap,
    targetSpreads: number,
  ): BeatBudgetMap {
    const beatIds: BeatId[] = [1, 2, 3, 4, 5, 6, 7];
    const currentSum = sumMap(currentPerBeat);
    if (currentSum === targetSpreads) return { ...currentPerBeat };

    // Use current allocation as weights (so LLM's emphasis is preserved),
    // fall back to defaults if any beat is 0 (the allocator already gates min-1).
    const weightsAsBudget: BeatBudgetMap = {
      1: Math.max(currentPerBeat[1], 1),
      2: Math.max(currentPerBeat[2], 1),
      3: Math.max(currentPerBeat[3], 1),
      4: Math.max(currentPerBeat[4], 1),
      5: Math.max(currentPerBeat[5], 1),
      6: Math.max(currentPerBeat[6], 1),
      7: Math.max(currentPerBeat[7], 1),
    };
    void beatIds;
    return this.allocate(targetSpreads, { weights: weightsAsBudget });
  }
}

function sumValues(m: BeatBudgetMap): number {
  return (m[1] ?? 0) + (m[2] ?? 0) + (m[3] ?? 0) + (m[4] ?? 0) + (m[5] ?? 0) + (m[6] ?? 0) + (m[7] ?? 0);
}
function sumMap(m: BeatBudgetMap): number {
  return sumValues(m);
}

export const storyBudgetAllocator = new StoryBudgetAllocator();
