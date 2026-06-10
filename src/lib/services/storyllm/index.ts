// @graph-layer: private
// @rationale: private (server-side LLM provider boundary — story text generation)

// src/lib/services/storyllm/index.ts
//
// Provider factory + public barrel for the StoryLLM seam.
//
//   STORY_LLM_PROVIDER=ollama     → OllamaProvider   (DEFAULT — local dev path)
//   STORY_LLM_PROVIDER=anthropic  → AnthropicProvider (production-swappable)
//   STORY_LLM_PROVIDER=stub       → StubStoryLlmProvider (the pre-existing
//                                   throwing behavior; the deterministic
//                                   template fallback in StoryAuthorService
//                                   remains the final safety net)
//
// Any other value throws — misconfigured deploys fail LOUD (matches the
// $lib/env/production-config fail-closed convention) instead of silently
// running on an unintended backend.

import { AnthropicProvider } from './AnthropicProvider';
import { OllamaProvider } from './OllamaProvider';
import {
	readStoryLlmEnv,
	type FetchLike,
	type StoryLlmEnv,
	type StoryLlmProvider,
} from './types';

export type StoryLlmProviderKind = 'ollama' | 'anthropic' | 'stub';

/**
 * Preserves the original $lib/llr stub semantics: every chat throws, so the
 * inferenceClient chain falls through to the template fallback downstream.
 */
export class StubStoryLlmProvider implements StoryLlmProvider {
	readonly name = 'stub';

	async chat(): Promise<never> {
		throw new Error(
			'StoryLLM stub provider: no real LLM configured (STORY_LLM_PROVIDER=stub). ' +
				'Set STORY_LLM_PROVIDER=ollama or anthropic to enable LLM-written stories; ' +
				'the deterministic template fallback handles story synthesis meanwhile.',
		);
	}
}

export interface ResolveStoryLlmProviderOpts {
	/** Injectable HTTP boundary forwarded to the constructed provider. */
	fetchImpl?: FetchLike;
}

/**
 * Resolve the active StoryLLM provider from env.
 *
 * Construction is throw-free for the three known kinds (missing
 * ANTHROPIC_API_KEY surfaces at chat() time, not here) so importing modules
 * can resolve eagerly without crashing test/boot paths. An UNKNOWN kind
 * throws immediately — that is always a deploy misconfiguration.
 */
export function resolveStoryLlmProvider(
	env: StoryLlmEnv = readStoryLlmEnv(),
	opts: ResolveStoryLlmProviderOpts = {},
): StoryLlmProvider {
	const kind = (env.STORY_LLM_PROVIDER ?? 'ollama').trim().toLowerCase();
	switch (kind) {
		case 'ollama':
			return new OllamaProvider({ env, fetchImpl: opts.fetchImpl });
		case 'anthropic':
			return new AnthropicProvider({ env, fetchImpl: opts.fetchImpl });
		case 'stub':
			return new StubStoryLlmProvider();
		default:
			throw new Error(
				`STORY_LLM_PROVIDER='${kind}' is not recognized — expected 'ollama' | 'anthropic' | 'stub'`,
			);
	}
}

export * from './types';
export {
	OllamaProvider,
	DEFAULT_OLLAMA_MODEL,
	DEFAULT_OLLAMA_URL,
	type OllamaProviderOpts,
} from './OllamaProvider';
export {
	AnthropicProvider,
	ANTHROPIC_API_VERSION,
	DEFAULT_ANTHROPIC_BASE_URL,
	DEFAULT_ANTHROPIC_MAX_TOKENS,
	DEFAULT_ANTHROPIC_MODEL,
	type AnthropicProviderOpts,
} from './AnthropicProvider';
