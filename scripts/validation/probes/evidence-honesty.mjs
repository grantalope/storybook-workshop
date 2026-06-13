#!/usr/bin/env node
// scripts/validation/probes/evidence-honesty.mjs
// THE ANTI-LIE PROBE
// Detects fabricated git shas in docs, and baseline gaming (raised svelteCheckMaxErrors).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** @typedef {{ id: string, file: string, line: number|null, severity: 'P0'|'P1'|'P2'|'P3', logicGap: string, evidence: string, suggestedFix: string, workerHint: string, suggestedLane: 'free-cloud'|'gpu-4090'|'sonnet-review', confidence: number }} Finding */

const BASELINE_MAX_ERRORS = 97; // The known-good baseline; raising above this = gaming

/**
 * Verify a git sha exists in the repository
 * @param {string} sha
 * @param {string} cwd
 * @returns {boolean}
 */
function shaExists(sha, cwd) {
  const r = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8'
  });
  return r.status === 0;
}

/**
 * @param {string} rootDir
 * @returns {Promise<Finding[]>}
 */
export default async function run(rootDir) {
  const findings = [];

  // Check if git is available
  const gitCheck = spawnSync('git', ['--version'], {
    cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8'
  });
  const gitAvailable = gitCheck.status === 0;

  if (!gitAvailable) {
    console.warn('[evidence-honesty] git not available — skipping sha verification');
  }

  // 1. SHA VERIFICATION: scan docs for claimed merge shas
  const docsDir = join(rootDir, 'docs');
  const docFiles = [];

  // Find HANDOFF.md
  const handoffFile = join(docsDir, 'HANDOFF.md');
  if (existsSync(handoffFile)) docFiles.push(handoffFile);

  // Find all state.md files in goals
  const goalsDir = join(docsDir, 'goals');
  if (existsSync(goalsDir)) {
    const r = spawnSync('find', [goalsDir, '-name', 'state.md'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    docFiles.push(...(r.stdout || '').trim().split('\n').filter(Boolean));
  }

  // Also check implementation-notes.md
  const notesFile = join(rootDir, 'implementation-notes.md');
  if (existsSync(notesFile)) docFiles.push(notesFile);

  // SHA patterns to detect
  const shaPatterns = [
    /\bmerged?\s+(?:sha\s+)?([0-9a-f]{7,40})\b/gi,
    /\bcommit\s+([0-9a-f]{7,40})\b/gi,
    /\bsha[:\s]+([0-9a-f]{7,40})\b/gi,
    /\b([0-9a-f]{40})\b/g,  // full 40-char hex
    /\b([0-9a-f]{7,12})\b/g, // short sha (7-12 chars, conservative)
  ];

  if (gitAvailable) {
    for (const file of docFiles) {
      if (!existsSync(file)) continue;
      const relFile = file.replace(rootDir + '/', '');
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');

      const checkedShas = new Set();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Look for lines that claim a merge or commit
        if (!/merge[d]?\s|commit\s|sha[:\s]/i.test(line)) continue;

        // Extract SHA candidates from the line
        const shaMatch = line.match(/\b([0-9a-f]{7,40})\b/gi);
        if (!shaMatch) continue;

        for (const sha of shaMatch) {
          if (sha.length < 7) continue;
          if (checkedShas.has(sha)) continue;
          checkedShas.add(sha);

          // Skip obvious non-shas (all zeros, version numbers, etc.)
          if (/^0+$/.test(sha) || sha.includes('.')) continue;

          if (!shaExists(sha, rootDir)) {
            findings.push({
              id: `evidence-honesty-fabricated-sha-${sha}`,
              file: relFile,
              line: i + 1,
              severity: 'P0',
              logicGap: `Claimed SHA '${sha}' does not exist in this git repository — may be fabricated`,
              evidence: line.trim().slice(0, 150),
              suggestedFix: `Replace '${sha}' with the actual commit sha, or remove the fabricated claim`,
              workerHint: `In ${relFile} line ${i + 1}: verify sha '${sha}' is real (git cat-file -e ${sha}^{commit}); if fabricated, correct or remove the claim`,
              suggestedLane: 'sonnet-review',
              confidence: 0.9
            });
          }
        }
      }
    }
  }

  // 2. BASELINE GAMING: check svelteCheckMaxErrors in baselines.json
  const baselinesFile = join(rootDir, 'scripts/gates/baselines.json');
  if (existsSync(baselinesFile)) {
    let baselines;
    try {
      baselines = JSON.parse(readFileSync(baselinesFile, 'utf8'));
    } catch (e) {
      findings.push({
        id: 'evidence-honesty-baselines-parse-error',
        file: 'scripts/gates/baselines.json',
        line: null,
        severity: 'P1',
        logicGap: 'scripts/gates/baselines.json is not valid JSON',
        evidence: String(e).slice(0, 150),
        suggestedFix: 'Fix JSON syntax in baselines.json',
        workerHint: 'In scripts/gates/baselines.json: fix the JSON syntax error',
        suggestedLane: 'free-cloud',
        confidence: 1.0
      });
      baselines = null;
    }

    if (baselines && typeof baselines.svelteCheckMaxErrors === 'number') {
      if (baselines.svelteCheckMaxErrors > BASELINE_MAX_ERRORS) {
        findings.push({
          id: 'evidence-honesty-baseline-gaming',
          file: 'scripts/gates/baselines.json',
          line: null,
          severity: 'P1',
          logicGap: `svelteCheckMaxErrors was raised to ${baselines.svelteCheckMaxErrors} (above known-good baseline of ${BASELINE_MAX_ERRORS}) — this is baseline gaming`,
          evidence: `baselines.json svelteCheckMaxErrors = ${baselines.svelteCheckMaxErrors}, expected <= ${BASELINE_MAX_ERRORS}`,
          suggestedFix: `Restore svelteCheckMaxErrors to ${BASELINE_MAX_ERRORS} or lower, and fix the actual type errors that caused the regression`,
          workerHint: `In scripts/gates/baselines.json: restore svelteCheckMaxErrors to ${BASELINE_MAX_ERRORS}; then run svelte-check to identify and fix the new errors`,
          suggestedLane: 'free-cloud',
          confidence: 1.0
        });
      }
    }
  }

  // 3. TEST COUNT CLAIMS: flag extraordinary claims
  const allDocFiles = [...docFiles];
  for (const file of allDocFiles) {
    if (!existsSync(file)) continue;
    const relFile = file.replace(rootDir + '/', '');
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Pattern: "N tests pass" or "N/N tests"
      const countMatch = line.match(/(\d+)\s*(?:\/\d+)?\s*tests?\s+(?:pass|passing|green)/i);
      if (countMatch) {
        const claimed = parseInt(countMatch[1]);
        // Actual test count is ~1389; flag if claimed > 5000 (clearly fabricated)
        if (claimed > 5000) {
          findings.push({
            id: `evidence-honesty-impossible-test-count-${i}`,
            file: relFile,
            line: i + 1,
            severity: 'P2',
            logicGap: `Claimed ${claimed} tests passing — this exceeds the known test count (~1389) by over 3x, suggesting a fabricated number`,
            evidence: line.trim().slice(0, 150),
            suggestedFix: `Verify actual test count with 'pnpm test' and update the claim`,
            workerHint: `In ${relFile} line ${i + 1}: run 'pnpm test' and replace ${claimed} with the actual count`,
            suggestedLane: 'free-cloud',
            confidence: 0.8
          });
        }
      }
    }
  }

  return findings;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const rootDir = process.argv[2] || process.cwd();
  run(rootDir).then(findings => {
    if (findings.length === 0) {
      console.log('PASS: evidence-honesty — no issues found');
    } else {
      const blocking = findings.filter(f => f.severity === 'P0' || f.severity === 'P1');
      const informational = findings.filter(f => f.severity === 'P2' || f.severity === 'P3');
      if (blocking.length) {
        console.log(`FAIL: evidence-honesty — ${blocking.length} blocking finding(s):`);
        for (const f of blocking) {
          console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
        }
      }
      if (informational.length) {
        console.log(`INFO: evidence-honesty — ${informational.length} informational finding(s):`);
        for (const f of informational) {
          console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
        }
      }
    }
    process.exit(findings.some(f => f.severity === 'P0' || f.severity === 'P1') ? 1 : 0);
  }).catch(e => { console.error('probe error:', e); process.exit(2); });
}
