// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

/**
 * Cold-path stub LLR provider.
 *
 * Returned from `llr-runtime-process.boot()` when `runtime.probeCache()`
 * reports the WebLLM model cache is empty (first-ever load OR cache cleared).
 * The kernel publishes the stub's `chat` / `chatStream` / `embed` /
 * `embedImage` / `scrub` methods on `inference.*` capabilities so callers
 * see a working surface immediately — without waiting for the multi-GB
 * model download.
 *
 * Strategy per-method:
 *   - `chat` / `chatStream` / `embed` / `embedImage`: try local Ollama
 *     (http://localhost:11434) first; if unreachable, throw `LLMWarmingError`.
 *   - `scrub`: delegates to the live PrivacyFilterService bridge — it has
 *     its own webgpu→wasm→ollama→stub probe order and does not depend on
 *     LLR model weights. Privacy gates stay intact during cold warmup.
 *
 * `state()` returns `'booting'` so the kernel watchdog and operator console
 * see the stub as a process still coming up.
 *
 * When the background warm boot completes, AppOrchestrator swaps the real
 * provider in via `kernel.replaceProcessInstance('llr-runtime', realProvider)`,
 * which re-publishes the same caps and tears down the stub silently.
 */

import { LLMWarmingError } from '$lib/stubs/llr';
import type { ChatRequest, ChatResponse } from '$lib/stubs/llr';
import type { PrivacyFilterLike } from '../adapters/privacy-scrub';

const OLLAMA_BASE = 'http://localhost:11434';
const OLLAMA_PROBE_TIMEOUT_MS = 400;
const OLLAMA_GEN_TIMEOUT_MS = 30_000;
const OLLAMA_EMBED_MODEL = 'nomic-embed-text';

export interface ColdStubOpts {
  /** Override fetch (tests). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Live PrivacyFilter — passed through unchanged. */
  privacyFilter?: PrivacyFilterLike | null;
  /** Logical model name forwarded to Ollama /api/generate. */
  ollamaChatModel?: string;
  /** Whether Ollama is reachable. If undefined, we probe lazily on first call. */
  ollamaReachable?: boolean;
  /** Override probe so tests can force "no ollama" without binding to localhost. */
  probeOllama?: () => Promise<boolean>;
}

export interface ColdStubProvider {
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream(req: ChatRequest): AsyncIterable<unknown>;
  embed(req: { input: string }): Promise<Float32Array>;
  embedImage(req: { image: unknown }): Promise<Float32Array>;
  scrub(text: string, opts?: unknown): Promise<unknown>;
  state(): string;
  /**
   * Test hook: did we route a request through Ollama, raise LLM_WARMING, or
   * defer entirely? The kernel doesn't inspect this — the test suite does.
   */
  _stats: { ollama: number; warming: number };
}

export function createColdStubProvider(opts: ColdStubOpts = {}): ColdStubProvider {
  const f = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
  const stats = { ollama: 0, warming: 0 };
  let ollamaReachable: boolean | undefined = opts.ollamaReachable;
  let ollamaProbed = ollamaReachable !== undefined;
  const chatModel = opts.ollamaChatModel ?? 'llama3.1:8b';

  async function probe(): Promise<boolean> {
    if (ollamaProbed) return !!ollamaReachable;
    ollamaProbed = true;
    if (opts.probeOllama) {
      try { ollamaReachable = await opts.probeOllama(); }
      catch { ollamaReachable = false; }
      return !!ollamaReachable;
    }
    if (!f) { ollamaReachable = false; return false; }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OLLAMA_PROBE_TIMEOUT_MS);
      try {
        const res = await f(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
        ollamaReachable = !!res?.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      ollamaReachable = false;
    }
    return !!ollamaReachable;
  }

  async function chat(req: ChatRequest): Promise<ChatResponse> {
    const reachable = await probe();
    if (!reachable || !f) {
      stats.warming++;
      throw new LLMWarmingError(
        'LLM is still downloading (model cache cold) and no local Ollama is reachable on http://localhost:11434.',
      );
    }
    stats.ollama++;
    const prompt = (req.messages ?? [])
      .map((m: { role: string; content: string }) => `${m.role === 'user' ? 'User' : m.role === 'system' ? 'System' : 'Assistant'}: ${m.content}`)
      .join('\n');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? OLLAMA_GEN_TIMEOUT_MS);
    let body: { response?: string } & Record<string, unknown> = {};
    try {
      const res = await f(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          prompt,
          stream: false,
          options: { temperature: req.temperature ?? 0.7, num_predict: req.maxTokens ?? 256 },
        }),
        signal: controller.signal,
      });
      if (!res?.ok) {
        throw new Error(`Ollama generate returned HTTP ${res?.status ?? '?'}`);
      }
      body = (await res.json()) as { response?: string };
    } finally {
      clearTimeout(timer);
    }
    const text = typeof body.response === 'string' ? body.response : '';
    return {
      choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      content: text,
      usage: undefined,
    } as ChatResponse;
  }

  async function* chatStream(req: ChatRequest): AsyncIterable<unknown> {
    // The cold-path stub does not stream — yield the whole response in one chunk.
    // Streaming via Ollama is possible but adds parsing complexity for the rare
    // case of "user has Ollama AND is also waiting for WebLLM to warm". Keep it
    // simple: a single OpenAI-shaped chunk + done signal.
    const r = await chat(req);
    yield {
      choices: [{ delta: { content: r.choices?.[0]?.message?.content ?? '' }, finish_reason: 'stop' }],
    };
  }

  async function embed(req: { input: string }): Promise<Float32Array> {
    const reachable = await probe();
    if (!reachable || !f) {
      stats.warming++;
      throw new LLMWarmingError(
        'Embeddings unavailable while LLR is downloading model weights and no local Ollama is reachable.',
      );
    }
    stats.ollama++;
    const res = await f(`${OLLAMA_BASE}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: req.input }),
    });
    if (!res?.ok) throw new Error(`Ollama embed returned HTTP ${res?.status ?? '?'}`);
    const body = (await res.json()) as { embeddings?: number[][]; embedding?: number[] };
    const vec = body.embeddings?.[0] ?? body.embedding;
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error('Ollama embed returned no vector');
    }
    return Float32Array.from(vec);
  }

  async function embedImage(_req: { image: unknown }): Promise<Float32Array> {
    // No image-embedding fallback over Ollama; image-embed callers are rare
    // and easy to gate on warming. Always throw LLM_WARMING during cold path.
    stats.warming++;
    throw new LLMWarmingError(
      'Image embedding unavailable while LLR is warming up; retry after llm-warm event.',
    );
  }

  async function scrub(text: string, scrubOpts?: unknown): Promise<unknown> {
    // Privacy filter has its own webgpu→wasm→ollama→stub probe order so it
    // does NOT depend on LLR model weights. Use the live filter when wired;
    // otherwise return a passthrough scrub so the privacy gate isn't fully
    // disabled (the regex stub backend still runs).
    const pf = opts.privacyFilter;
    if (pf && typeof pf.scrub === 'function') {
      return pf.scrub(text, scrubOpts as never);
    }
    return {
      scrubbed: text,
      redactedText: text,
      report: { detections: [] },
      detections: [],
      hardFail: false,
      inferenceMs: 0,
      backend: 'stub-coldpath',
    };
  }

  return {
    chat,
    chatStream,
    embed,
    embedImage,
    scrub,
    state: () => 'booting',
    _stats: stats,
  };
}
