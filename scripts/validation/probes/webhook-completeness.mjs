#!/usr/bin/env node
// scripts/validation/probes/webhook-completeness.mjs
// Probe: webhook-completeness
// Checks that every handled Stripe event type uses applyStripeWebhookEventOnce for dedup.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @typedef {{ id: string, file: string, line: number|null, severity: 'P0'|'P1'|'P2'|'P3', logicGap: string, evidence: string, suggestedFix: string, workerHint: string, suggestedLane: 'free-cloud'|'gpu-4090'|'sonnet-review', confidence: number }} Finding */

/**
 * For each Stripe webhook file, find event type handlers and verify they call
 * applyStripeWebhookEventOnce before returning.
 * @param {string} rootDir
 * @returns {Promise<Finding[]>}
 */
export default async function run(rootDir) {
  const findings = [];

  // Find all stripe webhook server files
  const r = spawnSync('find', [
    join(rootDir, 'src/routes/api'),
    '-name', '+server.ts',
    '-path', '*stripe*'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const files = (r.stdout || '').trim().split('\n').filter(Boolean);

  for (const file of files) {
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    // Find event.type === '...' blocks
    // Pattern: if (event.type === 'some.event.type') { ... }
    const eventTypePattern = /event\.type\s*===\s*'([^']+)'/g;
    let match;
    while ((match = eventTypePattern.exec(src)) !== null) {
      const eventType = match[1];
      const matchPos = match.index;

      // Find the line number
      const beforeMatch = src.slice(0, matchPos);
      const lineNum = beforeMatch.split('\n').length;

      // Extract the handler block (from this if-statement to the next if-statement or end)
      // Find the opening brace after the match
      const afterMatch = src.slice(matchPos);
      const braceStart = afterMatch.indexOf('{');
      if (braceStart === -1) continue;

      // Find the matching closing brace
      let depth = 0;
      let blockEnd = -1;
      for (let i = braceStart; i < afterMatch.length; i++) {
        if (afterMatch[i] === '{') depth++;
        else if (afterMatch[i] === '}') {
          depth--;
          if (depth === 0) { blockEnd = i; break; }
        }
      }
      if (blockEnd === -1) continue;

      const handlerBlock = afterMatch.slice(braceStart, blockEnd + 1);

      // Check if this block calls applyStripeWebhookEventOnce
      if (!handlerBlock.includes('applyStripeWebhookEventOnce(')) {
        findings.push({
          id: `webhook-completeness-undeduped-${eventType.replace(/\./g, '-')}`,
          file: file.replace(rootDir + '/', ''),
          line: lineNum,
          severity: 'P1',
          logicGap: `Stripe event '${eventType}' is handled but not deduplicated via applyStripeWebhookEventOnce`,
          evidence: `Event type '${eventType}' handler at line ${lineNum} does not call applyStripeWebhookEventOnce`,
          suggestedFix: `Wrap the handler logic with store.applyStripeWebhookEventOnce({ eventId: event.id, eventType: event.type, ... }) to ensure idempotent processing`,
          workerHint: `In ${file}: find the handler for '${eventType}' (around line ${lineNum}) and add applyStripeWebhookEventOnce call before processing`,
          suggestedLane: 'free-cloud',
          confidence: 0.85
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
      console.log('PASS: webhook-completeness — no issues found');
    } else {
      console.log(`FAIL: webhook-completeness — ${findings.length} finding(s):`);
      for (const f of findings) {
        console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
        console.log(`    evidence: ${f.evidence}`);
      }
    }
    process.exit(findings.some(f => f.severity === 'P0' || f.severity === 'P1') ? 1 : 0);
  }).catch(e => { console.error('probe error:', e); process.exit(2); });
}
