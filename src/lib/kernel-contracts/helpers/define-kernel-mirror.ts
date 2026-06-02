// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

/**
 * defineKernelMirror — collapses the kernel-route helper boilerplate.
 *
 * Three callable shapes wrap the same "is the kernel ready, route through it,
 * fall back gracefully" recipe that's been copy-pasted across ~30 service
 * helpers (Stage 11 LLR migrations, Stage 15 trio mirrors, Stage 17 decision/
 * scenario/purpose callers):
 *
 *   defineKernelMirror({...})        — read-through (returns the result)
 *   defineKernelMirror.mirror({...}) — fire-and-forget (no return, swallows errors)
 *   defineKernelMirror.stream({...}) — AsyncIterable read-through
 *
 * All three accept the standard Stage-15-style test-injection signature where
 * a final `kernelOverride` argument bypasses `globalThis.__kernel` (and an
 * optional `flagOverride` bypasses any feature flag). This preserves the
 * `__TEST_<Svc>Kernel` ergonomic contract without leaking it through the
 * caller-facing API.
 *
 * Design: pure TypeScript, no new deps, no kernel-internal imports. The helper
 * never assumes a particular cap shape — the port type is generic so each
 * service can keep its own typed port surface in-file.
 *
 * @example Read-through (Stage 11 LLR pattern)
 * ```ts
 * import { defineKernelMirror } from '$lib/kernel-contracts/helpers/define-kernel-mirror';
 *
 * interface InferGenPort { chat: (req: ChatRequest) => Promise<ChatResponse>; }
 *
 * const _chat = defineKernelMirror<InferGenPort, [ChatRequest], ChatResponse>({
 *   capName: 'inference.generate',
 *   caller: 'agent-prediction-generator',
 *   method: 'chat',
 *   fallback: (req) => llrLlm.chat(req),
 * });
 * // Usage: const resp = await _chat(req);
 * ```
 *
 * @example Fire-and-forget mirror (Stage 15 trio pattern)
 * ```ts
 * interface RegistryPort { spawnAgent: (id: string, agent: unknown) => Promise<void>; }
 *
 * const _registryMirror = defineKernelMirror.mirror<RegistryPort>({
 *   capName: 'registry.spawn-agent',
 *   caller: 'agent-registry-service',
 *   logPrefix: '[AgentRegistryService]',
 *   featureFlag: () => TRIO_KERNEL_PATH_ENABLED,
 * });
 * // Usage: void _registryMirror('spawnAgent', [id, agent]);
 * ```
 *
 * @example Decision/Scenario/Purpose caller (Stage 17 pattern)
 * ```ts
 * interface DecisionPort { record: (i: DecisionInput) => Promise<DecisionId>; }
 *
 * const _decisionRecord = defineKernelMirror<DecisionPort, [DecisionInput], DecisionId | null>({
 *   capName: 'decision.record',
 *   caller: 'recipe-system',
 *   method: 'record',
 *   fallback: async (input) => {
 *     try { return await decisionRecorder().record(input); } catch { return null; }
 *   },
 * });
 * ```
 */

import { mirrorAudit } from './mirror-audit';
import { connectCached } from './port-cache';
import { recordProducerEvent } from '$lib/kernel-contracts/profiling/wal-producer-attribution';

/** Minimal kernel surface this helper depends on. Matches every Stage 10b+ migration helper. */
export interface KernelLike {
  connect: (cap: string, caller: string) => Promise<unknown>;
  isReady?: () => boolean;
}

/** Resolution: which kernel handle (if any) should we use, and is it ready to take a call? */
function _resolveKernel(
  kernelOverride: KernelLike | null | undefined,
): { kernel: KernelLike | null; ready: boolean } {
  // `undefined` → fall through to globalThis. Explicit `null` → no kernel.
  const kernel = (kernelOverride !== undefined
    ? kernelOverride
    : (globalThis as any).__kernel) as KernelLike | null | undefined;
  if (!kernel) return { kernel: null, ready: false };
  // Stage 17 contract: if isReady is missing, treat the kernel as ready (back-compat
  // with kernel stubs in older tests). If present, defer to it.
  const ready = typeof kernel.isReady === 'function' ? kernel.isReady() : true;
  return { kernel, ready };
}

/** Options shared by every defineKernelMirror shape. */
export interface KernelMirrorBaseOpts {
  /** Capability name to connect to. e.g. 'inference.generate'. */
  capName: string;
  /** Caller name registered in the cap's `requirableBy` allowlist. */
  caller: string;
  /** Optional log prefix for warn messages. Defaults to `[${caller}]`. */
  logPrefix?: string;
  /**
   * Optional feature-flag gate. When provided and returns false, the helper
   * is a no-op (read-through helpers fall through to fallback; mirrors do
   * nothing). Mirrors the Stage 15 `VITE_TRIO_KERNEL_PATH` flag pattern.
   */
  featureFlag?: () => boolean;
}

/** Read-through opts: produce a result, fall back to `fallback` on any failure. */
export interface KernelMirrorOpts<TPort, TArgs extends any[], TResult>
  extends KernelMirrorBaseOpts {
  /** The port method to invoke. Required: helps the type system, makes sites greppable. */
  method: keyof TPort & string;
  /** Direct-path fallback when the kernel is unavailable, not ready, or throws. */
  fallback: (...args: TArgs) => Promise<TResult> | TResult;
  /** Optional: rewrite args before passing to the kernel port. */
  argMapper?: (...args: TArgs) => any[];
}

/** Mirror opts: invoke a method, swallow failures, no return. */
export interface KernelMirrorMirrorOpts extends KernelMirrorBaseOpts {
  /**
   * Optional: limit which methods can be mirrored (defensive — prevents typos
   * silently no-op'ing). When provided, the helper throws if called with a
   * method outside the list. When omitted, any method is forwarded.
   */
  allowedMethods?: readonly string[];
}

/** Streaming opts: relay an AsyncIterable. */
export interface KernelMirrorStreamOpts<TPort, TArgs extends any[], TItem>
  extends KernelMirrorBaseOpts {
  method: keyof TPort & string;
  fallback: (...args: TArgs) => AsyncIterable<TItem> | Promise<AsyncIterable<TItem>>;
  argMapper?: (...args: TArgs) => any[];
}

/**
 * Read-through helper. Returns the kernel port's result, falls back to
 * `fallback` on any kernel-side failure (no kernel, not ready, connect throws,
 * port-method throws). Warn logged on connect/method failure (NOT on
 * not-ready or no-kernel — those are expected during boot).
 *
 * Caller signature is `(...args, kernelOverride?, flagOverride?)`. Tests pass
 * the overrides; production passes only the args.
 */
function _defineKernelMirrorReadThrough<TPort, TArgs extends any[], TResult>(
  opts: KernelMirrorOpts<TPort, TArgs, TResult>,
): (...args: [...TArgs, (KernelLike | null)?, boolean?]) => Promise<TResult> {
  const prefix = opts.logPrefix ?? `[${opts.caller}]`;

  return async function (
    ...callArgs: [...TArgs, (KernelLike | null)?, boolean?]
  ): Promise<TResult> {
    // Detect optional trailing overrides. The caller's real args end at TArgs.length;
    // anything beyond is an override. We use a defensive split so production
    // callers (which pass only TArgs) still work.
    let overridesStart = callArgs.length;
    let kernelOverride: KernelLike | null | undefined;
    let flagOverride: boolean | undefined;
    // Heuristic: if the LAST arg is a boolean, treat it as flagOverride.
    // If the prior arg looks like {connect: ...} or null, treat it as kernelOverride.
    // This lets call sites pass only TArgs without thinking about it.
    const last = callArgs[callArgs.length - 1];
    const secondLast = callArgs[callArgs.length - 2];
    if (typeof last === 'boolean'
        && (secondLast === null
            || (secondLast && typeof (secondLast as any).connect === 'function'))) {
      flagOverride = last as boolean;
      kernelOverride = secondLast as KernelLike | null;
      overridesStart = callArgs.length - 2;
    } else if (last === null || (last && typeof (last as any).connect === 'function')) {
      kernelOverride = last as KernelLike | null;
      overridesStart = callArgs.length - 1;
    }
    const realArgs = callArgs.slice(0, overridesStart) as unknown as TArgs;

    // Feature flag short-circuit (Stage 15): flagOverride wins over the configured flag.
    const flagOn =
      flagOverride !== undefined
        ? flagOverride
        : opts.featureFlag
          ? opts.featureFlag()
          : true;
    if (!flagOn) return opts.fallback(...realArgs) as TResult;

    const { kernel, ready } = _resolveKernel(kernelOverride);
    if (!kernel || !ready) {
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'kernel-not-ready' });
      return opts.fallback(...realArgs) as TResult;
    }

    let port: TPort;
    try {
      port = (await connectCached<TPort>(kernel, opts.capName, opts.caller));
    } catch (err) {
      console.warn(`${prefix} kernel route failed, falling back:`, err);
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'connect-failed', error: String(err) });
      return opts.fallback(...realArgs) as TResult;
    }

    try {
      const portMethod = (port as any)[opts.method];
      if (typeof portMethod !== 'function') {
        console.warn(`${prefix} kernel route failed: port has no method '${opts.method}'`);
        mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'method-failed', error: `port has no method '${opts.method}'` });
        return opts.fallback(...realArgs) as TResult;
      }
      const portArgs = opts.argMapper ? opts.argMapper(...realArgs) : (realArgs as unknown[]);
      const result = await portMethod.apply(port, portArgs);
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'success' });
      return result;
    } catch (err) {
      console.warn(`${prefix} kernel route failed, falling back:`, err);
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'method-failed', error: String(err) });
      return opts.fallback(...realArgs) as TResult;
    }
  };
}

/**
 * Fire-and-forget mirror. Invokes a port method, swallows errors as warns,
 * never returns a value, never throws. Mirrors the Stage 15 trio pattern:
 *
 *   void _ledgerMirror('recordBid', [agentId, amount, beat]);
 *
 * Pre-ready / no-kernel paths are silent no-ops (no warn). Connect or
 * method-call failures emit a warn.
 *
 * Caller signature: `(method, args, kernelOverride?, flagOverride?)`.
 */
function _defineKernelMirrorFireForget<TPort>(
  opts: KernelMirrorMirrorOpts,
): (
  method: keyof TPort & string,
  args: unknown[],
  kernelOverride?: KernelLike | null,
  flagOverride?: boolean,
) => Promise<void> {
  const prefix = opts.logPrefix ?? `[${opts.caller}]`;
  const allowed = opts.allowedMethods;

  return async function (
    method: keyof TPort & string,
    args: unknown[],
    kernelOverride?: KernelLike | null,
    flagOverride?: boolean,
  ): Promise<void> {
    if (allowed && !allowed.includes(method)) {
      throw new Error(
        `${prefix} method '${method}' not in allowedMethods=[${allowed.join(',')}]`,
      );
    }

    const flagOn =
      flagOverride !== undefined
        ? flagOverride
        : opts.featureFlag
          ? opts.featureFlag()
          : true;
    if (!flagOn) return;

    // WAL producer attribution: count one attempt per dispatch entry.
    recordProducerEvent(opts.caller, opts.capName, method, 'attempt');

    const { kernel, ready } = _resolveKernel(kernelOverride);
    if (!kernel || !ready) {
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'kernel-not-ready' });
      recordProducerEvent(opts.caller, opts.capName, method, 'not-ready');
      return;
    }

    let port: TPort;
    try {
      port = (await connectCached<TPort>(kernel, opts.capName, opts.caller));
    } catch (err) {
      console.warn(`${prefix} kernel ${method} mirror failed (non-fatal):`, err);
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'connect-failed', error: String(err) });
      recordProducerEvent(opts.caller, opts.capName, method, 'failed');
      return;
    }

    try {
      const portMethod = (port as any)[method];
      if (typeof portMethod !== 'function') {
        console.warn(`${prefix} kernel ${method} mirror failed (non-fatal): port has no method '${method}'`);
        mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'method-failed', error: `port has no method '${method}'` });
        recordProducerEvent(opts.caller, opts.capName, method, 'failed');
        return;
      }
      await portMethod.apply(port, args);
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'success' });
      // `routed` = port method dispatched. This is the count that maps 1:1 to
      // a worker-shell `wal.append` call.
      recordProducerEvent(opts.caller, opts.capName, method, 'routed');
    } catch (err) {
      console.warn(`${prefix} kernel ${method} mirror failed (non-fatal):`, err);
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'method-failed', error: String(err) });
      recordProducerEvent(opts.caller, opts.capName, method, 'failed');
    }
  };
}

/**
 * Streaming variant. Returns an AsyncIterable that pulls from the kernel port
 * on first iteration, falling back to the `fallback` iterable on any failure.
 * Failure in the middle of streaming is NOT recovered — the partial sequence
 * is what callers see. (To recover mid-stream, build a wrapper at the call
 * site.)
 *
 * Caller signature is the same as the read-through helper: trailing
 * kernelOverride / flagOverride are detected and stripped.
 */
function _defineKernelMirrorStream<TPort, TArgs extends any[], TItem>(
  opts: KernelMirrorStreamOpts<TPort, TArgs, TItem>,
): (...args: [...TArgs, (KernelLike | null)?, boolean?]) => AsyncIterable<TItem> {
  const prefix = opts.logPrefix ?? `[${opts.caller}]`;

  return function (
    ...callArgs: [...TArgs, (KernelLike | null)?, boolean?]
  ): AsyncIterable<TItem> {
    // Same override-detection heuristic as the read-through path.
    let overridesStart = callArgs.length;
    let kernelOverride: KernelLike | null | undefined;
    let flagOverride: boolean | undefined;
    const last = callArgs[callArgs.length - 1];
    const secondLast = callArgs[callArgs.length - 2];
    if (typeof last === 'boolean'
        && (secondLast === null
            || (secondLast && typeof (secondLast as any).connect === 'function'))) {
      flagOverride = last as boolean;
      kernelOverride = secondLast as KernelLike | null;
      overridesStart = callArgs.length - 2;
    } else if (last === null || (last && typeof (last as any).connect === 'function')) {
      kernelOverride = last as KernelLike | null;
      overridesStart = callArgs.length - 1;
    }
    const realArgs = callArgs.slice(0, overridesStart) as unknown as TArgs;

    return {
      async *[Symbol.asyncIterator]() {
        const flagOn =
          flagOverride !== undefined
            ? flagOverride
            : opts.featureFlag
              ? opts.featureFlag()
              : true;

        let useFallback = !flagOn;
        let iter: AsyncIterable<TItem> | null = null;

        if (!useFallback) {
          const { kernel, ready } = _resolveKernel(kernelOverride);
          if (!kernel || !ready) {
            useFallback = true;
          } else {
            try {
              const port = (await connectCached<TPort>(kernel, opts.capName, opts.caller));
              const portMethod = (port as any)[opts.method];
              if (typeof portMethod !== 'function') {
                console.warn(`${prefix} kernel stream route failed: port has no method '${opts.method}'`);
                useFallback = true;
              } else {
                const portArgs = opts.argMapper ? opts.argMapper(...realArgs) : (realArgs as unknown[]);
                iter = await portMethod.apply(port, portArgs);
              }
            } catch (err) {
              console.warn(`${prefix} kernel stream route failed, falling back:`, err);
              useFallback = true;
            }
          }
        }

        if (useFallback) {
          iter = await opts.fallback(...realArgs);
        }

        for await (const item of iter as AsyncIterable<TItem>) {
          yield item;
        }
      },
    };
  };
}

/**
 * Coalescing mirror options. Buffers fire-and-forget mirror calls within a
 * microtask window and flushes them as ONE batched RPC call to `batchMethod`.
 *
 * Stage 14 follow-up motive: the dominant WAL-write callers (EconometricLedger
 * recordBid+recordPayout in the same tick, AgentPriorManager updateFromAnswer
 * fanning out into N axis signals) award no coalesce in the WAL because each
 * mirror RPC awaits independently, draining the WAL microtask queue. Buffering
 * at the MIRROR layer instead — where the caller fires N void mirror calls in
 * one synchronous tick — converts the N RPCs into ONE batched RPC, which in
 * turn produces ONE WAL appendBatch and ONE IDB tx.
 */
export interface KernelMirrorCoalescingOpts<TPort> extends KernelMirrorBaseOpts {
  /**
   * Name of the port method that accepts a batched-ops array. Typically
   * 'applyBatch' or 'observeBatch'. Must exist on the cap surface.
   */
  batchMethod: keyof TPort & string;
  /**
   * Map a buffered (method, args) tuple into one element of the batch
   * argument array. The default — passing `{method, args}` through unchanged —
   * fits caps whose batch method takes that shape (e.g., ledger.commit.applyBatch).
   * Caps with a different batch-entry shape provide a mapper.
   */
  toBatchEntry?: (method: string, args: unknown[]) => unknown;
  /**
   * Methods listed here BYPASS coalescing and route as single-call RPCs.
   * Use for rarely-called or special-semantics methods (settlement dedup,
   * read-through getters) that should not pile into the batch.
   */
  passThroughMethods?: readonly string[];
  /**
   * Defensive — methods allowed through this mirror at all. When provided,
   * any method outside this list throws (catches typos).
   */
  allowedMethods?: readonly string[];
}

/**
 * Fire-and-forget coalescing mirror. Returned function has the same shape as
 * `.mirror` — `(method, args, kernelOverride?, flagOverride?)` — but buffers
 * calls in a microtask window and flushes them as ONE batched RPC to
 * `batchMethod`. Achieves N:1 WAL coalesce when callers fire many mirror
 * calls in one synchronous tick.
 *
 * Methods listed in `passThroughMethods` bypass the buffer and route as a
 * single RPC immediately.
 *
 * Returned promise resolves AFTER the batched RPC completes (success or
 * non-fatal failure). Production callers `void` it; tests can `await` it.
 */
function _defineKernelMirrorCoalescing<TPort>(
  opts: KernelMirrorCoalescingOpts<TPort>,
): (
  method: keyof TPort & string,
  args: unknown[],
  kernelOverride?: KernelLike | null,
  flagOverride?: boolean,
) => Promise<void> {
  const prefix = opts.logPrefix ?? `[${opts.caller}]`;
  const allowed = opts.allowedMethods;
  const passThrough = new Set(opts.passThroughMethods ?? []);
  const mapEntry =
    opts.toBatchEntry ?? ((method: string, args: unknown[]) => ({ method, args }));

  // Per-mirror buffer. Each tick that has at least one call gets one Buf whose
  // `flushPromise` resolves AFTER the batched RPC completes. Every same-tick
  // mirror call returns the SAME promise so production `void mirror(...)` keeps
  // working while tests can `await mirror(...)` to observe the flush.
  //
  // `methods` is a parallel array — `methods[i]` is the source method for
  // `entries[i]`. Kept separate because `toBatchEntry` may rewrite the entry
  // into a shape that drops the method name, but per-method attribution still
  // needs it on flush.
  interface Buf {
    entries: unknown[];
    methods: string[];
    kernel: KernelLike;
    flushPromise: Promise<void> | null;
  }
  const buffers = new Map<KernelLike, Buf>();
  let prodBuf: Buf | null = null;

  function _bucketFor(kernel: KernelLike, isProd: boolean): Buf {
    if (isProd) {
      if (!prodBuf) prodBuf = { entries: [], methods: [], kernel, flushPromise: null };
      return prodBuf;
    }
    let b = buffers.get(kernel);
    if (!b) {
      b = { entries: [], methods: [], kernel, flushPromise: null };
      buffers.set(kernel, b);
    }
    return b;
  }

  /** Group method names → counts. One bucket per distinct method in a drained batch. */
  function _groupCounts(methods: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const m of methods) out.set(m, (out.get(m) ?? 0) + 1);
    return out;
  }

  /** Emit a 'failed-batch' event per method group in the drained batch. */
  function _recordBatchFailure(drainedMethods: string[]): void {
    for (const [m, count] of _groupCounts(drainedMethods)) {
      recordProducerEvent(opts.caller, opts.capName, m, 'failed-batch', count);
    }
  }

  function _scheduleFlush(buf: Buf, isProd: boolean): Promise<void> {
    if (buf.flushPromise) return buf.flushPromise;
    let resolveFlush!: () => void;
    buf.flushPromise = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });
    queueMicrotask(async () => {
      const drained = buf.entries;
      const drainedMethods = buf.methods;
      buf.entries = [];
      buf.methods = [];
      const kernel = buf.kernel;
      buf.flushPromise = null;
      if (isProd) prodBuf = null;
      else buffers.delete(kernel);

      if (drained.length === 0) {
        resolveFlush();
        return;
      }
      try {
        let port: TPort;
        try {
          port = (await kernel.connect(opts.capName, opts.caller)) as TPort;
        } catch (err) {
          console.warn(`${prefix} kernel ${opts.batchMethod} mirror failed (non-fatal):`, err);
          mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'connect-failed', error: String(err) });
          _recordBatchFailure(drainedMethods);
          return;
        }
        const batchFn = (port as any)[opts.batchMethod];
        if (typeof batchFn !== 'function') {
          console.warn(`${prefix} kernel ${opts.batchMethod} mirror failed (non-fatal): port has no method '${String(opts.batchMethod)}'`);
          mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'method-failed', error: `port has no method '${String(opts.batchMethod)}'` });
          _recordBatchFailure(drainedMethods);
          return;
        }
        try {
          await batchFn.call(port, drained);
          mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'success' });
          // Emit ONE 'routed-batch' event per method group in this flush. The
          // count is the per-method occurrence count; sums across all groups
          // equal `drained.length`. Pareto math over `routed` stays correct
          // because the batched RPC produces N WAL appendBatch members.
          for (const [m, count] of _groupCounts(drainedMethods)) {
            recordProducerEvent(opts.caller, opts.capName, m, 'routed-batch', count);
          }
        } catch (err) {
          console.warn(`${prefix} kernel ${opts.batchMethod} mirror failed (non-fatal):`, err);
          mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'method-failed', error: String(err) });
          _recordBatchFailure(drainedMethods);
        }
      } finally {
        resolveFlush();
      }
    });
    return buf.flushPromise;
  }

  return async function (
    method: keyof TPort & string,
    args: unknown[],
    kernelOverride?: KernelLike | null,
    flagOverride?: boolean,
  ): Promise<void> {
    if (allowed && !allowed.includes(method)) {
      throw new Error(
        `${prefix} method '${method}' not in allowedMethods=[${allowed.join(',')}]`,
      );
    }
    const flagOn =
      flagOverride !== undefined
        ? flagOverride
        : opts.featureFlag
          ? opts.featureFlag()
          : true;
    if (!flagOn) return;

    // WAL producer attribution: count one attempt per dispatch entry (matches
    // fire-and-forget shape). Fires BEFORE resolve so flag-off keeps quiet but
    // every flag-on dispatch is observable, even if the kernel turns out to be
    // unavailable.
    recordProducerEvent(opts.caller, opts.capName, method, 'attempt');

    const { kernel, ready } = _resolveKernel(kernelOverride);
    if (!kernel || !ready) {
      mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'kernel-not-ready' });
      recordProducerEvent(opts.caller, opts.capName, method, 'not-ready');
      return;
    }

    // Pass-through methods: single-call dispatch, no buffering. Lifecycle
    // shape matches `_defineKernelMirrorFireForget` exactly so single-call
    // attribution is consistent across the two surfaces.
    if (passThrough.has(method)) {
      let port: TPort;
      try {
        port = (await kernel.connect(opts.capName, opts.caller)) as TPort;
      } catch (err) {
        console.warn(`${prefix} kernel ${method} mirror failed (non-fatal):`, err);
        mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'connect-failed', error: String(err) });
        recordProducerEvent(opts.caller, opts.capName, method, 'failed');
        return;
      }
      const fn = (port as any)[method];
      if (typeof fn !== 'function') {
        console.warn(`${prefix} kernel ${method} mirror failed (non-fatal): port has no method '${method}'`);
        mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'method-failed', error: `port has no method '${method}'` });
        recordProducerEvent(opts.caller, opts.capName, method, 'failed');
        return;
      }
      try {
        await fn.apply(port, args);
        mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'success' });
        recordProducerEvent(opts.caller, opts.capName, method, 'routed');
      } catch (err) {
        console.warn(`${prefix} kernel ${method} mirror failed (non-fatal):`, err);
        mirrorAudit.record({ caller: opts.caller, capName: opts.capName, phase: 'method-failed', error: String(err) });
        recordProducerEvent(opts.caller, opts.capName, method, 'failed');
      }
      return;
    }

    // Coalesce path. Buffer this call (and its method name in parallel) into
    // the per-kernel bucket; first caller per tick schedules the flush.
    const isProd = kernelOverride === undefined;
    const buf = _bucketFor(kernel, isProd);
    buf.entries.push(mapEntry(method, args));
    buf.methods.push(method);
    return _scheduleFlush(buf, isProd);
  };
}

// Combine the four callable shapes into one ergonomic surface. The function
// itself is the read-through helper; `.mirror`, `.stream`, `.coalescing` are
// static factories on the function value.
type DefineKernelMirrorShape = {
  <TPort, TArgs extends any[], TResult>(
    opts: KernelMirrorOpts<TPort, TArgs, TResult>,
  ): (...args: [...TArgs, (KernelLike | null)?, boolean?]) => Promise<TResult>;

  mirror<TPort>(
    opts: KernelMirrorMirrorOpts,
  ): (
    method: keyof TPort & string,
    args: unknown[],
    kernelOverride?: KernelLike | null,
    flagOverride?: boolean,
  ) => Promise<void>;

  stream<TPort, TArgs extends any[], TItem>(
    opts: KernelMirrorStreamOpts<TPort, TArgs, TItem>,
  ): (...args: [...TArgs, (KernelLike | null)?, boolean?]) => AsyncIterable<TItem>;

  coalescing<TPort>(
    opts: KernelMirrorCoalescingOpts<TPort>,
  ): (
    method: keyof TPort & string,
    args: unknown[],
    kernelOverride?: KernelLike | null,
    flagOverride?: boolean,
  ) => Promise<void>;
};

export const defineKernelMirror: DefineKernelMirrorShape =
  Object.assign(_defineKernelMirrorReadThrough, {
    mirror: _defineKernelMirrorFireForget,
    stream: _defineKernelMirrorStream,
    coalescing: _defineKernelMirrorCoalescing,
  }) as DefineKernelMirrorShape;
