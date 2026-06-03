// Stub for standalone storybook-workshop.
// The pachinko upstream $lib/llr is a WebLLM/ONNX browser runtime — heavy + browser-only.
// Storybook code routes LLM calls through inferenceClient which prefers kernel.connect, then
// falls back to llrChatFallback/llrEmbedFallback (these stubs). For production deployment,
// swap with a real Anthropic/OpenAI client or browser WebLLM driver.

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

export const llm = {
	async chat(_req: ChatRequest): Promise<ChatResponse> {
		throw new Error("Storybook standalone: $lib/llr.llm.chat is a stub. Wire a real LLM client (Anthropic/OpenAI/WebLLM) or replace inferenceClient defaults.");
	},
	async engineInfo(): Promise<EngineInfo> {
		return { backend: "stub", modelId: "stub" };
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
