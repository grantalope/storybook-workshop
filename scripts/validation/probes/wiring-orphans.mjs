#!/usr/bin/env node
// scripts/validation/probes/wiring-orphans.mjs
// Probe: wiring-orphans
// Detects: (1) service files never imported anywhere (dead code),
//          (2) import paths referencing non-existent files (broken imports).
import { readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** @typedef {{ id: string, file: string, line: number|null, severity: 'P0'|'P1'|'P2'|'P3', logicGap: string, evidence: string, suggestedFix: string, workerHint: string, suggestedLane: 'free-cloud'|'gpu-4090'|'sonnet-review', confidence: number }} Finding */

// Files that are legitimately not imported directly (entry points, barrel re-exports, etc.)
const EXCLUDE_PATTERNS = [
  'index.ts',
  'types.ts',
  '+server.ts',
  '+page.svelte',
  '+page.ts',
  '+layout.ts',
  '+layout.svelte',
  '.test.ts',
  '.spec.ts',
  'test-stubs',
  'setup.ts',
  'globals.d.ts',
];

function shouldExclude(filename) {
  return EXCLUDE_PATTERNS.some(p => filename.endsWith(p) || filename.includes(p));
}

/**
 * @param {string} rootDir
 * @returns {Promise<Finding[]>}
 */
export default async function run(rootDir) {
  const findings = [];

  const servicesDir = join(rootDir, 'src/lib/services');
  if (!existsSync(servicesDir)) return findings;

  // 1. Find all service .ts files (not test, not index, not types)
  const allServiceFiles = spawnSync('find', [servicesDir, '-name', '*.ts', '-not', '-name', '*.test.ts', '-not', '-name', '*.d.ts'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }).stdout.trim().split('\n').filter(Boolean);

  const serviceFiles = allServiceFiles.filter(f => !shouldExclude(f));

  // 2. For each service file, check if its basename appears in any import in src/
  const srcDir = join(rootDir, 'src');
  for (const file of serviceFiles) {
    const relFile = file.replace(rootDir + '/', '');
    const stem = basename(file, '.ts');

    // Search for imports of this file by stem name
    const r = spawnSync('grep', ['-r', '--include=*.ts', '--include=*.svelte', '-l', stem, srcDir], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    const importers = (r.stdout || '').trim().split('\n').filter(f => f && f !== file);

    if (importers.length === 0) {
      findings.push({
        id: `wiring-orphans-unused-service-${stem}`,
        file: relFile,
        line: null,
        severity: 'P2',
        logicGap: `Service file '${stem}.ts' is not imported anywhere in the codebase (potential dead code)`,
        evidence: `grep for '${stem}' in src/ returned no results other than the file itself`,
        suggestedFix: `Either wire this service into a relevant calling site, or archive it if no longer needed`,
        workerHint: `In ${relFile}: find the appropriate caller and add an import; or move to archive if deprecated`,
        suggestedLane: 'sonnet-review',
        confidence: 0.7
      });
    }
  }

  // 3. Check for broken relative imports in service files
  for (const file of allServiceFiles) {
    const relFile = file.replace(rootDir + '/', '');
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match relative import paths
      const importMatch = line.match(/from\s+['"](\.[^'"]+)['"]/);
      if (!importMatch) continue;
      const importPath = importMatch[1];

      // Resolve the import path relative to the file
      const fileDir = dirname(file);
      const resolved = resolve(fileDir, importPath);

      // Check with various extensions
      const exists = existsSync(resolved) ||
        existsSync(resolved + '.ts') ||
        existsSync(resolved + '/index.ts') ||
        existsSync(resolved + '.svelte') ||
        existsSync(resolved + '.js') ||
        existsSync(resolved + '.mjs');

      if (!exists) {
        findings.push({
          id: `wiring-orphans-broken-import-${relFile.replace(/\//g, '-')}-${i}`,
          file: relFile,
          line: i + 1,
          severity: 'P1',
          logicGap: `Broken relative import: '${importPath}' does not resolve to an existing file`,
          evidence: line.trim().slice(0, 150),
          suggestedFix: `Fix the import path or create the missing file at ${resolved}`,
          workerHint: `In ${relFile} line ${i + 1}: update import path '${importPath}' to point to existing file`,
          suggestedLane: 'free-cloud',
          confidence: 0.9
        });
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
      console.log('PASS: wiring-orphans — no issues found');
    } else {
      const p0p1 = findings.filter(f => f.severity === 'P0' || f.severity === 'P1');
      const p2p3 = findings.filter(f => f.severity === 'P2' || f.severity === 'P3');
      if (p0p1.length) {
        console.log(`FAIL: wiring-orphans — ${p0p1.length} P0/P1 finding(s):`);
        for (const f of p0p1) {
          console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
        }
      }
      if (p2p3.length) {
        console.log(`INFO: wiring-orphans — ${p2p3.length} P2/P3 finding(s) (report only):`);
        for (const f of p2p3) {
          console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
        }
      }
    }
    process.exit(findings.some(f => f.severity === 'P0' || f.severity === 'P1') ? 1 : 0);
  }).catch(e => { console.error('probe error:', e); process.exit(2); });
}
