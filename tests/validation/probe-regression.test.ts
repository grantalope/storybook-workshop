import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const PROBES_DIR = resolve(__dir, '../../scripts/validation/probes');
const CORPUS_DIR = resolve(__dir, 'known-defect-corpus');
const REPO_ROOT = resolve(__dir, '../..');

interface Finding {
  id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  file: string;
  line: number | null;
  logicGap: string;
  evidence: string;
  suggestedFix: string;
  workerHint: string;
  suggestedLane: string;
  confidence: number;
}

/** Run a probe via node subprocess against a dir. Returns parsed findings. */
function runProbe(probeName: string, tempDir: string): Finding[] {
  const runnerScript = [
    `import { default as run } from '${PROBES_DIR}/${probeName}.mjs';`,
    `const findings = await run('${tempDir.replace(/\\/g, '/')}');`,
    `process.stdout.write(JSON.stringify(findings));`,
  ].join('\n');

  const tmpScript = join(tmpdir(), `probe-runner-${probeName}-${Date.now()}.mjs`);
  writeFileSync(tmpScript, runnerScript);

  const result = spawnSync('node', [tmpScript], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NO_COLOR: '1' },
  });

  try { rmSync(tmpScript); } catch { /* ok */ }

  if (result.error) throw result.error;
  const out = result.stdout?.trim() ?? '';
  if (!out) return [];
  try {
    return JSON.parse(out) as Finding[];
  } catch {
    return [];
  }
}

/** Create a temp dir with the given files */
function makeTempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'probe-regression-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

// --- CORPUS TESTS — each probe must catch its planted defect ---

describe('C1 — evidence-honesty catches fabricated sha', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir({
      'docs/goals/test/state.md': readFileSync(join(CORPUS_DIR, 'c1-state.md'), 'utf8'),
      'scripts/gates/baselines.json': JSON.stringify({ svelteCheckMaxErrors: 97, allowFail: [] }),
    });
    spawnSync('git', ['init', '--quiet'], { cwd: tmpDir });
    spawnSync('git', ['commit', '--allow-empty', '-m', 'init', '--no-gpg-sign'], {
      cwd: tmpDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      },
    });
  });

  afterAll(() => { try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ } });

  it('detects fabricated sha abc1234def5678901234567890abcdef12345678 as P0', () => {
    const findings = runProbe('evidence-honesty', tmpDir);
    const shaFindings = findings.filter(f => f.id.includes('fabricated-sha'));
    expect(shaFindings.length, 'expected at least one fabricated-sha finding').toBeGreaterThan(0);
    expect(shaFindings[0].severity).toBe('P0');
  });
});

describe('C2 — evidence-honesty catches raised svelteCheckMaxErrors', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir({
      'scripts/gates/baselines.json': readFileSync(join(CORPUS_DIR, 'c2-baselines.json'), 'utf8'),
    });
  });

  afterAll(() => { try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ } });

  it('detects svelteCheckMaxErrors:200 (above known-good 97) as P1', () => {
    const findings = runProbe('evidence-honesty', tmpDir);
    const baselineFindings = findings.filter(f => f.id === 'evidence-honesty-baseline-gaming');
    expect(baselineFindings.length, 'expected evidence-honesty-baseline-gaming finding').toBeGreaterThan(0);
    expect(baselineFindings[0].severity).toBe('P1');
  });
});

describe('C3 — interface-completeness catches missing getByLuluJob', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir({
      'src/lib/services/fulfillment/BadOrderStore.ts': readFileSync(join(CORPUS_DIR, 'c3-bad-order-store.ts'), 'utf8'),
    });
  });

  afterAll(() => { try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ } });

  it('detects BadOrderStore missing getByLuluJob as P0', () => {
    const findings = runProbe('interface-completeness', tmpDir);
    const methodFindings = findings.filter(f => f.logicGap?.includes('getByLuluJob'));
    expect(methodFindings.length, 'expected finding about missing getByLuluJob').toBeGreaterThan(0);
    expect(methodFindings[0].severity).toBe('P0');
  });
});

describe('C4 — privacy-egress catches PII to external host', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir({
      'src/lib/services/analytics.ts': readFileSync(join(CORPUS_DIR, 'c4-privacy-leak.ts'), 'utf8'),
    });
  });

  afterAll(() => { try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ } });

  it('detects kidFirstName sent to https://analytics.third-party.com as P0', () => {
    const findings = runProbe('privacy-egress', tmpDir);
    const p0Findings = findings.filter(f => f.severity === 'P0');
    expect(p0Findings.length, 'expected P0 finding for PII egress').toBeGreaterThan(0);
  });
});

describe('C5 — webhook-completeness catches undeduped Stripe handler', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir({
      'src/routes/api/stripe-webhook/+server.ts': readFileSync(join(CORPUS_DIR, 'c5-webhook-no-dedup.ts'), 'utf8'),
    });
  });

  afterAll(() => { try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ } });

  it('detects payment_intent.succeeded handled without applyStripeWebhookEventOnce as P0 or P1', () => {
    const findings = runProbe('webhook-completeness', tmpDir);
    const highFindings = findings.filter(f => f.severity === 'P0' || f.severity === 'P1');
    expect(highFindings.length, 'expected P0/P1 finding for undeduped webhook').toBeGreaterThan(0);
  });
});

describe('C6 — money-invariants catches client-trusted costCents', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir({
      'src/routes/api/checkout/+server.ts': [
        "import { json } from '@sveltejs/kit';",
        "import { stripe } from '$lib/server/stripe';",
        'export const POST = async ({ request }) => {',
        '  const { costCents, items } = await request.json();',
        '  const pi = await stripe.paymentIntents.create({ amountCents: costCents, currency: "usd" });',
        '  return json({ clientSecret: pi.client_secret });',
        '};',
      ].join('\n'),
    });
  });

  afterAll(() => { try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ } });

  it('detects client-supplied costCents passed to createPaymentIntent as P0', () => {
    const findings = runProbe('money-invariants', tmpDir);
    const p0Findings = findings.filter(f => f.severity === 'P0');
    expect(p0Findings.length, 'expected P0 finding for client-trusted amount').toBeGreaterThan(0);
  });
});

describe('C7 — state-machine-integrity catches absorbing non-terminal state', () => {
  let tmpDir: string;

  beforeAll(() => {
    // 'in_production' has no outbound transitions and is NOT in VALID_TERMINALS
    // → absorbing non-terminal → P0
    tmpDir = makeTempDir({
      'src/lib/services/fulfillment/OrderLifecycleService.ts': [
        "export type OrderState = 'pending_payment' | 'in_production' | 'delivered';",
        '',
        'const ALLOWED = Object.freeze({',
        "  pending_payment: new Set<OrderState>(['in_production']),",
        '  in_production: new Set<OrderState>([]),',
        '  delivered: new Set<OrderState>([]),',
        '});',
        '',
        'export function canTransition(from: OrderState, to: OrderState): boolean {',
        '  return ALLOWED[from]?.has(to) ?? false;',
        '}',
      ].join('\n'),
      'src/lib/services/fulfillment/types.ts': [
        "export type OrderState = 'pending_payment' | 'in_production' | 'delivered';",
      ].join('\n'),
    });
  });

  afterAll(() => { try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ } });

  it('detects in_production as absorbing non-terminal state (P0)', () => {
    const findings = runProbe('state-machine-integrity', tmpDir);
    const absorbingFindings = findings.filter(f => f.id.includes('absorbing'));
    expect(absorbingFindings.length, 'expected finding for absorbing non-terminal in_production').toBeGreaterThan(0);
    expect(absorbingFindings[0].severity).toBe('P0');
  });
});

describe('C8 — wiring-orphans catches broken relative import', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = makeTempDir({
      'src/lib/services/OrphanService.ts': [
        "import { SomeDep } from './NonExistentDep';",
        '',
        'export class OrphanService {',
        '  doSomething() {',
        '    return new SomeDep();',
        '  }',
        '}',
      ].join('\n'),
      // Import OrphanService so the file is not also flagged as orphaned
      'src/lib/index.ts': "export { OrphanService } from './services/OrphanService';",
    });
  });

  afterAll(() => { try { rmSync(tmpDir, { recursive: true }); } catch { /* ok */ } });

  it('detects broken relative import ./NonExistentDep as P1', () => {
    const findings = runProbe('wiring-orphans', tmpDir);
    const brokenFindings = findings.filter(f => f.severity === 'P1' && f.logicGap?.includes('NonExistentDep'));
    expect(brokenFindings.length, 'expected P1 finding for broken import NonExistentDep').toBeGreaterThan(0);
  });
});

// --- REGRESSION TESTS — all probes clean on live src ---

const ALL_PROBES = [
  'evidence-honesty',
  'interface-completeness',
  'money-invariants',
  'privacy-egress',
  'state-machine-integrity',
  'webhook-completeness',
  'wiring-orphans',
] as const;

describe('Live-src regression — no new P0/P1 findings on real code', () => {
  for (const probeName of ALL_PROBES) {
    it(`${probeName} introduces no P0/P1 regressions`, () => {
      const findings = runProbe(probeName, REPO_ROOT);

      if (probeName === 'evidence-honesty') {
        // evidence-honesty may flag P1 baseline drifts in baselines.json legitimately,
        // but MUST NOT find fabricated shas (P0) in the live codebase
        const fabricatedShaFindings = findings.filter(
          f => f.severity === 'P0' && f.id.includes('fabricated-sha'),
        );
        expect(fabricatedShaFindings, 'no fabricated-sha P0 in live src').toHaveLength(0);
      } else {
        const regressions = findings.filter(f => f.severity === 'P0' || f.severity === 'P1');
        expect(regressions, `${probeName}: no P0/P1 findings in live src`).toHaveLength(0);
      }
    });
  }
});
