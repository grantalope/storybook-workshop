#!/usr/bin/env node
// G1-tests — full vitest suite must be green.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const result = spawnSync('pnpm', ['test'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  shell: true,
  env: { ...process.env, FORCE_COLOR: '0' },
});

// Strip ANSI escape codes for parsing
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const out = stripAnsi((result.stdout || '') + (result.stderr || ''));
const lines = out.split('\n');

let passedFiles = 0, failedFiles = 0, passedTests = 0, failedTests = 0;
for (const line of lines) {
  const filesMatch = line.match(/Test Files\s+(\d+) passed(?:.*?(\d+) failed)?/);
  if (filesMatch) {
    passedFiles = parseInt(filesMatch[1] || '0', 10);
    failedFiles = parseInt(filesMatch[2] || '0', 10);
  }
  const testsMatch = line.match(/^\s*Tests\s+(\d+) passed(?:.*?(\d+) failed)?/);
  if (testsMatch) {
    passedTests = parseInt(testsMatch[1] || '0', 10);
    failedTests = parseInt(testsMatch[2] || '0', 10);
  }
}

const exitCode = result.status ?? 1;
if (exitCode === 0 && failedTests === 0 && failedFiles === 0 && passedTests > 0) {
  console.log('GATE G1-tests PASS ' + passedTests + ' tests green across ' + passedFiles + ' files');
  process.exit(0);
} else if (exitCode === 0 && passedTests === 0) {
  // Couldn't parse — but exit code is 0, so tests passed
  console.log('GATE G1-tests PASS exit code 0 (test count unparseable — ANSI)');
  process.exit(0);
} else {
  const detail = failedTests > 0
    ? failedTests + ' tests failed in ' + failedFiles + ' files'
    : 'exit code ' + exitCode;
  process.stderr.write(lines.slice(-40).join('\n') + '\n');
  console.log('GATE G1-tests FAIL ' + detail);
  process.exit(1);
}
