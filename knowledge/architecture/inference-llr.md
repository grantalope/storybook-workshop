---
type: Service
title: InferenceClient / LLR Shim
description: Canonical inference facade for the storybook-workshop standalone — wraps the kernel.connect path (no-op here) with LLR fallback that routes to the active StoryLLM provider (Ollama or Anthropic). Embedding is a stub. Ollama blocked in browser per policy.
tags: [inference, llr, llm, ollama, anthropic, kernel, facade]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/inference/inferenceClient.ts
status: production
---

# createInferenceClient

```ts
// src/lib/inference/inferenceClient.ts
export function createInferenceClient(caller: string): InferenceClient
```

Factory. Construct **once at module scope** per service and reuse. `caller` string flows into `kernel.connect(cap, caller)` as the permission-scoped identity.

Returns `InferenceClient`:

```ts
interface InferenceClient {
  chat(req: ChatRequest): Promise<ChatResponse>
  chatStream(req: ChatRequest): AsyncIterable<CompletionChunk>
  embed(req: EmbedRequest): Promise<EmbedResult>       // STUB — throws
  embedImage(req: EmbedImageRequest): Promise<Float32Array>  // STUB — throws
  scrub(text: string, opts?: ScrubOpts): Promise<ScrubResult>
}
```

---

# Routing

```
createInferenceClient('storybook-workshop-author')
  └─ defineKernelMirror({ capName: 'inference.generate', caller, method: 'chat', fallback })
        ├─ kernel present + isReady() → kernel.connect → port.chat()     [NEVER in this repo]
        └─ kernel absent OR not ready → fallback: llrChatFallback.chat() [ALWAYS in this repo]
```

**No kernel boots in this standalone repo.** `globalThis.__kernel` is always absent. Every call goes straight to the LLR fallback path (`llrChatFallback` = `$lib/llr`'s `llm` export).

---

# $lib/llr — The Shim (src/lib/llr/index.ts)

The pachinko upstream `$lib/llr` is a WebLLM/ONNX browser runtime (WebGPU). In this standalone it is **replaced by a typed shim** that routes to the active StoryLLM provider.

## llm.chat

```ts
export const llm = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const provider = resolveStoryLlmProvider()  // reads STORY_LLM_PROVIDER at call time
    const out = await provider.chat(toStoryLlmRequest(req))
    return { content: out.content, finish_reason: 'stop', usage: ... }
  }
}
```

`resolveStoryLlmProvider()` selects provider from `STORY_LLM_PROVIDER` env var:

| `STORY_LLM_PROVIDER` | Provider | Impl |
|---|---|---|
| `ollama` (default) | `OllamaProvider` | `POST {STORY_LLM_OLLAMA_URL}/api/chat` (default `http://localhost:11434`) |
| `anthropic` | `AnthropicProvider` | Anthropic Messages API |
| `stub` | `StubStoryLlmProvider` | Always throws → falls through to template fallback |
| anything else | — | Throws immediately at construction |

Default model for Ollama: `gemma3:12b` (`STORY_LLM_MODEL` overrides).

## llm.engineInfo

Returns `{ backend: 'storyllm-<provider.name>', modelId: provider.model ?? provider.name }`. Used for telemetry.

## embedding (STUB)

```ts
export const embedding = {
  async embed(_text: string): Promise<Float32Array> { throw new Error('stub') },
  async embedBatch(_texts: string[]): Promise<Float32Array[]> { throw new Error('stub') },
}
```

No embedder is wired. Callers that hit this path get a thrown error; none currently do in the story-generation path.

---

# OllamaProvider (src/lib/services/storyllm/OllamaProvider.ts)

- `POST {baseUrl}/api/chat` non-streaming.
- JSON mode → `format: "json"` constrained decoding.
- Default timeout: 120s per attempt (`AbortController`).
- Default retries: 2 after first attempt (`maxRetries`).
- Retry on: network errors, 429, 5xx. Throw immediately on 4xx.
- `system`-role messages folded into Ollama `messages[0]` with `role: 'system'`.

## No-Ollama-in-Browser Policy

Project mandate (CLAUDE.md, 2026-06-12): production inference = in-browser/in-app only (WebGPU→WASM→stub); Ollama is a Node dev/CI failsafe.

In the **current code**, `llm.chat` calls `resolveStoryLlmProvider()` which reads `process.env.STORY_LLM_PROVIDER`. In the browser `process` is undefined → `STORY_LLM_PROVIDER` evaluates to `undefined` → provider is `ollama` → `OllamaProvider` is constructed → `fetch('http://localhost:11434/api/chat')` is called. This will fail with a network error in the browser, falling through to the template fallback in `StoryAuthorService`. A browser-guard throw (check `typeof window !== 'undefined'` → throw before fetch) is **policy intent** but not yet enforced in code as of 2026-06-13.

See [No-Ollama-in-Browser Decision](/decisions/no-ollama-in-browser.md).

---

# AnthropicProvider (src/lib/services/storyllm/AnthropicProvider.ts)

- Target: Anthropic Messages API.
- Requires `ANTHROPIC_API_KEY` env var (missing key surfaces at `chat()` time, not at construction).
- Default model: `DEFAULT_ANTHROPIC_MODEL` constant; `DEFAULT_ANTHROPIC_MAX_TOKENS`.
- JSON mode via system prompt injection (Anthropic doesn't have a native JSON-constrain param).

---

# Key Paths

| Symbol | Path |
|---|---|
| `createInferenceClient` | `src/lib/inference/inferenceClient.ts` |
| `$lib/llr` shim | `src/lib/llr/index.ts` |
| `resolveStoryLlmProvider` | `src/lib/services/storyllm/index.ts` |
| `OllamaProvider` | `src/lib/services/storyllm/OllamaProvider.ts` |
| `AnthropicProvider` | `src/lib/services/storyllm/AnthropicProvider.ts` |
| `StubStoryLlmProvider` | `src/lib/services/storyllm/index.ts` |
| `llrChatFallback` re-export hub | `src/lib/kernel-contracts/helpers/llr-fallback.ts` |
| `defineKernelMirror` | `src/lib/kernel-contracts/helpers/define-kernel-mirror.ts` |

---

# Related Concepts

- [Story Author Service](/architecture/story-author.md) — primary consumer of `createInferenceClient`
- [No-Ollama-in-Browser Decision](/decisions/no-ollama-in-browser.md) — policy, rationale, and enforcement gap
