#!/usr/bin/env node
// G8-determinism: scenegrammar + storygrammar determinism suites +
// grep collapse engines for wall-clock/global-random.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const findings = [];

function grepLines(pattern, dir, exts) {
  const results = [];
  for (const ext of exts) {
    const r = spawnSync('grep', ['-r', '--include=' + ext, '-n', pattern, dir], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    if (r.stdout) results.push(...r.stdout.trim().split('\n').filter(Boolean));
  }
  return results;
}

// Check 1: collapse engines must not use wall-clock or global Math.random
const collapseEngines = [
  path.join(ROOT, 'src/lib/services/scenegrammar'),
  path.join(ROOT, 'src/lib/services/storygrammar'),
];
const nondeterministicPatterns = ['Date\.now()', 'new Date()', 'Math\.random()', 'performance\.now()'];
for (const dir of collapseEngines) {
  for (const pattern of nondeterministicPatterns) {
    const lines = grepLines(pattern, dir, ['*.ts']);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      findings.push({
        check: 'non-deterministic-collapse',
        severity: 'FAIL',
        detail: trimmed.slice(0, 120) + ' [' + path.basename(dir) + ']'
      });
    }
  }
}

// Check 2: Run scenegrammar + storygrammar test suites
const result = spawnSync(
  'pnpm', ['exec', 'vitest', 'run', 'tests/scenegrammar/', 'tests/storygrammar/'],
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
let passedTests = 0, failedTests = 0;
for (const line of lines) {
  const m = line.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) failed)?/);
  if (m) { passedTests = parseInt(m[1]||'0',10); failedTests = parseInt(m[2]||'0',10); }
}

if (result.status !== 0 || failedTests > 0) {
  const tail = lines.slice(-15).join('\n');
  process.stderr.write(tail + '\n');
  findings.push({
    check: 'determinism-test-suite',
    severity: 'FAIL',
    detail: failedTests + ' determinism tests failed'
  });
}

const failures = findings.filter(f => f.severity === 'FAIL');
for (const f of failures) process.stderr.write('  FAIL [' + f.check + ']: ' + f.detail + '\n');

if (failures.length === 0) {
  console.log('GATE G8-determinism PASS scenegrammar+storygrammar suites green (' + passedTests + '); no wall-clock/global-random in collapse engines');
  process.exit(0);
} else {
  console.log('GATE G8-determinism FAIL ' + failures.length + ' determinism check(s) failed (see stderr)');
  process.exit(1);
}
