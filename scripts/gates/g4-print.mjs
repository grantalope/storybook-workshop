#!/usr/bin/env node
// G4-print: golden-fixture PDF assembly must pass LuluPdfSpecValidator,
// PDF bytes < 60MB, page count multiple respected.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Run assemble test suite (covers LuluPdfSpecValidator + PdfBuilder integration)
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/assemble/'], {
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
  console.log('GATE G4-print PASS assemble suite green (' + passedTests + ' tests); LuluPdfSpecValidator pass; PDF size/page-count checks covered');
  process.exit(0);
} else {
  const tail = lines.slice(-20).join('\n');
  process.stderr.write(tail + '\n');
  console.log('GATE G4-print FAIL assemble suite failed (' + failedTests + ' failures) — LuluPdfSpecValidator or PdfBuilder regression');
  process.exit(1);
}
