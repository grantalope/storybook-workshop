// $lib/llr for standalone storybook-workshop.
//
// The pachinko upstream $lib/llr is a WebLLM/ONNX browser runtime — heavy +
// browser-only. Storybook code routes LLM calls through inferenceClient which
// prefers kernel.connect (a no-op here — no kernel is booted in this repo),
// then falls back to llrChatFallback (this module's `llm`).
//
// CHAT IS REAL NOW: `llm.chat` routes to the active StoryLLM provider
// (resolveStoryLlmProvider — Ollama by default, Anthropic-swappable via
// STORY_LLM_PROVIDER, or `stub` to restore the old always-throw behavior).
// Either way, StoryAuthorService's deterministic template fallback remains the
// final safety net when the provider errors out.
//
// EMBEDDING remains a stub — no embedder is wired in this repo yet.

import {
	resolveStoryLlmProvider,
	type StoryLlmChatRequest,
	type StoryLlmMessage,
} from '$lib/services/storyllm';

export interface ChatRequest {
	messages: Array<{ role: string; content: string }>;
	temperature?: number;
	max_tokens?: number;
	json?: boolean;
}

export interface ChatResponse {
	content: string;
	finish_reason?: string;
	usage?: { input_tokens?: number; output_tokens?: number };
}

export interface EngineInfo {
	readonly backend: string;
	readonly modelId: string;
}

/**
 * Map the LLR ChatRequest shape onto the provider-agnostic StoryLLM request.
 *
 * - system-role messages are folded into the `system` field (providers place
 *   it correctly per backend: Ollama system message / Anthropic system param).
 * - JSON mode is detected from `json: true` OR the OpenAI-style
 *   `responseFormat: { type: 'json_object' }` hint StoryAuthorService sends.
 */
function toStoryLlmRequest(req: ChatRequest): StoryLlmChatRequest {
	const systemParts: string[] = [];
	const messages: StoryLlmMessage[] = [];
	for (const m of req.messages ?? []) {
		if (m.role === 'system') systemParts.push(m.content);
		else messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
	}
	const responseFormat = (req as { responseFormat?: { type?: string } }).responseFormat;
	const jsonMode = req.json === true || responseFormat?.type === 'json_object';
	return {
		system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
		messages,
		json: jsonMode || undefined,
		temperature: req.temperature,
		maxTokens: req.max_tokens,
	};
}

export const llm = {
	async chat(req: ChatRequest): Promise<ChatResponse> {
		const provider = resolveStoryLlmProvider();
		const out = await provider.chat(toStoryLlmRequest(req));
		return {
			content: out.content,
			finish_reason: 'stop',
			usage: out.usage
				? { input_tokens: out.usage.inputTokens, output_tokens: out.usage.outputTokens }
				: undefined,
		};
	},
	async engineInfo(): Promise<EngineInfo> {
		try {
			const provider = resolveStoryLlmProvider();
			const modelId = (provider as { model?: string }).model ?? provider.name;
			return { backend: `storyllm-${provider.name}`, modelId };
		} catch {
			return { backend: 'stub', modelId: 'stub' };
		}
	},
};

export const embedding = {
	async embed(_text: string): Promise<Float32Array> {
		throw new Error("Storybook standalone: $lib/llr.embedding.embed is a stub. Wire a real embedder.");
	},
	async embedBatch(_texts: string[]): Promise<Float32Array[]> {
		throw new Error("Storybook standalone: $lib/llr.embedding.embedBatch is a stub.");
	},
};

// --- Kernel-migration-helper re-export surface (standalone stubs) ---
// $lib/kernel-contracts/helpers/llr-fallback re-exports these. The pachinko
// upstream provides a real kernel runtime + engine status stores; the
// standalone storybook repo boots no kernel, so runtime/status are inert
// stubs. cosineSimilarity is real (pure math).

/** No-op runtime stub — no kernel is booted in standalone storybook. */
export const runtime = {
	async boot(): Promise<void> {},
	isReady(): boolean {
		return false;
	},
};

type LlrStatusStore = { subscribe: (run: (v: { phase: string }) => void) => () => void };
function inertStatusStore(): LlrStatusStore {
	return {
		subscribe: (run) => {
			run({ phase: 'idle' });
			return () => {};
		},
	};
}
/** Inert engine-status stores (no WebLLM telemetry in standalone). */
export const llmStatusStore: LlrStatusStore = inertStatusStore();
export const embeddingStatusStore: LlrStatusStore = inertStatusStore();

/** Pure cosine similarity over two numeric vectors. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb);
	return denom === 0 ? 0 : dot / denom;
}
