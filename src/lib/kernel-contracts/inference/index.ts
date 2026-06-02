// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

export { INFERENCE_CONTRACTS } from './contracts';
export {
  createLLMGenerateAdapter,
  type LLMSurfaceLike,
  type LLMGenerateAdapter,
} from './adapters/llm-generate';
export {
  createEmbedTextAdapter,
  type EmbeddingSurfaceLike,
  type EmbedTextAdapter,
} from './adapters/embed-text';
export {
  createEmbedImageAdapter,
  type EmbedImageAdapter,
} from './adapters/embed-image';
export {
  createPrivacyScrubAdapter,
  type PrivacyFilterLike,
  type PrivacyScrubAdapter,
} from './adapters/privacy-scrub';
export { llrRuntimeManifest } from './manifests/llr-runtime-manifest';
export {
  boot as bootLLRRuntimeProvider,
  createKernelInferenceProvider,
  type LLRBridge,
} from './manifests/llr-runtime-process';
export * from './kv-cache-os';
