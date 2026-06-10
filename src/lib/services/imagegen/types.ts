// @graph-layer: private
// @rationale: private (image-generation boundary — prompts embed story text)
//
// src/lib/services/imagegen/types.ts
//
// Swappable image-generation provider boundary. Production picks a backend
// via IMAGE_GEN_PROVIDER (local | cloud | mock); every backend implements
// the same ImageGenProvider interface so the book pipeline (pillar gen,
// character-consistent spread gen, print-res upscale) never knows which GPU
// does the work.
//
//   - local: ComfyUI headless on the 4090 box (Windows-native CUDA, launched
//     with `--listen <tailscale-ip> --port 8188`), reached over Tailscale at
//     IMAGE_GEN_SERVER_URL (default http://100.101.215.25:8188). Driven
//     programmatically via the /prompt HTTP API with workflow-JSON templates.
//   - cloud: fal.ai qwen-image-2512 ($0.02/MP, pillars) +
//     qwen-image-edit-2511 (~$0.03/MP, consistent spreads) + the matching
//     /lora endpoints for trained character LoRAs.
//   - mock: deterministic 512x512 labeled gradient PNGs for dev + vitest.

export interface ImageGenRequest {
	prompt: string;
	negativePrompt?: string;
	width: number;
	height: number;
	/** Deterministic seed. Omitted -> provider draws a CSPRNG seed. */
	seed?: number;
	/**
	 * Style selector. Plain ids are provider-defined; the
	 * `lora:<path>[@<scale>]` convention routes to the LoRA pipeline on both
	 * backends (ComfyUI LoraLoader locally; the /lora endpoints on fal).
	 */
	styleId?: string;
	/**
	 * Character reference images for consistent spreads (Qwen-Image-Edit-2511
	 * multi-reference conditioning — hero + sidekick character sheets).
	 * Blobs are uploaded (local) / inlined as data URIs (cloud); strings are
	 * provider-reachable refs (ComfyUI image names locally, URLs on fal).
	 */
	characterRefs?: Blob[] | string[];
	/** Number of images to generate in one call (default 1, max 8). */
	batchCount?: number;
}

export interface ImageGenProviderMeta {
	provider: string;
	model?: string;
	workflowId?: string;
	promptId?: string;
	requestId?: string;
	durationMs?: number;
	costEstimateUsd?: number;
	[key: string]: unknown;
}

export interface ImageGenResult {
	images: Blob[];
	/** Seed actually used (request seed, or the CSPRNG draw when omitted). */
	seed: number;
	providerMeta: ImageGenProviderMeta;
}

export interface UpscaleRequest {
	/**
	 * Source image: raw bytes, or a provider-reachable ref (ComfyUI image
	 * name locally, URL on fal).
	 */
	image: Blob | string;
	/** Upscale factor (default 4 — 512px art -> 2048px print res). */
	scale?: number;
	seed?: number;
}

export interface UpscaleResult {
	image: Blob;
	providerMeta: ImageGenProviderMeta;
}

export interface ImageGenProvider {
	readonly name: string;
	generate(req: ImageGenRequest): Promise<ImageGenResult>;
	upscale(req: UpscaleRequest): Promise<UpscaleResult>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ImageGenErrorCode =
	| 'invalid-request'
	| 'config'
	| 'http'
	| 'provider'
	| 'timeout';

export class ImageGenError extends Error {
	readonly code: ImageGenErrorCode;
	/** Underlying error / response payload when available. */
	readonly detail?: unknown;

	constructor(code: ImageGenErrorCode, message: string, detail?: unknown) {
		super(message);
		this.name = 'ImageGenError';
		this.code = code;
		this.detail = detail;
	}
}

// ---------------------------------------------------------------------------
// Validation + shared helpers
// ---------------------------------------------------------------------------

export const MAX_IMAGE_DIM = 4096;
export const MAX_BATCH_COUNT = 8;
export const MAX_CHARACTER_REFS = 3;

export function validateImageGenRequest(req: ImageGenRequest): void {
	if (!req.prompt || req.prompt.trim().length === 0) {
		throw new ImageGenError('invalid-request', 'imagegen: prompt required');
	}
	for (const [key, value] of [
		['width', req.width],
		['height', req.height],
	] as const) {
		if (!Number.isInteger(value) || value <= 0 || value > MAX_IMAGE_DIM) {
			throw new ImageGenError(
				'invalid-request',
				`imagegen: ${key} must be an integer in 1..${MAX_IMAGE_DIM} (got ${value})`,
			);
		}
	}
	if (req.seed !== undefined && (!Number.isInteger(req.seed) || req.seed < 0)) {
		throw new ImageGenError('invalid-request', `imagegen: seed must be a non-negative integer (got ${req.seed})`);
	}
	if (
		req.batchCount !== undefined &&
		(!Number.isInteger(req.batchCount) || req.batchCount < 1 || req.batchCount > MAX_BATCH_COUNT)
	) {
		throw new ImageGenError(
			'invalid-request',
			`imagegen: batchCount must be an integer in 1..${MAX_BATCH_COUNT} (got ${req.batchCount})`,
		);
	}
	const refs = req.characterRefs ?? [];
	if (refs.length > MAX_CHARACTER_REFS) {
		throw new ImageGenError(
			'invalid-request',
			`imagegen: at most ${MAX_CHARACTER_REFS} characterRefs supported (got ${refs.length})`,
		);
	}
}

export const DEFAULT_LORA_SCALE = 0.9;

export interface LoraStyleRef {
	path: string;
	scale: number;
}

/**
 * Parse the `lora:<path>[@<scale>]` styleId convention shared by both
 * backends. Returns null for non-LoRA styleIds; throws on malformed ones.
 */
export function parseLoraStyleId(styleId: string | undefined): LoraStyleRef | null {
	if (!styleId || !styleId.startsWith('lora:')) return null;
	const body = styleId.slice('lora:'.length);
	if (!body) {
		throw new ImageGenError('invalid-request', `imagegen: malformed lora styleId "${styleId}"`);
	}
	const at = body.lastIndexOf('@');
	if (at > 0) {
		const path = body.slice(0, at);
		const scale = Number(body.slice(at + 1));
		if (!Number.isFinite(scale) || scale <= 0 || scale > 2) {
			throw new ImageGenError('invalid-request', `imagegen: malformed lora scale in styleId "${styleId}"`);
		}
		return { path, scale };
	}
	return { path: body, scale: DEFAULT_LORA_SCALE };
}

/**
 * Narrow a `Blob[] | string[]` characterRefs array. Mixed arrays are an
 * invalid request (the union type forbids them, but runtime callers may
 * still pass them).
 */
export function classifyRefs(refs: Blob[] | string[]): { kind: 'none' | 'blob' | 'string'; blobs: Blob[]; names: string[] } {
	if (refs.length === 0) return { kind: 'none', blobs: [], names: [] };
	const first = refs[0];
	if (typeof Blob !== 'undefined' && first instanceof Blob) {
		for (const r of refs) {
			if (!(r instanceof Blob)) {
				throw new ImageGenError('invalid-request', 'imagegen: characterRefs must be all-Blob or all-string');
			}
		}
		return { kind: 'blob', blobs: refs as Blob[], names: [] };
	}
	for (const r of refs) {
		if (typeof r !== 'string' || r.length === 0) {
			throw new ImageGenError('invalid-request', 'imagegen: characterRefs must be all-Blob or all-string');
		}
	}
	return { kind: 'string', blobs: [], names: refs as string[] };
}

/** Seed range shared by providers — fits ComfyUI + fal seed fields. */
export const MAX_SEED_EXCLUSIVE = 0x7fff_ffff;
