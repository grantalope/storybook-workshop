// @ts-nocheck — standalone LFD tooling script (CLI/eval), not part of the typed app surface
// Scores every story.json (8 example-books + book3) with the LF2 instrument.
// Run from repo root on lilaiputia (Node 22). Emits tasks/lfd/story-scores.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scoreStory, extractStoryText } from './story-quality-scorer.mjs';

const F = JSON.parse(readFileSync('static/lfd/kidlit-features.json', 'utf8'));

const targets = [];
// example-books
const ebDir = 'static/pillar-library-v2/example-books';
if (existsSync(ebDir)) {
  for (const d of readdirSync(ebDir)) {
    const p = join(ebDir, d, 'story.json');
    if (existsSync(p)) targets.push({ bookId: d, path: p });
  }
}
// book3
if (existsSync('docs/samples/book3/story.json')) targets.push({ bookId: 'book3', path: 'docs/samples/book3/story.json' });

const results = [];
for (const t of targets) {
  let obj;
  try { obj = JSON.parse(readFileSync(t.path, 'utf8')); } catch (e) { console.error('skip', t.path, e.message); continue; }
  const text = extractStoryText(obj);
  const { score, perFeature } = scoreStory(text, F);
  const weakest = Object.entries(perFeature)
    .sort((a, b) => a[1].fit - b[1].fit)
    .slice(0, 3)
    .map(([k, v]) => `${k}(${v.fit})`);
  results.push({ bookId: t.bookId, score, words: text.split(/\s+/).filter(Boolean).length, weakestFeatures: weakest });
}
results.sort((a, b) => a.score - b.score);
mkdirSync('tasks/lfd', { recursive: true });
writeFileSync('tasks/lfd/story-scores.json', JSON.stringify(results, null, 2));
console.log('=== LF2 honest baseline (instrument-scored, NOT self-scored) ===');
for (const r of results) console.log(`  ${r.bookId.padEnd(8)} ${String(r.score).padStart(6)}  weakest: ${r.weakestFeatures.join(' ')}`);
const mean = results.reduce((s, r) => s + r.score, 0) / (results.length || 1);
console.log(`  mean=${mean.toFixed(2)} n=${results.length}`);
