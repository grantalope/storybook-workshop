#!/usr/bin/env node
// scripts/gates/run-all.mjs — run all acceptance gates and print a table.
// Exit 0 if all pass (or only allow-listed failures); exit 1 otherwise.
//
// Node >=20 required (vite-plugin-svelte@6 + util.styleText).
// If running under <20, this script re-execs itself via nvm node 22.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const [nodeMaj] = process.version.replace('v', '').split('.').map(Number);
if (nodeMaj < 20) {
  // Re-exec under Node 22 via nvm. Must use a login shell to source nvm.
  const nvmNode = spawnSync(
    'bash',
    ['-lc', `source ~/.nvm/nvm.sh && nvm exec 22 node ${process.argv[1]} ${process.argv.slice(2).join(' ')}`],
    { stdio: 'inherit', shell: false }
  );
  process.exit(nvmNode.status ?? 1);
}

const GATES_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(GATES_DIR, '..', '..');
const BASELINES_PATH = resolve(GATES_DIR, 'baselines.json');

const baselines = JSON.parse(readFileSync(BASELINES_PATH, 'utf8'));
const allowFailIds = new Set((baselines.allowFail || []).map(e => e.gate));

const gates = [
  { id: 'G1-tests',          script: 'g1-tests.mjs',          desc: 'Full vitest suite green' },
  { id: 'G2-check-ratchet',  script: 'g2-check-ratchet.mjs',  desc: 'svelte-check errors <= baseline' },
  { id: 'G3-privacy',        script: 'g3-privacy.mjs',         desc: 'On-device privacy enforcement' },
  { id: 'G4-print',          script: 'g4-print.mjs',           desc: 'PDF assembly / LuluPdfSpec pass' },
  { id: 'G5-story-quality',  script: 'g5-story-quality.mjs',   desc: 'Story quality golden fixtures' },
  { id: 'G6-money',          script: 'g6-money.mjs',           desc: 'Fulfillment / payment tests' },
  { id: 'G7-security',       script: 'g7-security.mjs',        desc: 'Secret scan + auth/rate-limit' },
  { id: 'G8-determinism',    script: 'g8-determinism.mjs',     desc: 'Collapse engine determinism' },
  { id: 'G9-content-safety', script: 'g9-content-safety.mjs',  desc: 'Kids content safety / NEGATIVE_PROMPT' },
  { id: 'G10-a11y',          script: 'g10-a11y.mjs',           desc: 'Static a11y checks (img-alt, roles)' },
  { id: 'G11-logic-gaps',     script: 'g11-logic-gaps.mjs',     desc: 'Logic-gap probes (P0/P1 fail, P2/P3 report)' },
];

const results = [];
const startAll = Date.now();

for (const gate of gates) {
  const start = Date.now();
  const r = spawnSync('node', [resolve(GATES_DIR, gate.script)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: 300_000, // 5 min per gate
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1) + 's';
  const stdout = (r.stdout || '').trim();
  const stderr = (r.stderr || '').trim();

  // Parse GATE <id> PASS|FAIL <detail> from stdout
  const match = stdout.match(/^GATE \S+ (PASS|FAIL)\s*(.*)/m);
  const status = match ? match[1] : (r.status === 0 ? 'PASS' : 'FAIL');
  const detail = match ? match[2] : (r.status === 0 ? 'ok' : 'exit code ' + r.status);

  const allowFailed = status === 'FAIL' && allowFailIds.has(gate.id);
  results.push({ ...gate, status, detail, elapsed, stderr, allowFailed });
}

const totalElapsed = ((Date.now() - startAll) / 1000).toFixed(1) + 's';

// Print table
console.log('\n' + '═'.repeat(72));
console.log(' ACCEPTANCE GATES — ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
console.log('═'.repeat(72));
const colW = [10, 5, 8, 44];
console.log(
  padEnd('GATE', colW[0]) + padEnd('STATUS', colW[1]) + padEnd('TIME', colW[2]) + 'DETAIL'
);
console.log('─'.repeat(72));

let blockingFails = 0;
for (const r of results) {
  let label = r.status;
  if (r.allowFailed) label = 'WARN';
  if (r.status === 'FAIL' && !r.allowFailed) blockingFails++;

  const icon = label === 'PASS' ? '✓' : label === 'WARN' ? '⚠' : '✗';
  console.log(
    padEnd(r.id, colW[0]) +
    padEnd(icon + ' ' + label, colW[1] + 1) +
    padEnd(r.elapsed, colW[2]) +
    r.detail.slice(0, colW[3])
  );
}

console.log('─'.repeat(72));
const overall = blockingFails === 0 ? 'ALL GATES PASS' : blockingFails + ' GATE(S) FAILED';
console.log(' ' + overall + '  (total: ' + totalElapsed + ')');
if (allowFailIds.size > 0) {
  console.log(' Allow-listed: ' + [...allowFailIds].join(', ') + ' — see scripts/gates/baselines.json');
}
console.log('═'.repeat(72) + '\n');

// Print stderr for failed gates
for (const r of results) {
  if ((r.status === 'FAIL') && r.stderr) {
    console.error('\n--- stderr: ' + r.id + ' ---');
    console.error(r.stderr.split('\n').slice(0, 20).join('\n'));
  }
}

process.exit(blockingFails === 0 ? 0 : 1);

function padEnd(str, len) {
  return String(str).padEnd(len);
}
