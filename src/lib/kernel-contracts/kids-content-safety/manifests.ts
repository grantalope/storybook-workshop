// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

// src/kernel/kids-content-safety/manifests.ts
//
// Single manifest for the kids-content-safety capability process.
// Pattern follows `src/kernel/decisions/manifest.ts` — a colocated
// singleton, background priority, volatile (no WAL — the audit ring
// buffer is intentionally ephemeral so it never becomes a PII surface).
//
// AppOrchestrator registration is OUT OF SCOPE for this goal (Wave 2
// `ui-shell` owns AppOrchestrator wiring). This goal EXPORTS the manifest
// + contracts; the next goal calls
//   `kernel.boot([...everything, kidsContentSafetyManifest], [..., ...KIDS_CONTENT_SAFETY_CONTRACTS])`.

import { defineManifest } from '$lib/kernel-contracts/types/manifest';
import { kidsContentSafetyService } from '$lib/kids-content-safety/KidsContentSafetyService';

export const kidsContentSafetyManifest = defineManifest({
    name: 'kids-content-safety',
    placement: 'colocated',
    module: () =>
        Promise.resolve({
            default: () => {
                // The service is a long-lived singleton. The factory returns
                // a port-shaped object that the kernel binds to
                // `kids-content.scan`.
                return {
                    scan: (...args: unknown[]) =>
                        (kidsContentSafetyService.scan as (...a: unknown[]) => unknown)(
                            ...args,
                        ),
                    activeBackend: () => kidsContentSafetyService.activeBackend(),
                    isReady: () => kidsContentSafetyService.isReady(),
                    warmup: () => kidsContentSafetyService.warmup(),
                };
            },
        }),
    // Volatile: the singleton holds in-memory probe state + the audit
    // ring. Crashing + restarting cleanly reproduces correct behavior
    // (the stub backend always wins on a cold probe so callers stay
    // green even if the wasm path went lost).
    state: 'volatile',
    stateSchemaVersion: 1,
    // Background: every call is cheap and synchronous from the caller's
    // view (post warmup); we don't need foreground reservation.
    priority: 'background',
    owner: 'system',
    publishes: ['kids-content.scan'],
    requires: [],
    budget: {
        // Story-author phase peaks at ~24 scans/book. Bursts of 50/sec
        // cover concurrent multi-book sessions; sustained 30/sec keeps
        // a parent-typing-fast dedication card responsive.
        scan: { rate: 30, burst: 50 },
    },
    restart: {
        policy: 'permanent',
        intensity: { maxRestarts: 5, withinSeconds: 60 },
        backoff: { baseMs: 100, factor: 2, capMs: 10_000, jitter: 0.1 },
    },
    health: {
        bootTimeoutMs: 5_000,
        livenessProbeIntervalMs: 30_000,
        readinessRequired: false,
    },
    watchdog: {
        yieldDeadlineMs: 200,
        gracefulShutdownMs: 1_000,
    },
    suspendCost: 'cheap',
});
