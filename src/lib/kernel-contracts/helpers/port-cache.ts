// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

/**
 * port-cache — shared (kernel, cap, caller) → port memo.
 *
 * `kernel.connect(cap, caller)` is NOT free: the PortRouter trampoline runs
 * tracing, deprecation, assertion, and capability-allowlist checks per call.
 * Profiling on 2026-05-15 showed kernel.ports.connect firing 86,510 ×/min
 * across the app (≈1.1 s aggregate cost, but the call-count is the smell —
 * we connect, throw the port away, and reconnect on the next invocation).
 *
 * The PortRouter already returns a stable Proxy bound to the live impl
 * (Stage 10d), so the same `(kernel, cap, caller)` triple is guaranteed to
 * be safe to reuse across calls. `replaceProcessInstance` swaps the inner
 * impl behind the proxy — cached ports continue to work without
 * invalidation. New kernel instance → new WeakMap entry → fresh cache.
 *
 * Cache shape:
 *   WeakMap<kernel, Map<"cap::caller", port>>
 *
 * Why WeakMap: tests create+discard kernels constantly. WeakMap lets the
 * entry GC when the kernel goes out of scope, so test isolation is
 * automatic.
 *
 * Why dedup pending connects: two callers hitting the helper in the same
 * tick should issue ONE underlying connect, not two. Common during boot
 * when Wave 1 services all wake up at once.
 *
 * @module port-cache
 */

/**
 * Minimal kernel surface. Structurally compatible with both
 * `helpers/define-kernel-mirror.KernelLike` and
 * `routes/dashboard/services/kernel-helpers/kernelRoute.KernelLike` so both
 * central helpers can share this cache without coupling to either type.
 */
export interface PortCacheKernel {
  connect: (cap: string, caller: string) => Promise<unknown>;
}

/** Cached resolved ports per (kernel, cap, caller). */
const _portCache = new WeakMap<PortCacheKernel, Map<string, unknown>>();

/** In-flight connect promises per (kernel, cap, caller) — dedup concurrent connects. */
const _pendingConnects = new WeakMap<PortCacheKernel, Map<string, Promise<unknown>>>();

function _key(cap: string, caller: string): string {
  return `${cap}::${caller}`;
}

/**
 * Connect to a capability, caching the resulting port per `(kernel, cap, caller)`.
 *
 * - First call: invokes `kernel.connect(cap, caller)`, stores result.
 * - Subsequent calls with same triple: returns cached port without touching kernel.
 * - Concurrent first calls: share one in-flight promise (no double connect).
 * - Connect failure: NOT cached — next call retries. (Caller-side warn/fallback
 *   still applies; the cache simply does not poison itself.)
 *
 * Callers wanting "no kernel? null" semantics should gate on `isKernelReady()`
 * before calling this. This function assumes the kernel is ready.
 *
 * @example
 * ```ts
 * import { connectCached } from '$lib/kernel-contracts/helpers/port-cache';
 * const port = await connectCached<InferGenPort>(kernel, 'inference.generate', 'my-svc');
 * return port.chat(req);
 * ```
 */
export async function connectCached<TPort>(
  kernel: PortCacheKernel,
  cap: string,
  caller: string,
): Promise<TPort> {
  let cache = _portCache.get(kernel);
  if (!cache) {
    cache = new Map();
    _portCache.set(kernel, cache);
  }
  const key = _key(cap, caller);
  const hit = cache.get(key);
  if (hit !== undefined) return hit as TPort;

  let pending = _pendingConnects.get(kernel);
  if (!pending) {
    pending = new Map();
    _pendingConnects.set(kernel, pending);
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight as Promise<TPort>;

  const promise = (async () => {
    try {
      const port = await kernel.connect(cap, caller);
      cache!.set(key, port);
      return port;
    } finally {
      pending!.delete(key);
    }
  })();
  pending.set(key, promise);
  return promise as Promise<TPort>;
}

/**
 * Drop cached ports for a kernel. Tests use this to reset between specs that
 * share a kernel instance. Production code does NOT need to call this — the
 * WeakMap-keyed-by-kernel pattern handles natural invalidation.
 *
 * Pass no argument to clear the entire cache (used by some tests that need a
 * hard reset across all kernels).
 */
export function clearPortCache(kernel?: PortCacheKernel | null): void {
  if (kernel) {
    _portCache.delete(kernel);
    _pendingConnects.delete(kernel);
    return;
  }
  // Full reset — WeakMap has no `clear`, so we swap. Old refs GC normally.
  // (This is only used in test setup; production should never hit it.)
  // We can't actually swap a `const`. The workaround: walk known kernels? We
  // can't iterate WeakMap. So this branch is best-effort: it only no-ops the
  // current entries by reassigning via re-export below. For now: throw to
  // make misuse loud — tests that need a global reset should pass the
  // kernel they're working with.
  throw new Error(
    'clearPortCache(): pass the kernel to clear. Whole-cache clear is not supported on WeakMap.',
  );
}

/**
 * For tests only — peek at cache size for a kernel. Used by the port-cache
 * test to assert that repeated `connectCached` calls produce one entry, not N.
 */
export function __TEST_cacheSize(kernel: PortCacheKernel): number {
  return _portCache.get(kernel)?.size ?? 0;
}
