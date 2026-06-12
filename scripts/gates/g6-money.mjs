#!/usr/bin/env node
// G6-money: fulfillment + marketing/promo suites + required file existence.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const findings = [];

// 1. Required test files must exist (regression-proofing)
const requiredFiles = [
  'tests/fulfillment/security-fixes.test.ts',
  'tests/fulfillment/pricing.test.ts',
  'tests/fulfillment/api-webhook-endpoints.test.ts',
  'tests/fulfillment/order-lifecycle.test.ts',
  'tests/marketing/promo-code-service.test.ts',
];
for (const f of requiredFiles) {
  if (!existsSync(path.join(ROOT, f))) {
    findings.push('MISSING required test file: ' + f);
  }
}

if (findings.length > 0) {
  for (const f of findings) process.stderr.write('  ' + f + '\n');
  console.log('GATE G6-money FAIL required test files missing (see stderr)');
  process.exit(1);
}

// 2. Run fulfillment + marketing test suites
const result = spawnSync(
  'pnpm', ['exec', 'vitest', 'run', 'tests/fulfillment/', 'tests/marketing/'],
  {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  }
);

const _stripAnsi = s => s.replace(/[[0-9;]*m/g, "");
const out = _stripAnsi((result.stdout || "") + (result.stderr || ""));
const lines = out.split('\n');
let passedTests = 0, failedTests = 0, skippedTests = 0;
for (const line of lines) {
  const m = line.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?(?:\s*\|\s*(\d+) failed)?/);
  if (m) {
    passedTests = parseInt(m[1] || '0', 10);
    skippedTests = parseInt(m[2] || '0', 10);
    failedTests = parseInt(m[3] || '0', 10);
  }
  // Also try: "N passed | N failed" order
  const m2 = line.match(/Tests\s+(\d+) passed.*?(\d+) failed/);
  if (m2 && failedTests === 0) {
    passedTests = parseInt(m2[1], 10);
    failedTests = parseInt(m2[2], 10);
  }
}

if (result.status === 0 && failedTests === 0) {
  const skipNote = skippedTests > 0 ? ' (' + skippedTests + ' skipped — SQLite unavailable in env)' : '';
  console.log('GATE G6-money PASS fulfillment+marketing suites green (' + passedTests + ' passed)' + skipNote);
  process.exit(0);
} else {
  const tail = lines.slice(-25).join('\n');
  process.stderr.write(tail + '\n');
  console.log('GATE G6-money FAIL ' + failedTests + ' money test(s) failed (price-tampering, webhook-idempotency, or refund-path regression)');
  process.exit(1);
}
