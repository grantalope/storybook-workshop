#!/usr/bin/env node
// G7-security: secret scan + Math.random in id-generation + rate-limiter +
// auth fail-closed tests.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const findings = [];

// Parse grep output: "filepath:linenum:content" -> { file, lineNum, content }
function parseGrepLine(line) {
  const m = line.match(/^([^:]+):(\d+):(.*)$/);
  if (!m) return { file: '', lineNum: 0, content: line };
  return { file: m[1], lineNum: parseInt(m[2], 10), content: m[3] };
}

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

// Check 1: secret scan — live key patterns (actual values, not comments)
const secretPatterns = [
  { pattern: 'sk_live_[A-Za-z0-9]+', label: 'stripe-live-key' },
  { pattern: 'AKIA[A-Z0-9]{16}', label: 'aws-access-key' },
  { pattern: 'ghp_[A-Za-z0-9]{36}', label: 'github-pat' },
  { pattern: 'BEGIN PRIVATE KEY', label: 'pem-private-key' },
];
const scanDirs = [path.join(ROOT, 'src'), path.join(ROOT, 'static')];
for (const { pattern, label } of secretPatterns) {
  for (const dir of scanDirs) {
    const lines = grepLines(pattern, dir, ['*.ts', '*.svelte', '*.json']);
    for (const raw of lines) {
      const { file, content } = parseGrepLine(raw);
      const c = content.trim();
      // Skip comment lines
      if (c.startsWith('//') || c.startsWith('*') || c.startsWith('#')) continue;
      // Skip string literals that are obviously example placeholders
      if (c.includes('sk_live_...') || c.includes('sk_live_<') || c.includes('sk_live_XXX') || c.includes('sk_live_*')) continue;
      // Skip line if it's inside a string that describes configuration (not the actual key value)
      if (c.includes('"sk_live_') && (c.includes('...') || c.includes('Set the'))) continue;
      // Skip test files  
      if (file.includes('.test.ts') && label !== 'pem-private-key') continue;
      findings.push({ check: label, severity: 'FAIL', detail: c.slice(0, 100) + ' [' + path.basename(file) + ':' + raw.split(':')[1] + ']' });
    }
  }
}

// Check 2: Math.random() used directly in id/token/code generation
// Injectable RNG default (= Math.random) is acceptable.
// Fallback Math.random() in crypto.randomUUID polyfill is a WARNING.
// Direct Math.random() in id-gen is a FAIL.
const mathRandomLines = grepLines('Math\.random()', path.join(ROOT, 'src'), ['*.ts']);
for (const raw of mathRandomLines) {
  const { file, content } = parseGrepLine(raw);
  const c = content.trim();
  // Skip comment lines
  if (c.startsWith('//') || c.startsWith('*')) continue;
  // Skip injectable-RNG default params: "= Math.random" or ": () => number = Math.random"
  if (/=\s*Math\.random\b/.test(c) && !c.includes('Math.random()')) continue;
  // Skip non-security uses (visual, RNG for story/layout)
  const basename = path.basename(file);
  const nonSecurityFiles = ['PretextEffectEngine', 'AsciiWeather', 'DiffSnapshotStore', 'templateFallback', 'mulberry32', 'seeded', 'pregen', 'MockProvider'];
  if (nonSecurityFiles.some(f => file.includes(f))) continue;
  // Is this in an id/token/code context?
  const idContext = ['id', 'token', 'code', 'key', 'secret', 'shortcode', 'session'].some(k =>
    c.toLowerCase().includes(k) || basename.toLowerCase().includes(k)
  );
  if (!idContext) continue;
  // Crypto fallback pattern: crypto.randomUUID ... Math.random() fallback — WARN not FAIL
  const isCryptoFallback = c.includes('randomUUID') || content.includes('getRandomValues') || (content.includes('crypto') && content.includes('||'));
  if (isCryptoFallback) {
    findings.push({ check: 'math-random-crypto-fallback', severity: 'WARN', detail: c.slice(0, 120) + ' [' + basename + ']' });
    continue;
  }
  findings.push({ check: 'math-random-in-id-gen', severity: 'FAIL', detail: c.slice(0, 120) + ' [' + basename + ']' });
}

// Check 3: Run security tests
const secResult = spawnSync(
  'pnpm', ['exec', 'vitest', 'run',
    'tests/fulfillment/security-fixes.test.ts',
    'tests/fulfillment/api-order-endpoint.test.ts',
    'tests/marketing/rate-limit-memory.test.ts'],
  {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  }
);
const testOut = (secResult.stdout || '') + (secResult.stderr || '');
let passedTests = 0, failedTests = 0;
for (const line of testOut.split('\n')) {
  const m = line.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) failed)?/);
  if (m) { passedTests = parseInt(m[1]||'0',10); failedTests = parseInt(m[2]||'0',10); }
}
if (secResult.status !== 0 || failedTests > 0) {
  const tail = testOut.split('\n').slice(-15).join('\n');
  findings.push({ check: 'security-test-suite', severity: 'FAIL', detail: tail });
}

const failures = findings.filter(f => f.severity === 'FAIL');
const warns = findings.filter(f => f.severity === 'WARN');
for (const f of failures) process.stderr.write('  FAIL [' + f.check + ']: ' + f.detail + '\n');
for (const w of warns) process.stderr.write('  WARN [' + w.check + ']: ' + w.detail + '\n');

if (failures.length === 0) {
  const warnNote = warns.length > 0 ? ' (' + warns.length + ' WARN; see stderr)' : '';
  console.log('GATE G7-security PASS no secrets found; no unsafe Math.random in id-gen; security tests pass (' + passedTests + ')' + warnNote);
  process.exit(0);
} else {
  console.log('GATE G7-security FAIL ' + failures.length + ' security check(s) failed (see stderr)');
  process.exit(1);
}
