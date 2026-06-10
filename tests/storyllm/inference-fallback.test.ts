// tests/storyllm/inference-fallback.test.ts
//
// End-to-end wiring of the StoryLLM seam into the existing inference chain:
//   - $lib/llr `llm.chat` (a.k.a. llrChatFallback) now reaches the resolved
//     provider instead of throwing
//   - StoryAuthorService's OpenAI-style responseFormat json hint maps to
//     Ollama json mode
//   - createInferenceClient (kernel absent in vitest) falls back through
//     llrChatFallback to the provider
//   - templateFallback STILL fires as the final safety net when the provider
//     errors on every attempt
//   - STORY_LLM_PROVIDER=stub restores the legacy throwing behavior

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { llm, type ChatRequest } from '$lib/llr';
import { createInferenceClient } from '$lib/inference/inferenceClient';
import { StoryAuthorService, type KidsContentSafetyLike } from '$lib/services/author/StoryAuthorService';
import type { StoryInput } from '$lib/services/author/types';

// Keep the privacy filter deterministic + fast in node tests.
vi.mock('$lib/privacy/PrivacyFilterService', () => ({
	privacyFilterService: {
		scrub: vi.fn(async (text: string) => ({
			detections: [],
			redactedText: text,
			hardFail: false,
			inferenceMs: 0,
			backend: 'stub',
		})),
	},
}));

const PERMISSIVE_SAFETY: KidsContentSafetyLike = {
	async scan() {
		return { passed: true, categories: [], confidence: 0 };
	},
};

function baseInput(over: Partial<StoryInput> = {}): StoryInput {
	return {
		kidName: 'Eli',
		ageBand: 'preschool',
		ehriPhase: 'partial-alphabetic',
		theme: 'overcoming-fear',
		occasion: 'just-because',
		sidekickSettlerId: 'sidekick-1',
		supportingCast: [],
		localeBiome: 'forest',
		targetSpreads: 24,
		dedicationText: '',
		dialogicPromptsEnabled: true,
		easierReadingMode: false,
		...over,
	};
}

function okOllama(content: string): Response {
	return new Response(
		JSON.stringify({
			message: { role: 'assistant', content },
			prompt_eval_count: 10,
			eval_count: 5,
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } },
	);
}

const ENV_KEYS = ['STORY_LLM_PROVIDER', 'STORY_LLM_OLLAMA_URL', 'STORY_LLM_MODEL'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	savedEnv = {};
	for (const k of ENV_KEYS) {
		savedEnv[k] = process.env[k];
		delete process.env[k];
	}
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	vi.unstubAllGlobals();
});

describe('inference chain → StoryLLM provider', () => {
	it('llm.chat (llrChatFallback) reaches the Ollama provider instead of throwing', async () => {
		const fetchMock = vi.fn(async () => okOllama('A real LLM-written line.'));
		vi.stubGlobal('fetch', fetchMock);

		const resp = await llm.chat({
			messages: [
				{ role: 'system', content: 'You write kids stories.' },
				{ role: 'user', content: 'One line please.' },
			],
		});

		expect(resp.content).toBe('A real LLM-written line.');
		expect(resp.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('http://localhost:11434/api/chat');
		const body = JSON.parse(String(init.body));
		// system folded back in as an Ollama system message
		expect(body.messages[0]).toEqual({ role: 'system', content: 'You write kids stories.' });
	});

	it("maps StoryAuthorService's responseFormat json_object hint to Ollama json mode", async () => {
		const fetchMock = vi.fn(async () => okOllama('{"ok":true}'));
		vi.stubGlobal('fetch', fetchMock);

		const req = {
			messages: [{ role: 'user', content: 'Return JSON.' }],
			responseFormat: { type: 'json_object' },
		} as unknown as ChatRequest;
		await llm.chat(req);

		const body = JSON.parse(
			String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
		);
		expect(body.format).toBe('json');
	});

	it('createInferenceClient falls back through llrChatFallback to the provider (no kernel)', async () => {
		const fetchMock = vi.fn(async () => okOllama('via inference client'));
		vi.stubGlobal('fetch', fetchMock);

		const inf = createInferenceClient('storyllm-test');
		const resp = await inf.chat({ messages: [{ role: 'user', content: 'hello' }] });

		expect(resp.content).toBe('via inference client');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('templateFallback still fires when the provider errors on every attempt', async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error('ECONNREFUSED');
		});
		vi.stubGlobal('fetch', fetchMock);

		const svc = new StoryAuthorService();
		const tree = await svc.author(baseInput(), { safetyOverride: PERMISSIVE_SAFETY });

		expect(tree.meta?.template_fallback).toBe(true);
		// the provider was actually attempted (author retries × provider retries)
		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
		// structurally valid book despite total LLM outage
		const spreadCount = tree.beats
			.flatMap((b) => b.scenes)
			.reduce((acc, s) => acc + s.spreads.length, 0);
		expect(spreadCount).toBe(24);
	}, 30_000);

	it('STORY_LLM_PROVIDER=stub restores the legacy throwing behavior end-to-end', async () => {
		process.env.STORY_LLM_PROVIDER = 'stub';
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			llm.chat({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toThrow(/stub provider/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
