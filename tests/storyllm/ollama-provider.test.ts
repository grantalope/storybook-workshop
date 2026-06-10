// tests/storyllm/ollama-provider.test.ts
//
// OllamaProvider against a mocked HTTP boundary:
//   - request shape (POST {base}/api/chat, model, system prepended, stream:false)
//   - json mode → format:"json"
//   - temperature/maxTokens → options.{temperature,num_predict}
//   - response parse + usage mapping
//   - bounded retries: transient failure then success; exhaustion; 4xx no-retry
//   - per-attempt timeout

import { describe, expect, it, vi } from 'vitest';

import { OllamaProvider } from '$lib/services/storyllm';
import { StoryLlmTimeoutError, type FetchLike } from '$lib/services/storyllm';

function okJson(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

const OLLAMA_OK = {
	message: { role: 'assistant', content: 'Once upon a time.' },
	prompt_eval_count: 42,
	eval_count: 17,
};

describe('OllamaProvider', () => {
	it('POSTs the documented /api/chat shape with the system prompt prepended', async () => {
		const fetchMock = vi.fn(async () => okJson(OLLAMA_OK));
		const provider = new OllamaProvider({
			env: { STORY_LLM_OLLAMA_URL: 'http://ollama.test:11434/', STORY_LLM_MODEL: 'gemma3:12b' },
			fetchImpl: fetchMock as unknown as FetchLike,
			retryDelayMs: 0,
		});

		await provider.chat({
			system: 'You are a kids-story author.',
			messages: [{ role: 'user', content: 'Write a story about a fox.' }],
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('http://ollama.test:11434/api/chat');
		expect(init.method).toBe('POST');
		const body = JSON.parse(String(init.body));
		expect(body.model).toBe('gemma3:12b');
		expect(body.stream).toBe(false);
		expect(body.messages).toEqual([
			{ role: 'system', content: 'You are a kids-story author.' },
			{ role: 'user', content: 'Write a story about a fox.' },
		]);
		expect(body.format).toBeUndefined();
	});

	it('maps json mode to format:"json" and tuning knobs to options', async () => {
		const fetchMock = vi.fn(async () => okJson(OLLAMA_OK));
		const provider = new OllamaProvider({
			env: {},
			fetchImpl: fetchMock as unknown as FetchLike,
			retryDelayMs: 0,
		});

		await provider.chat({
			messages: [{ role: 'user', content: 'JSON please' }],
			json: true,
			temperature: 0.4,
			maxTokens: 1234,
		});

		const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
		expect(body.format).toBe('json');
		expect(body.options).toEqual({ temperature: 0.4, num_predict: 1234 });
	});

	it('parses content + usage from the non-streaming response', async () => {
		const provider = new OllamaProvider({
			env: {},
			fetchImpl: (async () => okJson(OLLAMA_OK)) as FetchLike,
			retryDelayMs: 0,
		});

		const resp = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
		expect(resp.content).toBe('Once upon a time.');
		expect(resp.usage).toEqual({ inputTokens: 42, outputTokens: 17 });
	});

	it('retries a transient network failure and succeeds on the second attempt', async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('ECONNREFUSED'))
			.mockResolvedValueOnce(okJson(OLLAMA_OK));
		const provider = new OllamaProvider({
			env: {},
			fetchImpl: fetchMock as unknown as FetchLike,
			retryDelayMs: 0,
		});

		const resp = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
		expect(resp.content).toBe('Once upon a time.');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('bounds retries: 1 initial + maxRetries attempts, then rejects with the last error', async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error('ECONNREFUSED');
		});
		const provider = new OllamaProvider({
			env: {},
			fetchImpl: fetchMock as unknown as FetchLike,
			maxRetries: 2,
			retryDelayMs: 0,
		});

		await expect(
			provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toThrow(/ECONNREFUSED/);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('retries 5xx but throws 4xx immediately without retrying', async () => {
		// 4xx → single call, immediate throw
		const fetch400 = vi.fn(async () => new Response('bad request', { status: 400 }));
		const provider400 = new OllamaProvider({
			env: {},
			fetchImpl: fetch400 as unknown as FetchLike,
			retryDelayMs: 0,
		});
		await expect(
			provider400.chat({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toThrow(/HTTP 400/);
		expect(fetch400).toHaveBeenCalledTimes(1);

		// 5xx → retried, then succeeds
		const fetch500 = vi
			.fn()
			.mockResolvedValueOnce(new Response('boom', { status: 500 }))
			.mockResolvedValueOnce(okJson(OLLAMA_OK));
		const provider500 = new OllamaProvider({
			env: {},
			fetchImpl: fetch500 as unknown as FetchLike,
			retryDelayMs: 0,
		});
		const resp = await provider500.chat({ messages: [{ role: 'user', content: 'hi' }] });
		expect(resp.content).toBe('Once upon a time.');
		expect(fetch500).toHaveBeenCalledTimes(2);
	});

	it('aborts a hung request after timeoutMs and surfaces a timeout error', async () => {
		// fetch that never settles until aborted
		const hangingFetch: FetchLike = (_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
				);
			});
		const provider = new OllamaProvider({
			env: {},
			fetchImpl: hangingFetch,
			timeoutMs: 20,
			maxRetries: 0,
			retryDelayMs: 0,
		});

		await expect(
			provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toBeInstanceOf(StoryLlmTimeoutError);
	});
});
