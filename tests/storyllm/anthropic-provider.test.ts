// tests/storyllm/anthropic-provider.test.ts
//
// AnthropicProvider against a mocked HTTP boundary:
//   - real Messages API request shape (URL, x-api-key, anthropic-version,
//     model default claude-sonnet-4-6, required max_tokens, system param)
//   - system-role messages merged into the system param
//   - json mode → hard JSON-only system instruction
//   - response parse (text blocks join) + usage mapping
//   - missing ANTHROPIC_API_KEY → clear error at chat() time
//   - 429 retried with bounded retries

import { describe, expect, it, vi } from 'vitest';

import {
	ANTHROPIC_API_VERSION,
	AnthropicProvider,
	DEFAULT_ANTHROPIC_MODEL,
	type FetchLike,
} from '$lib/services/storyllm';

function okJson(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

const ANTHROPIC_OK = {
	content: [
		{ type: 'text', text: 'Once upon ' },
		{ type: 'text', text: 'a time.' },
	],
	usage: { input_tokens: 99, output_tokens: 33 },
};

describe('AnthropicProvider', () => {
	it('POSTs the real Messages API shape with auth headers and default model', async () => {
		const fetchMock = vi.fn(async () => okJson(ANTHROPIC_OK));
		const provider = new AnthropicProvider({
			env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
			fetchImpl: fetchMock as unknown as FetchLike,
			retryDelayMs: 0,
		});

		await provider.chat({
			system: 'You are a kids-story author.',
			messages: [
				{ role: 'system', content: 'Stay age-appropriate.' },
				{ role: 'user', content: 'Write a story about a fox.' },
			],
			temperature: 0.7,
			maxTokens: 2000,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.anthropic.com/v1/messages');
		expect(init.method).toBe('POST');
		const headers = init.headers as Record<string, string>;
		expect(headers['x-api-key']).toBe('sk-ant-test');
		expect(headers['anthropic-version']).toBe(ANTHROPIC_API_VERSION);
		const body = JSON.parse(String(init.body));
		expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL);
		expect(body.max_tokens).toBe(2000);
		expect(body.temperature).toBe(0.7);
		// system-role message merged into the system param; messages user/assistant only
		expect(body.system).toContain('You are a kids-story author.');
		expect(body.system).toContain('Stay age-appropriate.');
		expect(body.messages).toEqual([{ role: 'user', content: 'Write a story about a fox.' }]);
	});

	it('json mode appends a JSON-only instruction to the system param', async () => {
		const fetchMock = vi.fn(async () => okJson(ANTHROPIC_OK));
		const provider = new AnthropicProvider({
			env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
			fetchImpl: fetchMock as unknown as FetchLike,
			retryDelayMs: 0,
		});

		await provider.chat({
			messages: [{ role: 'user', content: 'JSON please' }],
			json: true,
		});

		const body = JSON.parse(
			String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
		);
		expect(body.system).toMatch(/ONLY a single valid JSON object/i);
		// max_tokens is REQUIRED by the API — default applied when unset
		expect(typeof body.max_tokens).toBe('number');
		expect(body.max_tokens).toBeGreaterThan(0);
	});

	it('joins text blocks and maps usage on parse', async () => {
		const provider = new AnthropicProvider({
			env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
			fetchImpl: (async () => okJson(ANTHROPIC_OK)) as FetchLike,
			retryDelayMs: 0,
		});

		const resp = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
		expect(resp.content).toBe('Once upon a time.');
		expect(resp.usage).toEqual({ inputTokens: 99, outputTokens: 33 });
	});

	it('throws a clear error at chat() time when ANTHROPIC_API_KEY is missing', async () => {
		const fetchMock = vi.fn();
		const provider = new AnthropicProvider({
			env: {},
			fetchImpl: fetchMock as unknown as FetchLike,
			retryDelayMs: 0,
		});

		await expect(
			provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toThrow(/ANTHROPIC_API_KEY/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('retries 429 rate limits but throws 401 immediately', async () => {
		const fetch429 = vi
			.fn()
			.mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
			.mockResolvedValueOnce(okJson(ANTHROPIC_OK));
		const provider = new AnthropicProvider({
			env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
			fetchImpl: fetch429 as unknown as FetchLike,
			retryDelayMs: 0,
		});
		const resp = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
		expect(resp.content).toBe('Once upon a time.');
		expect(fetch429).toHaveBeenCalledTimes(2);

		const fetch401 = vi.fn(async () => new Response('unauthorized', { status: 401 }));
		const badKey = new AnthropicProvider({
			env: { ANTHROPIC_API_KEY: 'sk-ant-bad' },
			fetchImpl: fetch401 as unknown as FetchLike,
			retryDelayMs: 0,
		});
		await expect(badKey.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
			/HTTP 401/,
		);
		expect(fetch401).toHaveBeenCalledTimes(1);
	});

	it('honors STORY_LLM_ANTHROPIC_MODEL env override', async () => {
		const fetchMock = vi.fn(async () => okJson(ANTHROPIC_OK));
		const provider = new AnthropicProvider({
			env: { ANTHROPIC_API_KEY: 'sk-ant-test', STORY_LLM_ANTHROPIC_MODEL: 'claude-haiku-4-5' },
			fetchImpl: fetchMock as unknown as FetchLike,
			retryDelayMs: 0,
		});
		await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
		const body = JSON.parse(
			String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
		);
		expect(body.model).toBe('claude-haiku-4-5');
	});
});
