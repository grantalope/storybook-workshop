// tests/storyllm/provider-factory.test.ts
//
// resolveStoryLlmProvider() env-driven selection:
//   - default (unset) → OllamaProvider
//   - ollama / anthropic / stub explicit selection (case-insensitive)
//   - stub preserves the legacy throwing behavior
//   - unknown value fails LOUD

import { describe, expect, it } from 'vitest';

import {
	AnthropicProvider,
	OllamaProvider,
	StubStoryLlmProvider,
	resolveStoryLlmProvider,
} from '$lib/services/storyllm';

describe('resolveStoryLlmProvider', () => {
	it('defaults to OllamaProvider when STORY_LLM_PROVIDER is unset', () => {
		const provider = resolveStoryLlmProvider({});
		expect(provider).toBeInstanceOf(OllamaProvider);
		expect(provider.name).toBe('ollama');
	});

	it('returns AnthropicProvider for STORY_LLM_PROVIDER=anthropic (case-insensitive)', () => {
		expect(resolveStoryLlmProvider({ STORY_LLM_PROVIDER: 'anthropic' })).toBeInstanceOf(
			AnthropicProvider,
		);
		expect(resolveStoryLlmProvider({ STORY_LLM_PROVIDER: ' Anthropic ' })).toBeInstanceOf(
			AnthropicProvider,
		);
	});

	it('returns the throwing stub for STORY_LLM_PROVIDER=stub (template fallback safety net)', async () => {
		const provider = resolveStoryLlmProvider({ STORY_LLM_PROVIDER: 'stub' });
		expect(provider).toBeInstanceOf(StubStoryLlmProvider);
		await expect(
			provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
		).rejects.toThrow(/stub provider/i);
	});

	it('throws loudly on an unrecognized provider kind', () => {
		expect(() => resolveStoryLlmProvider({ STORY_LLM_PROVIDER: 'openai' })).toThrow(
			/not recognized/i,
		);
	});

	it('threads env model config through to the constructed Ollama provider', () => {
		const provider = resolveStoryLlmProvider({
			STORY_LLM_MODEL: 'qwen2.5:14b',
		}) as OllamaProvider;
		expect(provider.model).toBe('qwen2.5:14b');
	});
});
