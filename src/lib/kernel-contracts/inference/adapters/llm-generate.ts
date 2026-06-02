// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

import type { ChatRequest, ChatResponse } from '$lib/llr';
import type { WorkloadDescriptor, WorkloadRunContext } from '$lib/kernel-contracts/workloads';
import { KVCacheOS } from '../kv-cache-os';

/**
 * Minimal surface-shape we need from LLR. Decoupled from the full LLMSurface
 * class so tests can inject a stub and we don't hard-import the booted runtime.
 */
export interface LLMSurfaceLike {
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream(req: ChatRequest): AsyncIterable<unknown>;
}

export interface LLMGenerateAdapter {
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream(req: ChatRequest): AsyncIterable<unknown>;
}

export type ScheduleWorkload = <T>(
  descriptor: WorkloadDescriptor,
  runner: (ctx: WorkloadRunContext) => Promise<T> | T,
) => Promise<T>;

/**
 * Build the kernel-side adapter for `inference.generate`. The factory takes
 * a getter so the adapter resolves the LLR surface lazily — the LLR runtime
 * may not be booted at the time the kernel registers the adapter.
 */
export function createLLMGenerateAdapter(
  getSurface: () => LLMSurfaceLike | null,
  scheduleWorkload?: ScheduleWorkload,
  kvCache: KVCacheOS = new KVCacheOS(),
): LLMGenerateAdapter {
  function resolve(): LLMSurfaceLike {
    const s = getSurface();
    if (!s) throw new Error('LLR LLM surface not booted. Call runtime.boot() at app startup.');
    return s;
  }
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const { request, plan } = kvCache.applyRequest(req);
      const run = async ({ signal }: WorkloadRunContext) => {
        const response = await resolve().chat({ ...request, abortSignal: request.abortSignal ?? signal });
        if (!(response as any).content) {
          (response as any).content = response.choices?.[0]?.message?.content ?? '';
        }
        kvCache.observeCompletion(plan.sessionKey, response);
        return response;
      };
      if (!scheduleWorkload) return run({ signal: request.abortSignal ?? new AbortController().signal, descriptor: {} as any });
      return scheduleWorkload({
        kind: 'llm',
        resource: 'gpu',
        priority: request.priority ?? 'normal',
        label: request.label ?? 'inference.generate.chat',
        caller: 'inference.generate',
        signal: request.abortSignal,
        timeoutMs: request.timeoutMs,
        estimatedTokens: request.maxTokens ?? plan.estimatedPromptTokens,
        estimatedBytes: plan.estimatedBytes,
        metadata: {
          kvSessionKey: plan.sessionKey,
          kvPrefixHash: plan.prefixHash,
          kvHit: plan.hit,
        },
      }, run);
    },
    async *chatStream(req: ChatRequest): AsyncIterable<unknown> {
      const { request, plan } = kvCache.applyRequest(req);
      try {
        for await (const chunk of resolve().chatStream(request)) {
          yield chunk;
        }
        kvCache.observeCompletion(plan.sessionKey);
      } catch (err) {
        throw err;
      }
    },
  };
}
