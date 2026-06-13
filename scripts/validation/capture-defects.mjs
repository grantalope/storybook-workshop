#!/usr/bin/env node
// scripts/validation/capture-defects.mjs
// Main validation runner — aggregates all probes + test results + gate output
// into tasks/defects/latest.json and tasks/defects/latest.md
//
// Usage: node scripts/validation/capture-defects.mjs [rootDir]
// Or via: pnpm validate

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(process.argv[2] || process.cwd());
const probesDir = join(__dirname, 'probes');
const outputDir = join(rootDir, 'tasks/defects');

mkdirSync(outputDir, { recursive: true });

/** @typedef {{ id: string, category: string, severity: 'P0'|'P1'|'P2'|'P3', file: string, line: number|null, evidence: string, logicGap: string, suggestedFix: string, workerHint: string, suggestedLane: 'free-cloud'|'gpu-4090'|'sonnet-review', confidence: number }} Finding */

const PROBES = [
  'webhook-completeness',
  'money-invariants',
  'privacy-egress',
  'state-machine-integrity',
  'interface-completeness',
  'wiring-orphans',
  'evidence-honesty',
];

async function runProbes() {
  const allFindings = [];

  for (const probeName of PROBES) {
    const probePath = join(probesDir, `${probeName}.mjs`);
    if (!existsSync(probePath)) {
      console.warn(`[capture-defects] probe not found: ${probePath}`);
      continue;
    }

    try {
      const { default: runProbe } = await import(probePath);
      const start = Date.now();
      const findings = await runProbe(rootDir);
      const elapsed = Date.now() - start;
      console.log(`[${probeName}] ${findings.length} finding(s) (${elapsed}ms)`);

      for (const f of findings) {
        allFindings.push({ ...f, category: probeName });
      }
    } catch (err) {
      console.error(`[${probeName}] ERROR: ${err.message}`);
      allFindings.push({
        id: `${probeName}-probe-error`,
        category: probeName,
        severity: 'P1',
        file: `scripts/validation/probes/${probeName}.mjs`,
        line: null,
        evidence: String(err).slice(0, 300),
        logicGap: `Probe '${probeName}' threw an error during execution`,
        suggestedFix: 'Fix the probe script itself',
        workerHint: `Debug scripts/validation/probes/${probeName}.mjs — it threw: ${err.message}`,
        suggestedLane: 'sonnet-review',
        confidence: 1.0,
      });
    }
  }

  return allFindings;
}

function formatSeverityIcon(severity) {
  switch (severity) {
    case 'P0': return '🔴';
    case 'P1': return '🟠';
    case 'P2': return '🟡';
    case 'P3': return '🔵';
    default: return '⚪';
  }
}

async function main() {
  console.log('[capture-defects] running probes...');
  const start = Date.now();

  const findings = await runProbes();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const p0 = findings.filter(f => f.severity === 'P0');
  const p1 = findings.filter(f => f.severity === 'P1');
  const p2 = findings.filter(f => f.severity === 'P2');
  const p3 = findings.filter(f => f.severity === 'P3');

  // Write JSON
  const jsonPath = join(outputDir, 'latest.json');
  writeFileSync(jsonPath, JSON.stringify(findings, null, 2));

  // Write markdown report
  const mdLines = [
    `# Defect Report — ${new Date().toISOString()}`,
    '',
    `**Summary:** ${findings.length} finding(s) — P0: ${p0.length}, P1: ${p1.length}, P2: ${p2.length}, P3: ${p3.length}`,
    `**Duration:** ${elapsed}s`,
    '',
  ];

  if (findings.length === 0) {
    mdLines.push('No defects found. All probes passed.');
  } else {
    const bySeverity = [p0, p1, p2, p3];
    const labels = ['P0 — Critical (block PR)', 'P1 — High (fix before merge)', 'P2 — Medium (report only)', 'P3 — Low (informational)'];

    for (let i = 0; i < bySeverity.length; i++) {
      const group = bySeverity[i];
      if (group.length === 0) continue;
      mdLines.push(`## ${formatSeverityIcon(['P0','P1','P2','P3'][i])} ${labels[i]}`);
      mdLines.push('');

      for (const f of group) {
        mdLines.push(`### ${f.id}`);
        mdLines.push(`**Category:** ${f.category}  `);
        mdLines.push(`**File:** \`${f.file}\`${f.line ? `:${f.line}` : ''}  `);
        mdLines.push(`**Logic Gap:** ${f.logicGap}  `);
        mdLines.push(`**Evidence:** \`${f.evidence.slice(0, 200)}\`  `);
        mdLines.push(`**Suggested Fix:** ${f.suggestedFix}  `);
        mdLines.push(`**Worker Hint:** ${f.workerHint}  `);
        mdLines.push(`**Lane:** ${f.suggestedLane} (confidence: ${(f.confidence * 100).toFixed(0)}%)  `);
        mdLines.push('');
      }
    }
  }

  const mdPath = join(outputDir, 'latest.md');
  writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`\n[capture-defects] done in ${elapsed}s`);
  console.log(`  P0: ${p0.length} | P1: ${p1.length} | P2: ${p2.length} | P3: ${p3.length}`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  MD:   ${mdPath}`);

  if (p0.length > 0) {
    console.log(`\n⚠ ${p0.length} P0 finding(s) — BLOCK PR`);
    for (const f of p0) {
      console.log(`  [P0] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
    }
  }
  if (p1.length > 0) {
    console.log(`\n⚠ ${p1.length} P1 finding(s) — fix before merge`);
  }

  // Non-failing exit (this is a reporter, not a gate)
  process.exit(0);
}

main().catch(err => {
  console.error('[capture-defects] fatal error:', err);
  process.exit(1);
});
