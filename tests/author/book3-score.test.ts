// tests/author/book3-score.test.ts
// One-shot runner: scores docs/samples/book3-story.json
import { describe, it, expect } from 'vitest';
import { scoreSceneTree } from '$lib/services/author/StoryQualityScorer';
import { StoryGrammarValidator } from '$lib/services/author/StoryGrammarValidator';
import type { SceneTree } from '$lib/services/author/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tree: SceneTree = JSON.parse(
  readFileSync(resolve(__dirname, '../../docs/samples/book3-story.json'), 'utf8')
);

const validator = new StoryGrammarValidator();

describe('book3 story quality', () => {
  it('grammar gate passes', () => {
    const result = validator.validate(tree);
    console.log('\nGRAMMAR RESULT:', JSON.stringify(result, null, 2));
    expect(result.missing.length).toBe(0);
    expect(result.avgScore).toBeGreaterThanOrEqual(0.6);
  });

  it('quality score >= 65', () => {
    const report = scoreSceneTree(tree, { ageBand: 'grade-school', theme: 'curiosity' });
    console.log('\nQUALITY REPORT:', JSON.stringify(report, null, 2));
    expect(report.total).toBeGreaterThanOrEqual(65);
  });

  it('has 7 beats', () => {
    expect(tree.beats).toHaveLength(7);
  });

  it('total spreads == 24', () => {
    const total = tree.beats.reduce((a, b) =>
      a + b.scenes.reduce((x, s) => x + s.spreads.length, 0), 0);
    console.log('\nTOTAL SPREADS:', total);
    expect(total).toBe(24);
  });

  it('not template fallback', () => {
    expect(tree.meta?.template_fallback).toBe(false);
  });
});
