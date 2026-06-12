#!/usr/bin/env node
// G2-check-ratchet — svelte-check error count must not exceed baseline.
// Improvements auto-tighten the stored baseline.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'baselines.json');

const baselines = JSON.parse(readFileSync(BASELINES_PATH, 'utf8'));
const maxErrors = baselines.svelteCheckMaxErrors;

const result = spawnSync(
  './node_modules/.bin/svelte-check',
  ['--tsconfig', './tsconfig.json'],
  {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: false,
  }
);

const out = (result.stdout || '') + (result.stderr || '');
const match = out.match(/svelte-check found (\d+) error/);
const currentErrors = match ? parseInt(match[1], 10) : null;

if (currentErrors === null) {
  console.log(`GATE G2-check-ratchet FAIL could not parse svelte-check output`);
  process.stderr.write(out.slice(-500) + '\n');
  process.exit(1);
}

if (currentErrors <= maxErrors) {
  // Auto-tighten baseline when code improves
  if (currentErrors < maxErrors) {
    baselines.svelteCheckMaxErrors = currentErrors;
    writeFileSync(BASELINES_PATH, JSON.stringify(baselines, null, 2) + '\n');
    console.log(`GATE G2-check-ratchet PASS ${currentErrors} errors (baseline tightened from ${maxErrors} to ${currentErrors})`);
  } else {
    console.log(`GATE G2-check-ratchet PASS ${currentErrors} errors <= baseline ${maxErrors}`);
  }
  process.exit(0);
} else {
  console.log(`GATE G2-check-ratchet FAIL ${currentErrors} errors exceeds baseline ${maxErrors} (regression: +${currentErrors - maxErrors})`);
  process.exit(1);
}
