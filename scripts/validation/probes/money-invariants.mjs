#!/usr/bin/env node
// scripts/validation/probes/money-invariants.mjs
// Probe: money-invariants
// Checks that price is always server-computed, refunds carry idempotency keys,
// and no client-trusted money values reach PaymentIntent creation.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** @typedef {{ id: string, file: string, line: number|null, severity: 'P0'|'P1'|'P2'|'P3', logicGap: string, evidence: string, suggestedFix: string, workerHint: string, suggestedLane: 'free-cloud'|'gpu-4090'|'sonnet-review', confidence: number }} Finding */

function grepFile(pattern, dir, exts = ['*.ts', '*.svelte']) {
  const results = [];
  for (const ext of exts) {
    const r = spawnSync('grep', ['-r', '--include=' + ext, '-n', pattern, dir], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    if (r.stdout) results.push(...r.stdout.trim().split('\n').filter(Boolean));
  }
  return results;
}

/**
 * @param {string} rootDir
 * @returns {Promise<Finding[]>}
 */
export default async function run(rootDir) {
  const findings = [];

  // Check 1: Look for client-trusted costCents/amountCents/price in API route request bodies
  // Pattern: reading costCents/amountCents from request.json() then passing to PaymentIntent
  const apiRoutes = join(rootDir, 'src/routes/api');
  if (existsSync(apiRoutes)) {
    const apiFiles = spawnSync('find', [apiRoutes, '-name', '+server.ts'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }).stdout.trim().split('\n').filter(Boolean);

    for (const file of apiFiles) {
      if (!existsSync(file)) continue;
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');

      // Look for destructuring costCents/amountCents/price from request body
      const requestReadPattern = /(?:const|let|var)\s*\{[^}]*(?:costCents|amountCents|bookCostCents|totalCents|price)[^}]*\}\s*=\s*await\s+request\.json/;
      if (requestReadPattern.test(src)) {
        // Now check if these values are passed to createPaymentIntent or similar
        const piPattern = /createPaymentIntent|amountCents\s*:/;
        if (piPattern.test(src)) {
          const lineIdx = lines.findIndex(l => requestReadPattern.test(l));
          findings.push({
            id: 'money-invariants-client-trusted-amount',
            file: file.replace(rootDir + '/', ''),
            line: lineIdx >= 0 ? lineIdx + 1 : null,
            severity: 'P0',
            logicGap: 'Client-supplied costCents/amountCents is being destructured from request body and may reach PaymentIntent creation (price must be server-computed)',
            evidence: `File ${file.replace(rootDir + '/', '')} reads money fields from request.json() and calls createPaymentIntent`,
            suggestedFix: 'Compute the price server-side from the order/book/format spec, never trust client-supplied amount',
            workerHint: `In ${file.replace(rootDir + '/', '')}: remove costCents from request.json() destructuring; compute server-side from pricing.ts`,
            suggestedLane: 'sonnet-review',
            confidence: 0.75
          });
        }
      }
    }
  }

  // Check 2: Refund calls missing idempotency key
  const fulfillmentDir = join(rootDir, 'src/lib/services/fulfillment');
  if (existsSync(fulfillmentDir)) {
    const refundLines = grepFile('\.refund(', fulfillmentDir, ['*.ts']);
    for (const line of refundLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (trimmed.includes('async refund(') || trimmed.includes('refund(paymentIntentId,')) {
        // This is a method definition, not a call
        continue;
      }
      // Check for refund calls: stripe.refund( or this._http.refund(
      if (/(?:stripe|_http|http)\.refund\s*\(/.test(trimmed)) {
        // Count arguments - 3rd arg is idempotency key
        // Simple check: does the line have at least 2 commas (3 args)?
        const commaCount = (trimmed.match(/,/g) || []).length;
        if (commaCount < 2) {
          const lineNum = parseInt(line.split(':')[1]) || null;
          const fileRef = line.split(':')[0].replace(rootDir + '/', '');
          findings.push({
            id: `money-invariants-refund-no-idempotency-${fileRef.replace(/\//g, '-')}`,
            file: fileRef,
            line: lineNum,
            severity: 'P1',
            logicGap: 'Refund call may be missing idempotency key (3rd argument)',
            evidence: trimmed.slice(0, 150),
            suggestedFix: 'Pass an idempotency key as the 3rd argument to refund(): `refund(piId, amount, idempotencyKey)`',
            workerHint: `In ${fileRef} line ${lineNum}: add idempotency key to refund() call to prevent double-refunds`,
            suggestedLane: 'free-cloud',
            confidence: 0.7
          });
        }
      }
    }
  }

  // Check 3: Svelte files sending money fields to EXTERNAL hosts or PaymentIntent-bound endpoints
  // Only flag if the fetch URL is external (https://) + money field present
  // Internal /api/* endpoints are OK (server controls the price on the other side)
  const srcDir = join(rootDir, 'src');
  if (existsSync(srcDir)) {
    const svelteFiles = spawnSync('find', [srcDir, '-name', '*.svelte'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }).stdout.trim().split('\n').filter(Boolean);

    for (const file of svelteFiles) {
      if (!existsSync(file)) continue;
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Only flag external fetch calls (https://) with money fields in surrounding block
        const extFetchMatch = line.match(/fetch\s*\(\s*['"`](https?:\/\/[^'"`]+)['"`]/);
        if (extFetchMatch) {
          const block = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
          if (/(?:costCents|amountCents|bookCostCents|totalCents)/.test(block)) {
            findings.push({
              id: `money-invariants-client-price-to-external-${i}`,
              file: file.replace(rootDir + '/', ''),
              line: i + 1,
              severity: 'P0',
              logicGap: 'Money field (costCents/amountCents) sent via fetch to external URL — client should never be source of truth for price to external services',
              evidence: line.trim().slice(0, 150),
              suggestedFix: 'Remove money fields from external fetch bodies; compute server-side',
              workerHint: `In ${file.replace(rootDir + '/', '')} line ${i + 1}: remove money fields from this external fetch body`,
              suggestedLane: 'free-cloud',
              confidence: 0.8
            });
          }
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
      console.log('PASS: money-invariants — no issues found');
    } else {
      console.log(`FAIL: money-invariants — ${findings.length} finding(s):`);
      for (const f of findings) {
        console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
      }
    }
    process.exit(findings.some(f => f.severity === 'P0') ? 1 : 0);
  }).catch(e => { console.error('probe error:', e); process.exit(2); });
}
