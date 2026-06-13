#!/usr/bin/env node
// scripts/validation/probes/interface-completeness.mjs
// Probe: interface-completeness
// Checks that classes implementing key interfaces actually implement ALL required methods.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** @typedef {{ id: string, file: string, line: number|null, severity: 'P0'|'P1'|'P2'|'P3', logicGap: string, evidence: string, suggestedFix: string, workerHint: string, suggestedLane: 'free-cloud'|'gpu-4090'|'sonnet-review', confidence: number }} Finding */

/** Interface method requirements */
const INTERFACE_REQUIREMENTS = {
  'OrderStore': ['get', 'put', 'listByParent', 'getByStripePaymentIntent', 'getByLuluJob'],
  'WebhookOrderStore': ['get', 'put', 'listByParent', 'getByStripePaymentIntent', 'getByLuluJob', 'applyStripeWebhookEventOnce'],
  'RefundLedgerStore': ['get', 'put', 'listByParent', 'getByStripePaymentIntent', 'getByLuluJob', 'beginRefundOnce', 'completeRefund', 'failRefund', 'getRefundLedgerEntry'],
  'FulfillmentOrderStore': ['get', 'put', 'listByParent', 'getByStripePaymentIntent', 'getByLuluJob', 'applyStripeWebhookEventOnce', 'beginRefundOnce', 'completeRefund', 'failRefund', 'getRefundLedgerEntry'],
  'QualityClaimStore': ['get', 'put', 'listPending'],
};

/**
 * Check if a source file implements all methods of an interface
 * @param {string} src - file contents
 * @param {string[]} methods - required method names
 * @returns {string[]} missing method names
 */
function findMissingMethods(src, methods) {
  const missing = [];
  for (const method of methods) {
    // Match method definitions: async method( or method( at class member scope
    // Look for: async methodName( or methodName( preceded by whitespace (class member)
    const pattern = new RegExp(`(?:async\\s+)?${method}\\s*\\(`, 'g');
    if (!pattern.test(src)) {
      missing.push(method);
    }
  }
  return missing;
}

/**
 * @param {string} rootDir
 * @returns {Promise<Finding[]>}
 */
export default async function run(rootDir) {
  const findings = [];

  const searchDirs = [
    join(rootDir, 'src/lib/services/fulfillment'),
    join(rootDir, 'src/lib/services'),
    join(rootDir, 'src/routes'),
  ];

  for (const [interfaceName, requiredMethods] of Object.entries(INTERFACE_REQUIREMENTS)) {
    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue;

      // Find TypeScript files implementing this interface
      const r = spawnSync('grep', ['-r', '--include=*.ts', '-l', `implements ${interfaceName}`, dir], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      });

      const files = (r.stdout || '').trim().split('\n').filter(Boolean);

      for (const file of files) {
        if (!existsSync(file)) continue;
        const relFile = file.replace(rootDir + '/', '');

        // Skip test files and type definition files
        if (relFile.includes('.test.') || relFile.includes('.d.ts')) continue;

        const src = readFileSync(file, 'utf8');

        // Find the line where implements is used
        const implLine = src.split('\n').findIndex(l => l.includes(`implements ${interfaceName}`));

        // Check if abstract class
        const isAbstract = src.includes(`abstract class`) && src.includes(`implements ${interfaceName}`);

        const missingMethods = findMissingMethods(src, requiredMethods);

        if (missingMethods.length > 0) {
          const severity = isAbstract ? 'P1' : 'P0';
          findings.push({
            id: `interface-completeness-${interfaceName}-${relFile.replace(/\//g, '-')}-missing-${missingMethods.join('-')}`,
            file: relFile,
            line: implLine >= 0 ? implLine + 1 : null,
            severity,
            logicGap: `Class implements ${interfaceName} but is missing method(s): ${missingMethods.join(', ')}`,
            evidence: `File ${relFile} has 'implements ${interfaceName}' but does not define: ${missingMethods.join(', ')}`,
            suggestedFix: `Add the following methods to the class: ${missingMethods.map(m => `${m}(...): Promise<...>`).join(', ')}`,
            workerHint: `In ${relFile}: add missing ${interfaceName} method(s) [${missingMethods.join(', ')}] — check types.ts for the interface signature`,
            suggestedLane: 'free-cloud',
            confidence: 0.9
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
      console.log('PASS: interface-completeness — no issues found');
    } else {
      console.log(`FAIL: interface-completeness — ${findings.length} finding(s):`);
      for (const f of findings) {
        console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
      }
    }
    process.exit(findings.some(f => f.severity === 'P0' || f.severity === 'P1') ? 1 : 0);
  }).catch(e => { console.error('probe error:', e); process.exit(2); });
}
