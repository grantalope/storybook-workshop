// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

/**
 * Boot module for the LLR runtime kernel process.
 *
 * Imports `runtime` lazily (so that test environments without the LLR setup
 * can stub it). Returns an object exposing the four kernel-side capabilities
 * backed by the adapters in `../adapters/`.
 *
 * In production this delegates everything to the existing LLR singleton.
 * In tests, callers may inject a fake surface via createKernelInferenceProvider.
 */
import { createLLMGenerateAdapter, type LLMSurfaceLike } from '../adapters/llm-generate';
import { createEmbedTextAdapter, type EmbeddingSurfaceLike } from '../adapters/embed-text';
import { createEmbedImageAdapter } from '../adapters/embed-image';
import { createPrivacyScrubAdapter, type PrivacyFilterLike } from '../adapters/privacy-scrub';
import type { ScheduleWorkload } from '../adapters/llm-generate';
import { KVCacheOS } from '../kv-cache-os';
import { createColdStubProvider, type ColdStubProvider } from './llr-cold-stub';
import {
  readSlopFilterMode,
  wrapInferenceProviderWithSlopFilter,
} from '$dd/services/llm-shaping/SlopFilterAdapter';
import { distributionDistanceMonitor, isDistanceMonitorEnabled } from '$dd/services/llm-shaping/DistributionDistanceMonitor';

export interface LLRBridge {
  llmSurface: LLMSurfaceLike | null;
  embeddingSurface: EmbeddingSurfaceLike | null;
  privacyFilter: PrivacyFilterLike | null;
}

/**
 * Build the kernel inference provider object that publishes the four caps.
 * Adapters use lazy getters so the LLR runtime can boot AFTER the kernel
 * builds this provider (matches the master spec's deferred-boot pattern).
 *
 * Pass 0 (kernel active assertions §12): exposes `state()` returning one of
 * `'booting' | 'ready' | 'crashed' | 'suspended'` so the manifest invariant
 * for the LLR runtime can introspect liveness.
 */
export function createKernelInferenceProvider(
  getBridge: () => LLRBridge,
  scheduleWorkload?: ScheduleWorkload,
  kvCache: KVCacheOS = new KVCacheOS({ namespace: 'kernel-inference' }),
) {
  const llm = createLLMGenerateAdapter(() => getBridge().llmSurface, scheduleWorkload, kvCache);
  const embed = createEmbedTextAdapter(() => getBridge().embeddingSurface, scheduleWorkload);
  const embedImg = createEmbedImageAdapter(() => getBridge().embeddingSurface, scheduleWorkload);
  const scrub = createPrivacyScrubAdapter(() => getBridge().privacyFilter);

  return {
    chat: (req: Parameters<typeof llm.chat>[0]) => llm.chat(req),
    chatStream: (req: Parameters<typeof llm.chatStream>[0]) => llm.chatStream(req),
    embed: (req: Parameters<typeof embed.embed>[0]) => embed.embed(req),
    embedImage: (req: Parameters<typeof embedImg.embedImage>[0]) => embedImg.embedImage(req),
    scrub: (text: string, opts?: Parameters<typeof scrub.scrub>[1]) => scrub.scrub(text, opts),
    kvCacheSnapshot: () => kvCache.snapshot(),
    /**
     * Probe (Pass 0 §12): map the LLR bridge surface state to the canonical
     * kernel state set. `crashed` when both LLM and embed surfaces are null
     * (boot couldn't load $lib/llr at all); `ready` when at least one surface
     * is wired. Privacy filter is treated as optional. We don't track an
     * explicit 'booting' or 'suspended' state from this layer — those would
     * require a side-channel the boot() return value doesn't expose; the LLR
     * surface is either present (ready) or absent (crashed).
     */
    state(): string {
      const b = getBridge();
      if (!b.llmSurface && !b.embeddingSurface) return 'crashed';
      return 'ready';
    },
  };
}

/**
 * Default boot: import the live LLR runtime and PrivacyFilterService and
 * build the bridge. Exported for the manifest's module() factory.
 *
 * Both imports are wrapped in try/catch so that vitest (which cannot resolve
 * Vite aliases like $lib/llr or absolute SvelteKit paths) does not cause an
 * unhandled rejection that makes the test suite exit with code 1.
 *
 * In production (Vite dev / build), both imports resolve normally.  In vitest
 * or headless environments the bridge surfaces are null and every capability
 * call will throw "LLR not available" — callers are expected to handle that
 * via their own fallback paths.
 */
/**
 * Kernel handle that this module needs to swap in the real provider after a
 * cold-path warm-up finishes. Structurally typed so vitest can stub it
 * without importing the full Kernel class.
 */
export interface KernelLike {
  scheduleWorkload?: ScheduleWorkload;
  kvCacheOS?: KVCacheOS;
  replaceProcessInstance?: (name: string, instance: Record<string, (...args: any[]) => any>) => void;
  emit?: (event: string, data?: unknown) => void;
}

/**
 * Test/build seam for the cold-path probe + boot flow. Production wires the
 * `$lib/llr` runtime; vitest overrides with a stub via
 * `__setLlrModuleResolverForTests` below.
 */
export interface LlrModule {
  runtime: {
    bootAdaptive(): Promise<{ cold: boolean; warmComplete: Promise<void> }>;
    boot(): Promise<void>;
    isCacheCold(): boolean;
    isWarming(): boolean;
    llmSurface?: LLMSurfaceLike | null;
    embeddingSurface?: EmbeddingSurfaceLike | null;
  };
  setLlmWarming?: (v: boolean) => void;
}

let _llrModuleResolver: () => Promise<LlrModule> = async () =>
  (await import('$lib/llr' as string)) as unknown as LlrModule;

/**
 * Test hook. Inject a fake LLR module so vitest doesn't try to resolve the
 * `$lib/llr` Vite alias. Call with `null` to restore the production path.
 */
export function __setLlrModuleResolverForTests(
  resolver: (() => Promise<LlrModule>) | null,
): void {
  _llrModuleResolver = resolver
    ? resolver
    : async () => (await import('$lib/llr' as string)) as unknown as LlrModule;
}

let _privacyResolver: () => Promise<PrivacyFilterLike | null> = async () => {
  try {
    const privacyMod = await import('$dd/services/privacy/PrivacyFilterService');
    return ((privacyMod as any).privacyFilterService ?? null) as PrivacyFilterLike | null;
  } catch (err) {
    console.warn('[llr-runtime-process] PrivacyFilter import failed:', err);
    return null;
  }
};

export function __setPrivacyResolverForTests(
  resolver: (() => Promise<PrivacyFilterLike | null>) | null,
): void {
  _privacyResolver = resolver ?? (async () => {
    try {
      const privacyMod = await import('$dd/services/privacy/PrivacyFilterService');
      return ((privacyMod as any).privacyFilterService ?? null) as PrivacyFilterLike | null;
    } catch (err) {
      console.warn('[llr-runtime-process] PrivacyFilter import failed:', err);
      return null;
    }
  });
}

/**
 * Cold-path-aware boot.
 *
 * 1. Probe the LLR model cache. Warm → real boot synchronously (today's
 *    behavior); the returned provider exposes the full surfaces.
 * 2. Cold → build a `ColdStubProvider` that routes chat/embed through local
 *    Ollama (or throws `LLMWarmingError` when Ollama is unreachable). Kick
 *    the real LLR boot off in the background; when it completes, build the
 *    real provider and invoke `kernel.replaceProcessInstance('llr-runtime',
 *    realProvider)`, then `kernel.emit('llr-warm', { ms })`.
 *
 * `kernel.isReady()` stays true regardless of cold/warm state — the kernel
 * just sees a published provider that satisfies the inference capabilities.
 */
export async function boot(kernel?: KernelLike) {
  let privacyFilter: PrivacyFilterLike | null = await _privacyResolver();
  // Best-effort PrivacyFilter warmup — non-blocking.
  (privacyFilter as any)?.warmup?.().catch(() => {});

  let llrModule: LlrModule | null = null;
  try {
    llrModule = await _llrModuleResolver();
  } catch (err) {
    console.warn(
      '[llr-runtime-process] LLR import failed; bridge will surface NoBackend errors:',
      err,
    );
  }

  // No LLR at all → degrade to a pure cold stub. Privacy filter still wired.
  if (!llrModule || !llrModule.runtime) {
    const stub = createColdStubProvider({ privacyFilter });
    return _wrapStub(stub);
  }

  const { runtime, setLlmWarming } = llrModule;
  // bootAdaptive() is the policy decision point: WARM → await real; COLD →
  // fast-resolve and kick off background warm.
  let cold = false;
  let warmComplete: Promise<void> = Promise.resolve();
  try {
    const r = await runtime.bootAdaptive();
    cold = r.cold;
    warmComplete = r.warmComplete;
  } catch (err) {
    console.warn('[llr-runtime-process] bootAdaptive failed; using cold stub:', err);
    cold = true;
  }

  if (!cold) {
    // Warm path: real surfaces ready. Build the production provider.
    const bridge: LLRBridge = {
      llmSurface: (runtime as any).llmSurface ?? null,
      embeddingSurface: (runtime as any).embeddingSurface ?? null,
      privacyFilter,
    };
    const base = createKernelInferenceProvider(() => bridge, kernel?.scheduleWorkload?.bind(kernel), kernel?.kvCacheOS);
    return _wrapWithDftShaping(base);
  }

  // Cold path: build the stub provider, schedule the swap when warm completes.
  setLlmWarming?.(true);
  const stub = createColdStubProvider({ privacyFilter });
  const wrappedStub = _wrapStub(stub);

  // Background warm-up: when the real boot completes, swap in the real
  // provider via the kernel's hot-replace API. The kernel re-publishes the
  // four caps onto the new instance and tears down stub bindings.
  const tWarmStart = (globalThis.performance ?? Date).now();
  warmComplete.then(
    async () => {
      try {
        const bridge: LLRBridge = {
          llmSurface: (runtime as any).llmSurface ?? null,
          embeddingSurface: (runtime as any).embeddingSurface ?? null,
          privacyFilter,
        };
        const real = _wrapWithDftShaping(
          createKernelInferenceProvider(
            () => bridge,
            kernel?.scheduleWorkload?.bind(kernel),
            kernel?.kvCacheOS,
          ),
        );
        if (kernel?.replaceProcessInstance) {
          try {
            kernel.replaceProcessInstance('llr-runtime', real as unknown as Record<string, (...args: any[]) => any>);
          } catch (err) {
            console.warn('[llr-runtime-process] replaceProcessInstance failed:', err);
          }
        }
        const elapsedMs = ((globalThis.performance ?? Date).now() - tWarmStart) | 0;
        kernel?.emit?.('llr-warm', { ms: elapsedMs });
        setLlmWarming?.(false);
        // Visible signal in console — feed cards and other UI subscribe to the
        // store, this is for devtools log scrub.
        console.info(`[LLR] cold-path warm complete in ${elapsedMs}ms — kernel inference now routes to real provider`);
      } catch (err) {
        console.warn('[llr-runtime-process] post-warm provider swap failed:', err);
        setLlmWarming?.(false);
      }
    },
    (err) => {
      console.warn('[llr-runtime-process] warm-up rejected; staying on cold stub:', err);
      setLlmWarming?.(false);
    },
  );

  return wrappedStub;
}

/**
 * DFT-inspired LLM shaping wrap (2026-05-18). Strips slop tells from chat
 * output and fans the post-strip text into DistributionDistanceMonitor for
 * KL telemetry. Toggleable via VITE_LLM_SLOP_FILTER + VITE_LLM_DISTANCE_MONITOR.
 * Always safe: returns the provider unchanged when both flags are off.
 */
function _wrapWithDftShaping<T extends Record<string, unknown>>(provider: T): T {
  const mode = readSlopFilterMode();
  if (mode === 'off') return provider;
  const monitorOn = isDistanceMonitorEnabled();
  const sink = monitorOn
    ? (text: string, ctx: any) => {
        const agentId = typeof ctx?.req?.agentId === 'string'
          ? ctx.req.agentId
          : typeof ctx?.req?.label === 'string' ? `caller::${ctx.req.label}` : 'anonymous';
        distributionDistanceMonitor().recordSample(agentId, text);
      }
    : undefined;
  return wrapInferenceProviderWithSlopFilter(provider, { mode, onOutput: sink });
}

/**
 * Adapt the cold stub to the exact return shape of
 * `createKernelInferenceProvider` so the kernel publishes the same method
 * names. Embed-image / kvCacheSnapshot are best-effort.
 */
function _wrapStub(stub: ColdStubProvider): ReturnType<typeof createKernelInferenceProvider> {
  return {
    chat: (req) => stub.chat(req as never),
    chatStream: (req) => stub.chatStream(req as never),
    embed: (req) => stub.embed(req as never) as never,
    embedImage: (req) => stub.embedImage(req as never) as never,
    scrub: (text, opts) => stub.scrub(text, opts) as never,
    kvCacheSnapshot: () => ({ sessions: [], coldEvictions: 0 } as never),
    state: () => stub.state(),
  };
}
