// @graph-layer: private
// @rationale: private (server-side LLM provider boundary — story text generation)

// src/lib/services/storyllm/AnthropicProvider.ts
//
// StoryLLM provider backed by the Anthropic Messages API
// (`POST {base}/v1/messages`). This is the swappable production provider —
// flip STORY_LLM_PROVIDER=anthropic + set ANTHROPIC_API_KEY and the exact same
// story-author path runs on Claude instead of local Ollama.
//
// Wire shape follows the real Messages API:
//   headers: x-api-key, anthropic-version: 2023-06-01, content-type
//   body:    { model, max_tokens, system?, messages, temperature? }
//   resp:    { content: [{ type: "text", text }...], usage: { input_tokens, output_tokens } }
//
// Env contract:
//   ANTHROPIC_API_KEY          — required at chat() time (NOT construction —
//                                resolveStoryLlmProvider must stay throw-free).
//   STORY_LLM_ANTHROPIC_MODEL  — model id (default claude-sonnet-4-6).
//
// JSON mode: the Messages API has no bare json_object format (structured
// outputs need a schema we don't have at this seam), so json:true appends a
// hard "ONLY a single valid JSON object" system instruction. The downstream
// schema validator in StoryAuthorService defends against drift either way.
//
// Notes:
//   - System-role messages in `req.messages` are merged into the top-level
//     `system` param (the Messages API rejects system-role entries in messages).
//   - max_tokens is REQUIRED by the API — defaults to 4096 when unset.
//   - Bounded retries (default 2) on network errors, timeouts, 429 and 5xx;
//     4xx (auth, validation) throw immediately.

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
	type StoryLlmProvider,
} from './types';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_API_VERSION = '2023-06-01';
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

const JSON_MODE_INSTRUCTION =
	'Respond with ONLY a single valid JSON object. No prose before or after it, no markdown code fences.';

export interface AnthropicProviderOpts {
	/** API key (overrides ANTHROPIC_API_KEY). */
	apiKey?: string;
	/** Model id (overrides STORY_LLM_ANTHROPIC_MODEL; default claude-sonnet-4-6). */
	model?: string;
	/** Base URL (default https://api.anthropic.com). */
	baseUrl?: string;
	/** Injectable HTTP boundary — tests pass a mock. Default: global fetch. */
	fetchImpl?: FetchLike;
	/** Per-attempt timeout in ms (default 120_000). */
	timeoutMs?: number;
	/** Bounded retries after the first attempt (default 2). */
	maxRetries?: number;
	/** Delay between retries in ms (default 250; tests pass 0). */
	retryDelayMs?: number;
	/** Default max_tokens when the request doesn't specify one (default 4096). */
	defaultMaxTokens?: number;
	/** Env snapshot override (default: process.env). */
	env?: StoryLlmEnv;
}

/** Subset of the Messages API response we read. */
interface AnthropicMessagesResponseBody {
	content?: Array<{ type?: string; text?: unknown }>;
	usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider implements StoryLlmProvider {
	readonly name = 'anthropic';

	private readonly _apiKey: string | undefined;
	private readonly _model: string;
	private readonly _baseUrl: string;
	private readonly _fetch?: FetchLike;
	private readonly _timeoutMs: number;
	private readonly _maxRetries: number;
	private readonly _retryDelayMs: number;
	private readonly _defaultMaxTokens: number;

	constructor(opts: AnthropicProviderOpts = {}) {
		const env = opts.env ?? readStoryLlmEnv();
		this._apiKey = opts.apiKey ?? env.ANTHROPIC_API_KEY;
		this._model = opts.model ?? env.STORY_LLM_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
		this._baseUrl = (opts.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, '');
		this._fetch = opts.fetchImpl;
		this._timeoutMs = opts.timeoutMs ?? STORY_LLM_DEFAULT_TIMEOUT_MS;
		this._maxRetries = opts.maxRetries ?? STORY_LLM_DEFAULT_MAX_RETRIES;
		this._retryDelayMs = opts.retryDelayMs ?? 250;
		this._defaultMaxTokens = opts.defaultMaxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS;
	}

	/** Resolved model id (exposed for telemetry / engineInfo). */
	get model(): string {
		return this._model;
	}

	async chat(req: StoryLlmChatRequest): Promise<StoryLlmChatResponse> {
		if (!this._apiKey) {
			throw new Error(
				'AnthropicProvider: ANTHROPIC_API_KEY is not set — set it or switch STORY_LLM_PROVIDER to ollama/stub',
			);
		}

		// Merge system sources: req.system, system-role messages, JSON instruction.
		const systemParts: string[] = [];
		if (req.system && req.system.length > 0) systemParts.push(req.system);
		const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
		for (const m of req.messages) {
			if (m.role === 'system') systemParts.push(m.content);
			else messages.push({ role: m.role, content: m.content });
		}
		if (req.json) systemParts.push(JSON_MODE_INSTRUCTION);

		if (messages.length === 0) {
			throw new Error('AnthropicProvider: at least one user/assistant message is required');
		}

		const body: Record<string, unknown> = {
			model: this._model,
			max_tokens: req.maxTokens ?? this._defaultMaxTokens,
			messages,
		};
		if (systemParts.length > 0) body.system = systemParts.join('\n\n');
		if (req.temperature !== undefined) body.temperature = req.temperature;

		// Resolve fetch at call time so vitest's vi.stubGlobal('fetch', ...) works.
		const fetchImpl: FetchLike = this._fetch ?? (globalThis.fetch as FetchLike);
		if (typeof fetchImpl !== 'function') {
			throw new Error('AnthropicProvider: no fetch implementation available');
		}

		const url = `${this._baseUrl}/v1/messages`;
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
						headers: {
							'content-type': 'application/json',
							'x-api-key': this._apiKey,
							'anthropic-version': ANTHROPIC_API_VERSION,
						},
						body: JSON.stringify(body),
					},
					this._timeoutMs,
				);
			} catch (err) {
				lastErr = err;
				continue;
			}

			if (!resp.ok) {
				const text = await resp.text().catch(() => '');
				const httpErr = new Error(
					`AnthropicProvider: ${url} returned HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
				);
				if (isRetryableHttpStatus(resp.status)) {
					lastErr = httpErr;
					continue;
				}
				throw httpErr; // 4xx (auth/validation) — never retry
			}

			let data: AnthropicMessagesResponseBody;
			try {
				data = (await resp.json()) as AnthropicMessagesResponseBody;
			} catch (err) {
				lastErr = new Error(
					`AnthropicProvider: non-JSON response from ${url}: ${(err as Error).message}`,
				);
				continue;
			}

			const blocks = Array.isArray(data?.content) ? data.content : null;
			if (!blocks) {
				throw new Error('AnthropicProvider: malformed Messages API response (missing content[])');
			}
			const content = blocks
				.filter((b) => b?.type === 'text' && typeof b.text === 'string')
				.map((b) => b.text as string)
				.join('');

			return {
				content,
				usage: {
					inputTokens:
						typeof data.usage?.input_tokens === 'number' ? data.usage.input_tokens : undefined,
					outputTokens:
						typeof data.usage?.output_tokens === 'number' ? data.usage.output_tokens : undefined,
				},
			};
		}

		throw lastErr instanceof Error
			? lastErr
			: new Error(`AnthropicProvider: retries exhausted calling ${url}`);
	}
}
