// @graph-layer: private
// @rationale: private (server-side LLM provider boundary — story text generation)

// src/lib/services/storyllm/types.ts
//
// StoryLLM provider contract. The story-author path
// (StoryAuthorService → inferenceClient → llrChatFallback) historically dead-
// ended in the $lib/llr stub, which THREW on every chat — meaning every story
// was synthesized by the deterministic template fallback and never LLM-written.
//
// This module defines the provider seam that fixes that:
//   - `StoryLlmProvider` — minimal chat surface every backend implements.
//   - `OllamaProvider` (local dev / claude.local — gemma3:12b et al).
//   - `AnthropicProvider` (production-swappable — Messages API).
//   - stub (preserves the old throwing behavior; template fallback remains the
//     final safety net downstream).
//
// Network IO follows the repo's injectable-HTTP-boundary convention (see
// $lib/services/fulfillment/StripeCheckoutService.ts): providers accept a
// `fetchImpl` and tests pass an in-memory mock; production uses global fetch.

/** Roles accepted on a StoryLLM message. */
export type StoryLlmRole = 'system' | 'user' | 'assistant';

export interface StoryLlmMessage {
	role: StoryLlmRole;
	content: string;
}

/** Provider-agnostic chat request. */
export interface StoryLlmChatRequest {
	/** Optional system prompt (providers merge any system-role messages into this). */
	system?: string;
	messages: StoryLlmMessage[];
	/** JSON mode — Ollama maps to `format: "json"`; Anthropic gets a hard system instruction. */
	json?: boolean;
	temperature?: number;
	maxTokens?: number;
}

export interface StoryLlmUsage {
	inputTokens?: number;
	outputTokens?: number;
}

export interface StoryLlmChatResponse {
	content: string;
	usage?: StoryLlmUsage;
}

/** The provider contract. */
export interface StoryLlmProvider {
	/** Stable identifier: 'ollama' | 'anthropic' | 'stub'. */
	readonly name: string;
	chat(req: StoryLlmChatRequest): Promise<StoryLlmChatResponse>;
}

/** Injectable HTTP boundary (tests pass a mock; production uses global fetch). */
export type FetchLike = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

/** Loose env-snapshot shape (mirrors $lib/env/production-config readEnv). */
export interface StoryLlmEnv {
	[key: string]: string | undefined;
}

/** Read process.env safely (returns {} in non-Node contexts). */
export function readStoryLlmEnv(): StoryLlmEnv {
	return (typeof process !== 'undefined' && process.env ? process.env : {}) as StoryLlmEnv;
}

/** Default per-attempt HTTP timeout (ms). Story generation on a 12B local model is slow. */
export const STORY_LLM_DEFAULT_TIMEOUT_MS = 120_000;

/** Default bounded retry count (retries AFTER the first attempt). */
export const STORY_LLM_DEFAULT_MAX_RETRIES = 2;

/** Thrown when a single provider HTTP attempt exceeds its timeout. */
export class StoryLlmTimeoutError extends Error {
	constructor(ms: number) {
		super(`StoryLLM: provider request timed out after ${ms}ms`);
		this.name = 'StoryLlmTimeoutError';
	}
}

/** Retry only transient failures: rate limit + server errors. 4xx are caller bugs. */
export function isRetryableHttpStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

/**
 * fetch with a hard per-attempt timeout via AbortController. On timeout the
 * returned promise rejects with {@link StoryLlmTimeoutError}; other fetch
 * rejections (network refused, DNS) pass through verbatim.
 */
export async function fetchWithTimeout(
	fetchImpl: FetchLike,
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	// Don't keep a Node test process alive on the timer (no-op in browsers).
	(timer as { unref?: () => void }).unref?.();
	try {
		return await fetchImpl(url, { ...init, signal: ctrl.signal });
	} catch (err) {
		if (ctrl.signal.aborted) throw new StoryLlmTimeoutError(timeoutMs);
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

/** Tiny await-able sleep used between bounded retries. */
export function storyLlmSleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => {
		const t = setTimeout(resolve, ms);
		(t as { unref?: () => void }).unref?.();
	});
}
