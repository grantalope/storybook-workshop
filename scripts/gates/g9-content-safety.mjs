#!/usr/bin/env node
// G9-content-safety: banned-artist scanner tests + KidsContentSafety suite +
// scary-content negative-prompt presence in prompt builders.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
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

// Check 1: ScenePromptComposer must export NEGATIVE_PROMPT containing scary/gore terms
const promptComposerPath = path.join(ROOT, 'src/lib/services/scenerender/ScenePromptComposer.ts');
try {
  const content = readFileSync(promptComposerPath, 'utf8');
  const negativePromptMatch = content.match(/NEGATIVE_PROMPT\s*=\s*['"`]([^'"`]+)['"`]/);
  if (!negativePromptMatch) {
    findings.push({ check: 'negative-prompt-missing', severity: 'FAIL', detail: 'ScenePromptComposer.ts: NEGATIVE_PROMPT constant not found' });
  } else {
    const np = negativePromptMatch[1].toLowerCase();
    const requiredTerms = ['scary', 'gore'];
    for (const term of requiredTerms) {
      if (!np.includes(term)) {
        findings.push({ check: 'negative-prompt-missing-term', severity: 'FAIL', detail: 'NEGATIVE_PROMPT missing "' + term + '" — required for kid-safe generation' });
      }
    }
  }
} catch (e) {
  findings.push({ check: 'negative-prompt-missing', severity: 'FAIL', detail: 'ScenePromptComposer.ts not found at expected path' });
}

// Check 2: imagegen workflows must include negative prompt slot
const workflowsPath = path.join(ROOT, 'src/lib/services/imagegen/workflows.ts');
try {
  const content = readFileSync(workflowsPath, 'utf8');
  if (!content.includes('negative prompt') && !content.includes('negativePrompt') && !content.includes('negative_prompt')) {
    findings.push({ check: 'workflow-missing-negative-prompt', severity: 'FAIL', detail: 'imagegen/workflows.ts: no negative prompt slot found in workflow templates' });
  }
} catch (e) {
  findings.push({ check: 'workflow-missing-negative-prompt', severity: 'FAIL', detail: 'imagegen/workflows.ts not found' });
}

// Check 3: Run KidsContentSafety test suites
const result = spawnSync(
  'pnpm', ['exec', 'vitest', 'run',
    'tests/kids-content-safety-audit.test.ts',
    'tests/kids-content-safety-categories.test.ts',
    'tests/kids-content-safety-stub.test.ts',
    'tests/production-hardening.test.ts'],
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
  findings.push({ check: 'kids-content-safety-tests', severity: 'FAIL', detail: failedTests + ' content-safety tests failed' });
}

const failures = findings.filter(f => f.severity === 'FAIL');
for (const f of failures) process.stderr.write('  FAIL [' + f.check + ']: ' + f.detail + '\n');

if (failures.length === 0) {
  console.log('GATE G9-content-safety PASS NEGATIVE_PROMPT has scary/gore; KidsContentSafety suites green (' + passedTests + ')');
  process.exit(0);
} else {
  console.log('GATE G9-content-safety FAIL ' + failures.length + ' content-safety check(s) failed (see stderr)');
  process.exit(1);
}
