// LLR stub for storybook-workshop kernel-contracts scaffolding

export interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  timeoutMs?: number;
  [key: string]: unknown;
}

export interface ChatResponse {
  content?: string;
  [key: string]: unknown;
}

export interface EngineInfo {
  name: string;
  ready: boolean;
}

export class LLRRuntime {
  chat(req: ChatRequest): Promise<ChatResponse> { return Promise.resolve({}); }
  chatStream(req: ChatRequest): AsyncIterable<string> { return this._emptyAsyncIter(); }
  embed(text: string): Promise<number[]> { return Promise.resolve([]); }
  embedImage(image: unknown): Promise<number[]> { return Promise.resolve([]); }
  scrub(text: string): Promise<string> { return Promise.resolve(text); }
  engineInfo(): Promise<EngineInfo> { return Promise.resolve({ name: 'stub', ready: false }); }
  
  private async *_emptyAsyncIter(): AsyncIterable<string> {}
}

export const runtime = new LLRRuntime();
export const llm = runtime;
export const embedding = runtime;

// Status stores
export const llmStatusStore = {
  subscribe: (fn: (x: unknown) => void) => { fn({ ready: false }); return () => {}; }
};

export const embeddingStatusStore = {
  subscribe: (fn: (x: unknown) => void) => { fn({ ready: false }); return () => {}; }
};

export function cosineSimilarity(a: number[], b: number[]): number {
  return 0;
}

export function* readAsStream(): Generator<string, void, unknown> {
  // no-op
}
