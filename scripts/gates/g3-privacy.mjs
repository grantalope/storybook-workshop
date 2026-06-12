#!/usr/bin/env node
// G3-privacy: static enforcement of on-device privacy promises.
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

// Check 1: FormData uploads must go to /api/vectorize only
const demoDirs = [
  path.join(ROOT, 'src/routes'),
  path.join(ROOT, 'src/lib/components'),
  path.join(ROOT, 'src/lib/workshop'),
];
for (const dir of demoDirs) {
  const lines = grepLines('FormData', dir, ['*.ts', '*.svelte']);
  for (const line of lines) {
    if (line.includes('/api/vectorize') || line.includes('vectorize')) continue;
    if (line.includes('ExifStripper') || line.includes('ImageCapture')) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    findings.push({ check: 'photo-upload-outside-allowlist', severity: 'FAIL', detail: line.trim() });
  }
}

// Check 2: kidName must not appear in server API routes (routes/api)
const kidNameLines = grepLines('kidName', path.join(ROOT, 'src/routes/api'), ['*.ts']);
for (const line of kidNameLines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
  if (line.includes('import ') && line.includes('type')) continue;
  // Allow: validating that kidId (not kidName) is present — but raw kidName in payload is bad
  findings.push({ check: 'kid-name-in-api-payload', severity: 'WARN', detail: trimmed.slice(0, 120) });
}

// Check 3: mic APIs (getUserMedia/MediaRecorder) - must be commented/allowlisted
const micLines = grepLines('getUserMedia\|MediaRecorder\|SpeechRecognition', ROOT, ['*.ts', '*.svelte']);
for (const line of micLines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
  // Allowlisted: ExifStripper camera path
  if (line.includes('ExifStripper.ts') || line.includes('exif') || line.includes('ImageCapture')) continue;
  if (line.includes('.test.ts') || line.includes('test-stubs')) continue;
  findings.push({ check: 'mic-api-present', severity: 'WARN', detail: trimmed.slice(0, 120) });
}

// Check 4: PII fields in CRM marketing builders
const crmDirs = [
  path.join(ROOT, 'src/lib/services/marketing'),
];
const piiPattern = 'kidName\|firstName\|lastName\|\.address\|\.phone\|dateOfBirth';
for (const dir of crmDirs) {
  const lines = grepLines(piiPattern, dir, ['*.ts']);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (line.includes('import ') && line.includes('type')) continue;
    findings.push({ check: 'pii-in-crm-payload', severity: 'WARN', detail: trimmed.slice(0, 120) });
  }
}

// Run tests/privacy/
const testResult = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/privacy/'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  shell: true,
  env: { ...process.env, FORCE_COLOR: '0' },
});
const testPassed = testResult.status === 0;
if (!testPassed) {
  const tail = ((testResult.stdout || '') + (testResult.stderr || '')).split('\n').slice(-15).join('\n');
  findings.push({ check: 'privacy-test-suite', severity: 'FAIL', detail: tail });
}

const failures = findings.filter(f => f.severity === 'FAIL');
const warns = findings.filter(f => f.severity === 'WARN');

for (const w of warns) process.stderr.write('  WARN [' + w.check + ']: ' + w.detail + '\n');
for (const f of failures) process.stderr.write('  FAIL [' + f.check + ']: ' + f.detail + '\n');

if (failures.length === 0) {
  const warnSuffix = warns.length > 0 ? ' (' + warns.length + ' warnings — see stderr)' : '';
  console.log('GATE G3-privacy PASS privacy tests pass; static checks clean' + warnSuffix);
  process.exit(0);
} else {
  console.log('GATE G3-privacy FAIL ' + failures.length + ' check(s) failed (see stderr)');
  process.exit(1);
}
