#!/usr/bin/env node
// scripts/gates/g11-logic-gaps.mjs
// Gate G11: Run all validation probes. FAIL on any P0/P1 logic gap; report-only for P2/P3.
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(process.cwd());
const probesDir = join(__dirname, '..', 'validation', 'probes');

const PROBES = [
  'webhook-completeness',
  'money-invariants',
  'privacy-egress',
  'state-machine-integrity',
  'interface-completeness',
  'wiring-orphans',
  'evidence-honesty',
];

async function main() {
  const allFindings = [];
  const probeErrors = [];

  for (const probeName of PROBES) {
    const probePath = join(probesDir, `${probeName}.mjs`);
    if (!existsSync(probePath)) {
      probeErrors.push(`Probe not found: ${probePath}`);
      continue;
    }

    try {
      const { default: runProbe } = await import(probePath);
      const findings = await runProbe(rootDir);
      for (const f of findings) {
        allFindings.push({ ...f, probe: probeName });
      }
    } catch (err) {
      probeErrors.push(`Probe '${probeName}' error: ${err.message}`);
      allFindings.push({
        id: `${probeName}-probe-error`,
        probe: probeName,
        severity: 'P1',
        file: `scripts/validation/probes/${probeName}.mjs`,
        line: null,
        logicGap: `Probe threw: ${err.message}`,
      });
    }
  }

  const p0p1 = allFindings.filter(f => f.severity === 'P0' || f.severity === 'P1');
  const p2p3 = allFindings.filter(f => f.severity === 'P2' || f.severity === 'P3');

  const detail = p0p1.length > 0
    ? `${p0p1.length} logic gap(s) [${[...new Set(p0p1.map(f => f.severity))].join('+')}]: ${p0p1.slice(0, 2).map(f => f.logicGap?.slice(0, 60)).join('; ')}`
    : p2p3.length > 0
    ? `${p2p3.length} informational finding(s) [P2/P3 only]`
    : 'no logic gaps found';

  if (p0p1.length > 0 || probeErrors.length > 0) {
    console.log(`GATE G11-logic-gaps FAIL ${detail}`);
    for (const f of p0p1) {
      console.log(`  [${f.severity}][${f.probe}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
    }
    for (const e of probeErrors) {
      console.log(`  [PROBE-ERROR] ${e}`);
    }
    process.exit(1);
  } else {
    console.log(`GATE G11-logic-gaps PASS ${detail}`);
    if (p2p3.length > 0) {
      for (const f of p2p3) {
        console.log(`  [${f.severity}][${f.probe}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
      }
    }
    process.exit(0);
  }
}

main().catch(err => {
  console.log(`GATE G11-logic-gaps FAIL probe runner error: ${err.message}`);
  process.exit(1);
});
