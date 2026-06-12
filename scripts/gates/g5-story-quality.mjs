#!/usr/bin/env node
// G5-story-quality: StoryQualityScorer thresholds on committed golden SceneTrees.
// Also runs the full author test suite.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDENS_DIR = path.join(ROOT, 'tests', 'goldens');

// 1. Check that golden fixtures exist
const expectedGoldens = [
  'golden-gentle-glow.json',
  'golden-brave-step.json',
  'golden-giggle-quest.json',
];
const missingGoldens = expectedGoldens.filter(f => !existsSync(path.join(GOLDENS_DIR, f)));
if (missingGoldens.length > 0) {
  console.log('GATE G5-story-quality FAIL golden fixture files missing: ' + missingGoldens.join(', '));
  process.exit(1);
}

// 2. Run story-quality-specific tests (scorer + gate + goldens)
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/author/', 'tests/goldens/'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  shell: true,
  env: { ...process.env, FORCE_COLOR: '0' },
});

const _stripAnsi = s => s.replace(/[[0-9;]*m/g, "");
const out = _stripAnsi((result.stdout || "") + (result.stderr || ""));
const lines = out.split('\n');
let passedTests = 0, failedTests = 0;
for (const line of lines) {
  const m = line.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) failed)?/);
  if (m) {
    passedTests = parseInt(m[1] || '0', 10);
    failedTests = parseInt(m[2] || '0', 10);
  }
}

if (result.status === 0 && failedTests === 0) {
  console.log('GATE G5-story-quality PASS author suite green (' + passedTests + ' tests); golden SceneTrees clear quality bar');
  process.exit(0);
} else {
  const tail = lines.slice(-25).join('\n');
  process.stderr.write(tail + '\n');
  console.log('GATE G5-story-quality FAIL ' + failedTests + ' story-quality test(s) failed');
  process.exit(1);
}
