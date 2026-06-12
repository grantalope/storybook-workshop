// tests/goldens/golden-story-quality.test.ts
//
// G5-story-quality acceptance gate — 3 committed golden SceneTrees scored
// against StoryQualityScorer thresholds.
//
// Invariants per gate spec:
//   hook coverage >= 0.8 (strong page-turn hooks)
//   refrainScore > 0 (refrain present with climax mutation)
//   sentenceLengthFit >= 0.9 (age-band sentence stats within band)
//   total >= DEFAULT_QUALITY_THRESHOLD (grammar gate pass at 70/100)
//
// The goldens are the three hand-written template families that ship as the
// LLM fallback path. They represent the FLOOR of acceptable story quality —
// any regression that drops them below threshold is a user-visible quality bug.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scoreSceneTree, DEFAULT_QUALITY_THRESHOLD } from '$lib/services/author/StoryQualityScorer';
import { synthesizeTemplateTree, templateFamilyForTheme } from '$lib/services/author/templateFallback';
import { storyBudgetAllocator } from '$lib/services/author/StoryBudgetAllocator';
import type { AgeBand, SceneTree, StoryInput, StoryTheme } from '$lib/services/author/types';

function baseInput(theme: StoryTheme, ageBand: AgeBand = 'preschool'): StoryInput {
  return {
    kidName: 'Golden',
    ageBand,
    ehriPhase: 'partial-alphabetic',
    theme,
    occasion: 'just-because',
    sidekickSettlerId: 'sidekick-golden',
    supportingCast: [],
    localeBiome: 'forest',
    targetSpreads: 16,
    dedicationText: '',
    dialogicPromptsEnabled: false,
    easierReadingMode: false,
  };
}

const GOLDEN_CONFIGS: Array<{ family: string; theme: StoryTheme; ageBand: AgeBand }> = [
  { family: 'gentle-glow', theme: 'bedtime',        ageBand: 'preschool' },
  { family: 'brave-step',  theme: 'overcoming-fear', ageBand: 'grade-school' },
  { family: 'giggle-quest',theme: 'silly-quest',    ageBand: 'toddler' },
];

describe('G5-story-quality: golden SceneTrees clear the quality bar', () => {
  for (const { family, theme, ageBand } of GOLDEN_CONFIGS) {
    const input = baseInput(theme, ageBand);
    const budget = storyBudgetAllocator.allocate(16);
    const tree: SceneTree = synthesizeTemplateTree(input, ['brave', 'tremble'], budget);
    const report = scoreSceneTree(tree, { ageBand, theme });

    it(`${family} (${ageBand}): total score >= ${DEFAULT_QUALITY_THRESHOLD}`, () => {
      expect(
        report.total,
        `${family} scored ${report.total}/100 — metrics: ${JSON.stringify(report.metrics)}`
      ).toBeGreaterThanOrEqual(DEFAULT_QUALITY_THRESHOLD);
    });

    it(`${family} (${ageBand}): pageTurnHookCoverage >= 0.8`, () => {
      expect(
        report.metrics.pageTurnHookCoverage,
        `hook coverage ${report.metrics.pageTurnHookCoverage}`
      ).toBeGreaterThanOrEqual(0.8);
    });

    it(`${family} (${ageBand}): refrain present (refrainScore > 0)`, () => {
      expect(
        report.metrics.refrainScore,
        `refrainScore ${report.metrics.refrainScore}`
      ).toBeGreaterThan(0);
    });

    it(`${family} (${ageBand}): sentenceLengthFit >= 0.9`, () => {
      expect(
        report.metrics.sentenceLengthFit,
        `sentenceLengthFit ${report.metrics.sentenceLengthFit}`
      ).toBeGreaterThanOrEqual(0.9);
    });
  }
});
