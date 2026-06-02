// @graph-layer: private
// @rationale: deterministic local UI orchestration; no remote effects

// src/routes/dashboard/storybook-workshop/advanced/AdvancedModeOrchestrator.ts
//
// Pure-function helpers that the workshop wizard (goal #6 ui-shell) consumes
// to interleave Advanced-mode stations (1.5 / 3.5 / 5.5) into the base
// 7-station flow when the advanced-mode toggle is on.
//
// Goal: docs/superpowers/goals/2026-05-24-storybook-workshop-advanced-mode.md
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §7.6

import type { StationId, StationFlow } from './types';

/** Canonical standard-mode 7-station ordering. */
export const STANDARD_FLOW: StationId[] = [
  's1', 's2', 's3', 's4', 's5', 's6', 's7',
];

/** Advanced-mode 10-station ordering (S1.5 after S1, S3.5 after S3, S5.5 after S5). */
export const ADVANCED_FLOW: StationId[] = [
  's1', 's1.5', 's2', 's3', 's3.5', 's4', 's5', 's5.5', 's6', 's7',
];

/**
 * Expand a base flow with the 3 advanced stations.
 *
 * - Standard mode (`advancedEnabled === false`) returns the 7 base stations.
 * - Advanced mode (`advancedEnabled === true`) interleaves:
 *     s1.5 after s1 (Pedagogy Override)
 *     s3.5 after s3 (Wish Engineering)
 *     s5.5 after s5 (Render Direction)
 *
 * Idempotent: callers may pass either STANDARD_FLOW or an already-expanded
 * ADVANCED_FLOW; the function dedupes 1.5/3.5/5.5 entries.
 */
export function expandStationFlow(
  base: StationId[],
  advancedEnabled: boolean
): StationFlow {
  const stripped = base.filter((s) => s !== 's1.5' && s !== 's3.5' && s !== 's5.5');

  if (!advancedEnabled) {
    return { stations: [...stripped], totalSteps: stripped.length };
  }

  const stations: StationId[] = [];
  for (const s of stripped) {
    stations.push(s);
    if (s === 's1') stations.push('s1.5');
    else if (s === 's3') stations.push('s3.5');
    else if (s === 's5') stations.push('s5.5');
  }
  return { stations, totalSteps: stations.length };
}

/**
 * Resolve the next station in the flow after the current one, accounting for
 * advanced-mode insertions. Returns null at the end of the flow.
 */
export function nextStation(
  flow: StationFlow,
  current: StationId
): StationId | null {
  const idx = flow.stations.indexOf(current);
  if (idx < 0 || idx >= flow.stations.length - 1) return null;
  return flow.stations[idx + 1];
}

/**
 * Resolve the previous station in the flow. Returns null at the start.
 */
export function prevStation(
  flow: StationFlow,
  current: StationId
): StationId | null {
  const idx = flow.stations.indexOf(current);
  if (idx <= 0) return null;
  return flow.stations[idx - 1];
}

/**
 * Progress as a fraction in [0, 1]. Used by the header dots / progress bar.
 */
export function flowProgress(flow: StationFlow, current: StationId): number {
  const idx = flow.stations.indexOf(current);
  if (idx < 0) return 0;
  if (flow.totalSteps <= 1) return 1;
  return idx / (flow.totalSteps - 1);
}

/**
 * Returns true when the given station is an advanced-only station (1.5/3.5/5.5).
 */
export function isAdvancedStation(s: StationId): boolean {
  return s === 's1.5' || s === 's3.5' || s === 's5.5';
}
