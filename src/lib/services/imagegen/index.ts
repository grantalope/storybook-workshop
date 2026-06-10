// @graph-layer: private
// @rationale: private (imagegen barrel + env-driven provider factory)
//
// src/lib/services/imagegen/index.ts
//
// Public barrel for the swappable image-generation subsystem.
//
// Provider selection is env-driven:
//
//   IMAGE_GEN_PROVIDER       local | cloud | mock   (default: mock)
//   IMAGE_GEN_SERVER_URL     ComfyUI base URL for `local`
//                            (default http://100.101.215.25:8188 — the 4090
//                            box over Tailscale)
//   IMAGE_GEN_CLOUD_API_KEY  fal.ai key, required for `cloud`

export * from './types';
export {
	WORKFLOW_TEMPLATES,
	PILLAR_GEN_TEMPLATE,
	SPREAD_GEN_MULTI_REF_TEMPLATE,
	LORA_SPREAD_TEMPLATE,
	UPSCALE_TEMPLATE,
	LOCAL_CHECKPOINTS,
	UPSCALE_MODEL_NAME,
	UPSCALE_MODEL_FACTOR,
	instantiateWorkflow,
	type ComfyNode,
	type ComfyWorkflowGraph,
	type WorkflowId,
	type WorkflowSlotValues,
	type WorkflowTemplate,
} from './workflows';
export {
	LocalGpuProvider,
	createFetchComfyHttpClient,
	DEFAULT_IMAGE_GEN_SERVER_URL,
	type ComfyHttpClient,
	type ComfyHistoryEntry,
	type ComfyImageRef,
	type ComfyQueueResponse,
	type ComfyUploadResponse,
	type LocalGpuProviderOpts,
} from './LocalGpuProvider';
export {
	CloudProvider,
	createFetchFalHttpClient,
	blobToDataUri,
	FAL_MODELS,
	FAL_PRICE_PER_MEGAPIXEL_USD,
	FAL_RUN_BASE_URL,
	type CloudProviderOpts,
	type FalHttpClient,
	type FalImageRef,
	type FalRunResult,
} from './CloudProvider';
export { MockProvider } from './MockProvider';
export { encodeRgbPng, readPngSize, drawLabel } from './mockPng';

import { ImageGenError, type ImageGenProvider } from './types';
import { CloudProvider, createFetchFalHttpClient } from './CloudProvider';
import {
	DEFAULT_IMAGE_GEN_SERVER_URL,
	LocalGpuProvider,
	createFetchComfyHttpClient,
} from './LocalGpuProvider';
import { MockProvider } from './MockProvider';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type ImageGenProviderKind = 'local' | 'cloud' | 'mock';

export interface ImageGenEnv {
	IMAGE_GEN_PROVIDER?: string;
	IMAGE_GEN_SERVER_URL?: string;
	IMAGE_GEN_CLOUD_API_KEY?: string;
}

function readProcessEnv(): ImageGenEnv {
	const env = (typeof process !== 'undefined' ? process.env : {}) as Record<
		string,
		string | undefined
	>;
	return {
		IMAGE_GEN_PROVIDER: env.IMAGE_GEN_PROVIDER,
		IMAGE_GEN_SERVER_URL: env.IMAGE_GEN_SERVER_URL,
		IMAGE_GEN_CLOUD_API_KEY: env.IMAGE_GEN_CLOUD_API_KEY,
	};
}

/**
 * Resolve the configured ImageGenProvider. Pass `env` explicitly in tests;
 * production reads `process.env`. `fetchImpl` is injectable for the same
 * reason (defaults to global fetch).
 */
export function resolveImageGenProvider(
	env?: ImageGenEnv,
	fetchImpl?: typeof fetch,
): ImageGenProvider {
	const e = env ?? readProcessEnv();
	const kind = (e.IMAGE_GEN_PROVIDER ?? 'mock').trim().toLowerCase();
	switch (kind) {
		case 'mock':
			return new MockProvider();
		case 'local': {
			const baseUrl = e.IMAGE_GEN_SERVER_URL ?? DEFAULT_IMAGE_GEN_SERVER_URL;
			return new LocalGpuProvider({ http: createFetchComfyHttpClient(baseUrl, fetchImpl) });
		}
		case 'cloud': {
			const key = e.IMAGE_GEN_CLOUD_API_KEY;
			if (!key) {
				throw new ImageGenError(
					'config',
					'imagegen: IMAGE_GEN_CLOUD_API_KEY required when IMAGE_GEN_PROVIDER=cloud',
				);
			}
			return new CloudProvider({ http: createFetchFalHttpClient(key, fetchImpl) });
		}
		default:
			throw new ImageGenError(
				'config',
				`imagegen: unknown IMAGE_GEN_PROVIDER "${kind}" (expected local | cloud | mock)`,
			);
	}
}
