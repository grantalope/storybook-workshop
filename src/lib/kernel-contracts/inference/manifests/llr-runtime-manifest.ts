// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

import { defineManifest } from '$lib/kernel-contracts/types/manifest';

/**
 * Kernel manifest for the LLR runtime singleton (`src/lib/llr/`).
 *
 * The kernel does NOT own LLR — LLR is a self-contained runtime with its own
 * GPUQueue, VRAMBudget, dedup, and engine selection. The manifest declares
 * LLR as a kernel-supervised process so:
 *   - Resource broker can budget calls per-agent
 *   - Watchdog can detect hung GPU operations
 *   - Memory-pressure handler can request suspend (LLR drops KV cache; weights stay)
 *   - Supervisor restarts LLR on crash
 *
 * Placement is `colocated` (Stage 10b change from `main-thread`): LLR is an
 * in-realm singleton — it runs in the same JS context as the kernel and the
 * app, so `colocated` is semantically correct AND is the only placement tier
 * that Stage 10a/10b has wired in `bootProcess`. The `main-thread` tier (which
 * requires a SharedArrayBuffer / BroadcastChannel bridge for cross-worker
 * dispatch) is deferred to Stage 10c.
 */
export const llrRuntimeManifest = defineManifest({
  name: 'llr-runtime',
  placement: 'colocated',
  module: () => import('./llr-runtime-process').then((m) => ({ default: m.boot })),
  state: 'none',
  stateSchemaVersion: 0,
  priority: 'foreground',
  owner: 'system',
  publishes: [
    'inference.generate',
    'inference.embed',
    'inference.embed-image',
    'inference.privacy-scrub',
  ],
  requires: [],
  budget: {
    inference: { rate: 30, burst: 10 },
    gpu: { rate: 1000, burst: 1000 },
  },
  restart: {
    policy: 'permanent',
    intensity: { maxRestarts: 3, withinSeconds: 300 },
    backoff: { baseMs: 1000, factor: 2, capMs: 60_000, jitter: 0.2 },
  },
  health: {
    bootTimeoutMs: 60_000,
    livenessProbeIntervalMs: 30_000,
    readinessRequired: false,
  },
  watchdog: {
    yieldDeadlineMs: 30_000,
    gracefulShutdownMs: 10_000,
  },
  suspendCost: 'expensive',
  invariants: [
    {
      name: 'llr-state',
      onViolation: 'restart',
      check: (instance) => {
        const i = instance as { state?: () => string };
        if (typeof i?.state !== 'function') return true;
        const s = i.state();
        const valid = ['booting', 'ready', 'crashed', 'suspended'];
        if (!valid.includes(s)) return `LLR state=${s} not in [${valid.join(',')}]`;
        return true;
      },
    },
  ],
});
