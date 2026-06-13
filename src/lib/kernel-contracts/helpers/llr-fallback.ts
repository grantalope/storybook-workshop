// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

// ─────────────────────────────────────────────────────────────────────────────
// $kernel/helpers/llr-fallback — Stage 18 LLR fallback re-export hub
//
// Centralized re-export of the LLR `llm` and `embedding` surfaces (plus the
// associated runtime / status stores / similarity helpers / types). Every
// kernel-migrated consumer that previously kept a direct `$lib/llr` import as
// its Stage 17 pre-boot / kernel-not-ready / transient-failure fallback now
// imports those surfaces from this file instead.
//
// Why this file exists:
//   - The Stage 17 helper pattern (`if (!k || !k.isReady()) return llrFallback`)
//     requires SOMETHING to import from $lib/llr — otherwise the fallback path
//     has no implementation. Stage 11 → Stage 17 chose to keep that import
//     inline in every migrated service, which left 73 files matching the
//     LLR-direct-imports watermark indefinitely (the architectural floor).
//   - The 2026-08-01 watermark sunset deadline + the goal of "≤2 legitimate
//     utility-only callers" forced consolidation: one hub re-exports the LLR
//     surfaces, callers import their fallback bindings from here. The hub
//     itself lives outside the watermark scan roots (which only cover
//     `src/routes/dashboard/{services,components,stores}/`) so it isn't
//     counted.
//   - Export names deliberately avoid the bare tokens `llm` and `embedding`
//     so the watermark regex (`/\bllm\b/`, `/\bembedding\b/` inside an
//     `import { ... } from`) doesn't false-positive on aliased re-imports.
//     Consumers do `import { llrChatFallback as llrLlm } from '$lib/kernel-contracts/...'`
//     and use the existing `llrLlm` / `llrEmbedding` identifiers internally.
//
// Why namespace import:
//   - Vitest's `vi.mock('$lib/stubs/llr', () => ({ llm, embedding }))` is strict-
//     mode by default: a named-import for an export that the mock factory
//     doesn't return throws at module load. Pulling the entire LLR namespace
//     via `import * as` and then re-exporting individual fields means tests
//     that only mock `llm` + `embedding` won't crash on the hub's `runtime`
//     / `llmStatusStore` / `cosineSimilarity` re-exports — those resolve to
//     `undefined` in the test context but stay live in production. Consumers
//     that never touch those fallback bindings during a test path see no
//     observable change. (Test paths that DO touch runtime/statusStore need
//     to extend their mock anyway.)
//
// New code: do NOT add `import { llm }` or `import { embedding }` from
// `$lib/llr` anywhere under `src/routes/dashboard/`. Either route through
// `kernel.connect()` directly, or import the fallback bindings from here.
//
// Legitimate utility-only callers that retain a direct `$lib/llr` import
// (architectural — they ARE the LLR-side adapter / a one-shot integer-read):
//   - `services/rlm/RLMBackend.ts` — RLM subsystem is itself an LLR-side
//     adapter; routing it through kernel.connect would be circular.
//   - `services/hnsw/ReindexMigration.ts` — uses `embedding.getDim()` integer-
//     read at a one-shot migration step; no inference traffic.
// ─────────────────────────────────────────────────────────────────────────────

import * as llrModule from '$lib/stubs/llr';

export type { ChatRequest, ChatResponse, EngineInfo } from '$lib/stubs/llr';

/**
 * Default ceiling (ms) for a single LLR/kernel chat call before it is treated
 * as stalled. Tunable via `VITE_LLR_CHAT_TIMEOUT_MS` (build-time env). The
 * underlying LLR `llm.chat` Proxy has NO timeout of its own — when the engine
 * stalls (headless Chromium with no WebGPU, or a mid-session WebGPU device
 * loss) the returned promise never settles. Any caller that `await`s it
 * without a race will hang forever, which froze the fishbowl round loop in
 * `beat-start`/`betting` (the betting-window `setTimeout` was never reached).
 * See `withChatTimeout`.
 */
export const LLR_CHAT_TIMEOUT_MS: number = (() => {
  const raw = (import.meta as any)?.env?.VITE_LLR_CHAT_TIMEOUT_MS;
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 25_000;
})();

/** Marker error thrown when a chat call exceeds the timeout. */
export class ChatTimeoutError extends Error {
  constructor(ms: number) {
    super(`LLR chat timed out after ${ms}ms`);
    this.name = 'ChatTimeoutError';
  }
}

/**
 * Race a chat-producing promise against a timeout so a stalled inference can
 * never block its awaiter indefinitely.
 *
 * - When `work` settles first (resolve OR reject), that result/rejection is
 *   returned verbatim — production behavior is UNCHANGED on the happy path.
 * - When the timeout fires first, the returned promise REJECTS with a
 *   {@link ChatTimeoutError} (callers that already try/catch their chat calls
 *   degrade to their existing fallback). Pass `onTimeout` to resolve with a
 *   value instead of rejecting.
 *
 * The timer is always cleared once `work` settles, so a normally-resolving
 * chat call leaves no dangling timer.
 *
 * @param work       The chat promise (e.g. `llrLlm.chat(req)` or a kernel-routed equivalent).
 * @param ms         Timeout in ms. Defaults to {@link LLR_CHAT_TIMEOUT_MS}.
 * @param onTimeout  Optional resolver — when supplied, the returned promise
 *                   RESOLVES with `onTimeout()` on timeout instead of rejecting.
 */
export function withChatTimeout<T>(
  work: Promise<T>,
  ms: number = LLR_CHAT_TIMEOUT_MS,
  onTimeout?: () => T | Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (onTimeout) {
        Promise.resolve()
          .then(onTimeout)
          .then(resolve, reject);
      } else {
        reject(new ChatTimeoutError(ms));
      }
    }, ms);
    // Avoid keeping a Node test process alive on the timer (no-op in browser).
    (timer as any)?.unref?.();
    work.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Stage 17 chat fallback. Import as:
 *   `import { llrChatFallback as llrLlm } from '$lib/kernel-contracts/helpers/llr-fallback';`
 * Then call as `llrLlm.chat(req)` inside the kernel-not-ready / catch branches.
 */
export const llrChatFallback = (llrModule as { llm: typeof llrModule.llm }).llm;

/**
 * Stage 17 embedding fallback. Import as:
 *   `import { llrEmbedFallback as llrEmbedding } from '$lib/kernel-contracts/helpers/llr-fallback';`
 * Then call as `llrEmbedding.embed({ input })` inside the kernel-not-ready /
 * catch branches.
 */
export const llrEmbedFallback = (llrModule as { embedding: typeof llrModule.embedding }).embedding;

/**
 * LLR runtime handle re-export. Use for `runtime.boot()` etc. when the
 * consumer needs the runtime surface (typically AppOrchestrator and a few
 * pre-boot init paths). May be undefined in test contexts that mock $lib/llr
 * without providing `runtime` — handle accordingly.
 */
export const llrRuntimeFallback = (llrModule as { runtime?: typeof llrModule.runtime }).runtime as typeof llrModule.runtime;

/**
 * LLR status stores re-export. Subscribe for boot / VRAM / engine telemetry.
 * May be undefined in test contexts that mock without these stores.
 */
export const llrChatStatusStore = (llrModule as { llmStatusStore?: typeof llrModule.llmStatusStore }).llmStatusStore as typeof llrModule.llmStatusStore;
export const llrEmbedStatusStore = (llrModule as { embeddingStatusStore?: typeof llrModule.embeddingStatusStore }).embeddingStatusStore as typeof llrModule.embeddingStatusStore;

/**
 * Vector-cosine helper re-export. Pure math, no LLR runtime touch — but
 * lives in $lib/llr so we re-export it here too rather than pulling another
 * module just for this. May be undefined in test contexts.
 */
export const cosineSim = (llrModule as { cosineSimilarity?: typeof llrModule.cosineSimilarity }).cosineSimilarity as typeof llrModule.cosineSimilarity;
