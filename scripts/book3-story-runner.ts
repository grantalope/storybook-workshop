// scripts/book3-story-runner.ts
// Usage: npx tsx scripts/book3-story-runner.ts
// Validates docs/samples/book3-story.json with StoryQualityScorer + StoryGrammarValidator
// and prints a summary report.

import { scoreSceneTree } from '../src/lib/services/author/StoryQualityScorer';
import { StoryGrammarValidator } from '../src/lib/services/author/StoryGrammarValidator';
import type { SceneTree } from '../src/lib/services/author/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tree: SceneTree = JSON.parse(
  readFileSync(resolve(import.meta.dirname!, '../docs/samples/book3-story.json'), 'utf8')
);

const validator = new StoryGrammarValidator();
const grammarResult = validator.validate(tree);
const qualityReport = scoreSceneTree(tree, { ageBand: 'grade-school', theme: 'curiosity' });

const totalSpreads = tree.beats.reduce(
  (a, b) => a + b.scenes.reduce((x, s) => x + s.spreads.length, 0),
  0
);

console.log('\n=== BOOK 3: WHY DO STARS BLINK? ===\n');
console.log(`Title:          ${tree.title}`);
console.log(`Beats:          ${tree.beats.length}`);
console.log(`Total spreads:  ${totalSpreads}`);
console.log(`Template fallback: ${tree.meta?.template_fallback ?? false}`);
console.log(`Generated:      ${tree.meta?.generated_at_iso}`);
console.log('\n--- GRAMMAR GATE ---');
console.log(`Passed:         ${grammarResult.passed}`);
console.log(`Missing:        ${grammarResult.missing.length === 0 ? 'none' : grammarResult.missing.join(', ')}`);
console.log(`Avg score:      ${grammarResult.avgScore.toFixed(2)}`);
console.log('Element scores:');
for (const [el, sc] of Object.entries(grammarResult.elementScores)) {
  console.log(`  ${el.padEnd(20)} ${sc.toFixed(2)}`);
}
console.log('\n--- QUALITY SCORER ---');
console.log(`Total score:    ${qualityReport.total}/100`);
console.log(`Refrain:        "${qualityReport.refrain?.line}" (×${qualityReport.refrain?.count})`);
console.log(`Emotion labels: ${qualityReport.emotionLabelCount}`);
console.log('Metrics:');
for (const [k, v] of Object.entries(qualityReport.metrics)) {
  console.log(`  ${k.padEnd(25)} ${(v as number).toFixed(2)}`);
}
if (qualityReport.feedback.length) {
  console.log('\nFeedback:');
  for (const fb of qualityReport.feedback) {
    console.log(`  • ${fb.slice(0, 120)}`);
  }
}

console.log('\n=== DONE ===\n');
