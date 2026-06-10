// @graph-layer: private
// @rationale: private (cloud image-gen API key + story prompts)
//
// src/lib/services/imagegen/CloudProvider.ts
//
// ImageGenProvider backed by fal.ai's synchronous inference endpoints
// (https://fal.run/{model} with `Authorization: Key <IMAGE_GEN_CLOUD_API_KEY>`):
//
//   - fal-ai/qwen-image-2512        ($0.02/MP)  pillar txt2img
//   - fal-ai/qwen-image-edit-2511   (~$0.03/MP) character-consistent spreads
//                                   (multi-reference conditioning via
//                                   image_urls — hero + sidekick sheets)
//   - fal-ai/qwen-image-2512/lora + fal-ai/qwen-image-edit-2511/lora
//                                   matching endpoints for the locally
//                                   ai-toolkit-trained character LoRAs
//   - fal-ai/esrgan                 print-res upscale
//
// Request shape follows the public fal API docs (prompt / negative_prompt /
// image_size / seed / num_images / image_urls / loras), but all network IO
// goes through an injectable FalHttpClient so vitest mocks the boundary and
// production needs only the env key.

import { secureRandomInt } from '$lib/services/subscription/secureRandom';
import {
	ImageGenError,
	MAX_SEED_EXCLUSIVE,
	classifyRefs,
	parseLoraStyleId,
	validateImageGenRequest,
	type ImageGenProvider,
	type ImageGenRequest,
	type ImageGenResult,
	type UpscaleRequest,
	type UpscaleResult,
} from './types';

// ---------------------------------------------------------------------------
// Models + pricing
// ---------------------------------------------------------------------------

export const FAL_MODELS = Object.freeze({
	txt2img: 'fal-ai/qwen-image-2512',
	txt2imgLora: 'fal-ai/qwen-image-2512/lora',
	edit: 'fal-ai/qwen-image-edit-2511',
	editLora: 'fal-ai/qwen-image-edit-2511/lora',
	upscale: 'fal-ai/esrgan',
});

/** Published prices, USD per megapixel. */
export const FAL_PRICE_PER_MEGAPIXEL_USD = Object.freeze({
	txt2img: 0.02,
	edit: 0.03,
});

// ---------------------------------------------------------------------------
// HTTP boundary (injectable)
// ---------------------------------------------------------------------------

export interface FalImageRef {
	url: string;
	width?: number;
	height?: number;
	content_type?: string;
}

export interface FalRunResult {
	images?: FalImageRef[];
	image?: FalImageRef;
	seed?: number;
	request_id?: string;
	[key: string]: unknown;
}

export interface FalHttpClient {
	/** POST https://fal.run/{modelId} with a JSON input payload. */
	run(modelId: string, input: Record<string, unknown>): Promise<FalRunResult>;
	/** Download one result image. */
	fetchImage(url: string): Promise<Blob>;
}

export const FAL_RUN_BASE_URL = 'https://fal.run';

export function createFetchFalHttpClient(
	apiKey: string,
	fetchImpl: typeof fetch = fetch,
): FalHttpClient {
	return {
		async run(modelId, input) {
			const res = await fetchImpl(`${FAL_RUN_BASE_URL}/${modelId}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Key ${apiKey}`,
				},
				body: JSON.stringify(input),
			});
			if (!res.ok) {
				throw new ImageGenError('http', `fal.ai ${modelId} failed: HTTP ${res.status}`);
			}
			return (await res.json()) as FalRunResult;
		},
		async fetchImage(url) {
			const res = await fetchImpl(url);
			if (!res.ok) {
				throw new ImageGenError('http', `fal.ai image fetch failed: HTTP ${res.status}`);
			}
			return await res.blob();
		},
	};
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface CloudProviderOpts {
	http: FalHttpClient;
	nowSource?: () => number;
}

export class CloudProvider implements ImageGenProvider {
	readonly name = 'cloud-fal';

	private _http: FalHttpClient;
	private _now: () => number;

	constructor(opts: CloudProviderOpts) {
		this._http = opts.http;
		this._now = opts.nowSource ?? (() => Date.now());
	}

	async generate(req: ImageGenRequest): Promise<ImageGenResult> {
		validateImageGenRequest(req);
		const started = this._now();
		const seed = req.seed ?? secureRandomInt(MAX_SEED_EXCLUSIVE);
		const lora = parseLoraStyleId(req.styleId);
		const refs = classifyRefs(req.characterRefs ?? []);
		const refUrls =
			refs.kind === 'none'
				? []
				: refs.kind === 'string'
					? refs.names
					: await Promise.all(refs.blobs.map((b) => blobToDataUri(b)));
		const isEdit = refUrls.length > 0;
		const batch = req.batchCount ?? 1;

		const model = isEdit
			? lora
				? FAL_MODELS.editLora
				: FAL_MODELS.edit
			: lora
				? FAL_MODELS.txt2imgLora
				: FAL_MODELS.txt2img;

		const input: Record<string, unknown> = {
			prompt: req.prompt,
			image_size: { width: req.width, height: req.height },
			num_images: batch,
			seed,
			output_format: 'png',
			enable_safety_checker: true,
		};
		if (req.negativePrompt) input.negative_prompt = req.negativePrompt;
		if (isEdit) input.image_urls = refUrls;
		if (lora) input.loras = [{ path: lora.path, scale: lora.scale }];

		const result = await this._http.run(model, input);
		const imageRefs = result.images ?? (result.image ? [result.image] : []);
		if (imageRefs.length === 0) {
			throw new ImageGenError('provider', `fal.ai ${model} returned no images`, result);
		}
		const images = await Promise.all(imageRefs.map((r) => this._http.fetchImage(r.url)));

		const megapixels = (req.width * req.height * batch) / 1_000_000;
		const rate = isEdit ? FAL_PRICE_PER_MEGAPIXEL_USD.edit : FAL_PRICE_PER_MEGAPIXEL_USD.txt2img;

		return {
			images,
			seed: typeof result.seed === 'number' ? result.seed : seed,
			providerMeta: {
				provider: this.name,
				model,
				requestId: result.request_id,
				durationMs: this._now() - started,
				costEstimateUsd: roundUsd(megapixels * rate),
			},
		};
	}

	async upscale(req: UpscaleRequest): Promise<UpscaleResult> {
		const scale = req.scale ?? 4;
		if (!Number.isFinite(scale) || scale <= 0 || scale > 8) {
			throw new ImageGenError('invalid-request', `imagegen: upscale scale must be in (0, 8] (got ${scale})`);
		}
		const started = this._now();
		const imageUrl = typeof req.image === 'string' ? req.image : await blobToDataUri(req.image);
		const result = await this._http.run(FAL_MODELS.upscale, {
			image_url: imageUrl,
			scale,
			output_format: 'png',
		});
		const ref = result.image ?? result.images?.[0];
		if (!ref) {
			throw new ImageGenError('provider', 'fal.ai upscale returned no image', result);
		}
		const image = await this._http.fetchImage(ref.url);
		return {
			image,
			providerMeta: {
				provider: this.name,
				model: FAL_MODELS.upscale,
				requestId: result.request_id,
				durationMs: this._now() - started,
			},
		};
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundUsd(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

/** Inline a Blob as a base64 data URI (fal accepts data URIs for image inputs). */
export async function blobToDataUri(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	const b64 = btoa(binary);
	return `data:${blob.type || 'image/png'};base64,${b64}`;
}
