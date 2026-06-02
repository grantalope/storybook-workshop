// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

// src/kernel/kids-content-safety/index.ts
//
// Public barrel for the kernel-side kids-content-safety surface. Consumers
// (AppOrchestrator + tests) import contracts + manifest from here.

export {
    KIDS_CONTENT_SAFETY_CONTRACTS,
    type KidsContentSafetyPort,
} from './contracts';
export { kidsContentSafetyManifest } from './manifests';
