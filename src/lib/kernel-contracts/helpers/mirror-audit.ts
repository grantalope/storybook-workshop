// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

/**
 * mirror-audit — aggregated counter for `defineKernelMirror` outcomes.
 *
 * Records every kernel-route attempt across all migrated services and
 * exposes both per-(caller,cap) summaries and a recent-failures ring buffer.
 * Surfaced on `/debug/os` via `MirrorAuditPanel.svelte` so operators can
 * see drift between kernel-routed calls and direct-fallback calls.
 *
 * Phases recorded:
 *   - 'success'           — kernel route completed without error
 *   - 'kernel-not-ready'  — `globalThis.__kernel` absent or `isReady() === false`
 *   - 'connect-failed'    — `kernel.connect()` rejected
 *   - 'method-failed'     — port method itself rejected after successful connect
 *
 * Created Cycle 5A (2026-04-29) per Stage 16 review HIGH #2 (audit counter
 * for mirror failures so /debug/os surfaces drift).
 */

export type MirrorAuditPhase =
  | 'success'
  | 'kernel-not-ready'
  | 'connect-failed'
  | 'method-failed';

export interface MirrorAuditEntry {
  caller: string;
  capName: string;
  phase: MirrorAuditPhase;
  ts: number;
  /** Optional error message for failed phases. Truncated to 200 chars. */
  error?: string;
}

export interface MirrorAuditPhaseCounts {
  success: number;
  'kernel-not-ready': number;
  'connect-failed': number;
  'method-failed': number;
}

export interface MirrorAuditSummary {
  totalCalls: number;
  /** Per (caller:capName) phase counts. */
  perKey: Record<string, MirrorAuditPhaseCounts>;
  /** Per caller phase counts (aggregated across all caps). */
  perCaller: Record<string, MirrorAuditPhaseCounts>;
  /** Newest-first ring buffer of recent failures (excluding 'success'). */
  recentFailures: MirrorAuditEntry[];
}

export class MirrorAudit {
  /** Hard cap on the entries ring buffer. Bounds memory under heavy load. */
  readonly CAP: number;
  /** Hard cap on recentFailures slice (≤ CAP). */
  readonly FAILURES_CAP: number;

  private entries: MirrorAuditEntry[] = [];

  constructor(opts: number | { cap?: number; failuresCap?: number } = {}) {
    if (typeof opts === 'number') {
      this.CAP = opts;
      this.FAILURES_CAP = 25;
    } else {
      this.CAP = opts.cap ?? 1000;
      this.FAILURES_CAP = opts.failuresCap ?? 25;
    }
  }

  /**
   * Record a phase outcome. Wrapped in try/catch internally — a broken
   * audit must NEVER throw, since the helper relies on it being silent.
   */
  record(entry: Omit<MirrorAuditEntry, 'ts'>): void {
    try {
      const ts = Date.now();
      const errMsg = entry.error
        ? String(entry.error).slice(0, 200)
        : undefined;
      this.entries.push({ ...entry, ts, ...(errMsg ? { error: errMsg } : {}) });
      // Ring-buffer eviction (FIFO).
      while (this.entries.length > this.CAP) this.entries.shift();
    } catch {
      // Audit must never throw.
    }
  }

  /** Return a defensive copy of all entries (newest last). */
  snapshot(): MirrorAuditEntry[] {
    try {
      return this.entries.slice();
    } catch {
      return [];
    }
  }

  /** Aggregated summary for /debug/os. */
  summary(): MirrorAuditSummary {
    try {
      const empty = (): MirrorAuditPhaseCounts => ({
        success: 0,
        'kernel-not-ready': 0,
        'connect-failed': 0,
        'method-failed': 0,
      });
      const perKey: Record<string, MirrorAuditPhaseCounts> = {};
      const perCaller: Record<string, MirrorAuditPhaseCounts> = {};
      let totalCalls = 0;
      const failures: MirrorAuditEntry[] = [];

      for (const e of this.entries) {
        totalCalls++;
        const key = `${e.caller}:${e.capName}`;
        if (!perKey[key]) perKey[key] = empty();
        if (!perCaller[e.caller]) perCaller[e.caller] = empty();
        perKey[key][e.phase] += 1;
        perCaller[e.caller][e.phase] += 1;
        if (e.phase !== 'success') failures.push(e);
      }

      // Newest-first, capped.
      const recentFailures = failures
        .slice(-this.FAILURES_CAP)
        .reverse();

      return { totalCalls, perKey, perCaller, recentFailures };
    } catch {
      return {
        totalCalls: 0,
        perKey: {},
        perCaller: {},
        recentFailures: [],
      };
    }
  }

  /** Clear all entries. Useful for tests. */
  reset(): void {
    try {
      this.entries = [];
    } catch {
      // ignore
    }
  }
}

// ── Singleton (the helper records into this) ────────────────────────────────

export const mirrorAudit = new MirrorAudit();

/** Test-only: reset the singleton between vitest cases. */
export function __resetMirrorAudit(): void {
  mirrorAudit.reset();
}
