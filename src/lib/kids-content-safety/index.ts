// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/kids-content-safety/index.ts
//
// Public barrel. Workshop callers import from this file only — the file
// layout under `backends/` is an implementation detail.

export * from './types';
export {
    KidsContentSafetyService,
    kidsContentSafetyService,
} from './KidsContentSafetyService';
export {
    KidsContentSafetyAudit,
    kidsContentSafetyAudit,
} from './KidsContentSafetyAudit';
export {
    KidsContentSafetyBackendStub,
    stubScan,
    stubWarmup,
    STUB_KEYWORD_COUNT,
} from './backends/KidsContentSafetyBackendStub';
export {
    KidsContentSafetyBackendWASM,
    wasmWarmup,
    wasmScan,
    KIDS_SAFETY_WASM_MODEL_URL,
    KIDS_SAFETY_WASM_TOKENIZER_URL,
} from './backends/KidsContentSafetyBackendWASM';
export {
    KidsContentSafetyBackendWebGPU,
    webgpuWarmup,
    webgpuScan,
} from './backends/KidsContentSafetyBackendWebGPU';
export {
    KidsContentSafetyBackendOllama,
    ollamaWarmup,
    ollamaScan,
    KIDS_SAFETY_OLLAMA_URL,
    KIDS_SAFETY_OLLAMA_MODEL,
} from './backends/KidsContentSafetyBackendOllama';
