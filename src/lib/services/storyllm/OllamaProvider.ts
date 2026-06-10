// @graph-layer: private
// @rationale: private (server-side LLM provider boundary — story text generation)

// src/lib/services/storyllm/OllamaProvider.ts
//
// StoryLLM provider backed by a local Ollama daemon (`POST {base}/api/chat`,
// non-streaming). This is the "now" provider: claude.local has gemma3:12b +
// qwen2.5-coder:14b pulled, so stories become genuinely LLM-written in dev
// without any cloud key.
//
// Env contract:
//   STORY_LLM_OLLAMA_URL  — base URL (default http://localhost:11434)
//   STORY_LLM_MODEL       — model tag (default gemma3:12b)
//
// Behavior:
//   - JSON mode → Ollama `format: "json"` constrained decoding.
//   - temperature / maxTokens → `options.temperature` / `options.num_predict`.
//   - Bounded retries (default 2 retries after the first attempt) on network
//     errors, timeouts, 429 and 5xx. 4xx are thrown immediately (caller bug —
//     retrying an invalid request can never succeed).
//   - Hard per-attempt timeout (default 120s) via AbortController.

import {
	STORY_LLM_DEFAULT_MAX_RETRIES,
	STORY_LLM_DEFAULT_TIMEOUT_MS,
	fetchWithTimeout,
	isRetryableHttpStatus,
	readStoryLlmEnv,
	storyLlmSleep,
	type FetchLike,
	type StoryLlmChatRequest,
	type StoryLlmChatResponse,
	type StoryLlmEnv,
	type StoryLlmMessage,
	type StoryLlmProvider,
} from './types';

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'gemma3:12b';

export interface OllamaProviderOpts {
	/** Base URL (overrides STORY_LLM_OLLAMA_URL). */
	baseUrl?: string;
	/** Model tag (overrides STORY_LLM_MODEL). */
	model?: string;
	/** Injectable HTTP boundary — tests pass a mock. Default: global fetch. */
	fetchImpl?: FetchLike;
	/** Per-attempt timeout in ms (default 120_000). */
	timeoutMs?: number;
	/** Bounded retries after the first attempt (default 2). */
	maxRetries?: number;
	/** Delay between retries in ms (default 250; tests pass 0). */
	retryDelayMs?: number;
	/** Env snapshot override (default: process.env). */
	env?: StoryLlmEnv;
}

/** Shape of Ollama's non-streaming /api/chat response (subset we read). */
interface OllamaChatResponseBody {
	message?: { role?: string; content?: unknown };
	prompt_eval_count?: number;
	eval_count?: number;
}

export class OllamaProvider implements StoryLlmProvider {
	readonly name = 'ollama';

	private readonly _baseUrl: string;
	private readonly _model: string;
	private readonly _fetch?: FetchLike;
	private readonly _timeoutMs: number;
	private readonly _maxRetries: number;
	private readonly _retryDelayMs: number;

	constructor(opts: OllamaProviderOpts = {}) {
		const env = opts.env ?? readStoryLlmEnv();
		this._baseUrl = (opts.baseUrl ?? env.STORY_LLM_OLLAMA_URL ?? DEFAULT_OLLAMA_URL).replace(
			/\/+$/,
			'',
		);
		this._model = opts.model ?? env.STORY_LLM_MODEL ?? DEFAULT_OLLAMA_MODEL;
		this._fetch = opts.fetchImpl;
		this._timeoutMs = opts.timeoutMs ?? STORY_LLM_DEFAULT_TIMEOUT_MS;
		this._maxRetries = opts.maxRetries ?? STORY_LLM_DEFAULT_MAX_RETRIES;
		this._retryDelayMs = opts.retryDelayMs ?? 250;
	}

	/** Resolved model tag (exposed for telemetry / engineInfo). */
	get model(): string {
		return this._model;
	}

	async chat(req: StoryLlmChatRequest): Promise<StoryLlmChatResponse> {
		const messages: StoryLlmMessage[] = [];
		if (req.system && req.system.length > 0) {
			messages.push({ role: 'system', content: req.system });
		}
		messages.push(...req.messages);

		const body: Record<string, unknown> = {
			model: this._model,
			messages,
			stream: false,
		};
		if (req.json) body.format = 'json';
		const options: Record<string, number> = {};
		if (req.temperature !== undefined) options.temperature = req.temperature;
		if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;
		if (Object.keys(options).length > 0) body.options = options;

		// Resolve fetch at call time so vitest's vi.stubGlobal('fetch', ...) works.
		const fetchImpl: FetchLike = this._fetch ?? (globalThis.fetch as FetchLike);
		if (typeof fetchImpl !== 'function') {
			throw new Error('OllamaProvider: no fetch implementation available');
		}

		const url = `${this._baseUrl}/api/chat`;
		let lastErr: unknown;

		for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
			if (attempt > 0) await storyLlmSleep(this._retryDelayMs);

			let resp: Response;
			try {
				resp = await fetchWithTimeout(
					fetchImpl,
					url,
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body),
					},
					this._timeoutMs,
				);
			} catch (err) {
				// Network refused / DNS / timeout — transient, retry.
				lastErr = err;
				continue;
			}

			if (!resp.ok) {
				const text = await resp.text().catch(() => '');
				const httpErr = new Error(
					`OllamaProvider: ${url} returned HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
				);
				if (isRetryableHttpStatus(resp.status)) {
					lastErr = httpErr;
					continue;
				}
				throw httpErr; // 4xx — never retry
			}

			let data: OllamaChatResponseBody;
			try {
				data = (await resp.json()) as OllamaChatResponseBody;
			} catch (err) {
				lastErr = new Error(
					`OllamaProvider: non-JSON response from ${url}: ${(err as Error).message}`,
				);
				continue;
			}

			const content = data?.message?.content;
			if (typeof content !== 'string') {
				throw new Error('OllamaProvider: malformed /api/chat response (missing message.content)');
			}

			return {
				content,
				usage: {
					inputTokens: typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : undefined,
					outputTokens: typeof data.eval_count === 'number' ? data.eval_count : undefined,
				},
			};
		}

		throw lastErr instanceof Error
			? lastErr
			: new Error(`OllamaProvider: retries exhausted calling ${url}`);
	}
}
