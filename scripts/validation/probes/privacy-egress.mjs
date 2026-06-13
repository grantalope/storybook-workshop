#!/usr/bin/env node
// scripts/validation/probes/privacy-egress.mjs
// Probe: privacy-egress
// Detects PII fields being sent to non-allowlisted external hosts.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** @typedef {{ id: string, file: string, line: number|null, severity: 'P0'|'P1'|'P2'|'P3', logicGap: string, evidence: string, suggestedFix: string, workerHint: string, suggestedLane: 'free-cloud'|'gpu-4090'|'sonnet-review', confidence: number }} Finding */

const ALLOWLISTED_HOSTS = [
  'api.stripe.com',
  'api.lulu.com',
  'api.resend.com',
  'api.sendgrid.com',
  // relative/same-origin paths are always OK
];

const PII_FIELDS = ['kidFirstName', 'kidLastName', 'kidName', 'firstName', 'lastName', 'dateOfBirth', 'parentEmail'];

function isAllowlisted(urlFragment) {
  if (!urlFragment) return false;
  // Relative paths are OK
  if (urlFragment.startsWith('/') || urlFragment.startsWith("'/") || urlFragment.startsWith('"/')) return true;
  if (urlFragment.startsWith("'/api") || urlFragment.startsWith('"/api')) return true;
  for (const host of ALLOWLISTED_HOSTS) {
    if (urlFragment.includes(host)) return true;
  }
  return false;
}

/**
 * @param {string} rootDir
 * @returns {Promise<Finding[]>}
 */
export default async function run(rootDir) {
  const findings = [];

  const srcDir = join(rootDir, 'src');
  if (!existsSync(srcDir)) return findings;

  // Find all .ts and .svelte files
  const files = spawnSync('find', [srcDir, '-name', '*.ts', '-o', '-name', '*.svelte'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }).stdout.trim().split('\n').filter(Boolean);

  for (const file of files) {
    if (!existsSync(file)) continue;
    const relFile = file.replace(rootDir + '/', '');

    // Skip test files
    if (relFile.includes('.test.') || relFile.includes('/tests/') || relFile.includes('test-stubs')) continue;

    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    // Look for fetch calls with external URLs containing PII fields
    // Strategy: find multiline blocks containing fetch() with external URL and PII fields
    // Simplified: scan for lines that have both fetch( and an external URL pattern
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for fetch calls with external https:// URLs
      const fetchExternalMatch = line.match(/fetch\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/);
      if (fetchExternalMatch) {
        const url = fetchExternalMatch[1];
        if (!isAllowlisted(url)) {
          // Check surrounding context (next 20 lines) for PII fields
          const block = lines.slice(i, Math.min(i + 20, lines.length)).join('\n');
          const foundPii = PII_FIELDS.filter(f => block.includes(f));
          if (foundPii.length > 0) {
            findings.push({
              id: `privacy-egress-pii-to-external-${i}`,
              file: relFile,
              line: i + 1,
              severity: 'P0',
              logicGap: `PII field(s) [${foundPii.join(', ')}] may be sent to non-allowlisted external host: ${url}`,
              evidence: line.trim().slice(0, 150),
              suggestedFix: `Only send PII to allowlisted hosts (api.stripe.com, api.lulu.com, api.resend.com) or relative /api/* paths`,
              workerHint: `In ${relFile} line ${i + 1}: remove ${foundPii.join('/')} from the fetch body to ${url} or move to allowlisted endpoint`,
              suggestedLane: 'sonnet-review',
              confidence: 0.85
            });
          }
        }
      }

      // Check for fetch with variable URL that might be external + PII in same block
      const fetchVarMatch = line.match(/fetch\s*\(\s*(?:env\.|process\.env\.|import\.meta\.env\.)/);
      if (fetchVarMatch) {
        const block = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
        const foundPii = PII_FIELDS.filter(f => block.includes(f));
        if (foundPii.length > 0) {
          findings.push({
            id: `privacy-egress-pii-dynamic-url-${i}`,
            file: relFile,
            line: i + 1,
            severity: 'P1',
            logicGap: `PII field(s) [${foundPii.join(', ')}] sent via fetch with dynamic URL — verify endpoint is allowlisted`,
            evidence: line.trim().slice(0, 150),
            suggestedFix: 'Verify the dynamic URL resolves to an allowlisted host before sending PII',
            workerHint: `In ${relFile} line ${i + 1}: audit that the dynamic fetch URL is always an allowlisted host when sending ${foundPii.join('/')}`,
            suggestedLane: 'sonnet-review',
            confidence: 0.6
          });
        }
      }
    }

    // Check getUserMedia/MediaRecorder outside allowed files
    if (!relFile.includes('ExifStripper') && !relFile.includes('exif') && !relFile.includes('ImageCapture')) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (/getUserMedia|MediaRecorder/.test(line) && !/ExifStripper|ImageCapture/.test(line)) {
          if (!relFile.includes('.test.')) {
            findings.push({
              id: `privacy-egress-mic-api-${relFile.replace(/\//g, '-')}-${i}`,
              file: relFile,
              line: i + 1,
              severity: 'P1',
              logicGap: 'getUserMedia/MediaRecorder present outside allowlisted ExifStripper — may capture mic/camera',
              evidence: trimmed.slice(0, 120),
              suggestedFix: 'Document the allowed usage with a comment, or move camera capture to ExifStripper.ts',
              workerHint: `In ${relFile} line ${i + 1}: add allowlist comment explaining why getUserMedia/MediaRecorder is needed here`,
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
      console.log('PASS: privacy-egress — no issues found');
    } else {
      console.log(`FAIL: privacy-egress — ${findings.length} finding(s):`);
      for (const f of findings) {
        console.log(`  [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.logicGap}`);
      }
    }
    process.exit(findings.some(f => f.severity === 'P0' || f.severity === 'P1') ? 1 : 0);
  }).catch(e => { console.error('probe error:', e); process.exit(2); });
}
