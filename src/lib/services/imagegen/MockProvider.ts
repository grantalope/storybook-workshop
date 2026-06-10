// @graph-layer: private
// @rationale: private (dev/test-only synthetic image provider)
//
// src/lib/services/imagegen/MockProvider.ts
//
// Deterministic mock ImageGenProvider for dev + vitest. Returns labeled
// 512x512-class gradient PNGs (real, decodable PNGs at the requested
// dimensions — NOT 1x1 stubs) so previews look sane in dev while staying
// byte-deterministic: the same request always yields the same bytes.
//
// Seed handling: when `req.seed` is omitted the mock derives one from an
// FNV-1a hash of the prompt + styleId (NOT a CSPRNG draw — determinism is
// the whole point of this provider).

import {
	validateImageGenRequest,
	ImageGenError,
	type ImageGenProvider,
	type ImageGenRequest,
	type ImageGenResult,
	type UpscaleRequest,
	type UpscaleResult,
} from './types';
import { drawLabel, encodeRgbPng, readPngSize } from './mockPng';

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = ((h % 360) + 360) % 360 / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let r = 0;
	let g = 0;
	let b = 0;
	if (hp < 1) [r, g, b] = [c, x, 0];
	else if (hp < 2) [r, g, b] = [x, c, 0];
	else if (hp < 3) [r, g, b] = [0, c, x];
	else if (hp < 4) [r, g, b] = [0, x, c];
	else if (hp < 5) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const m = l - c / 2;
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function renderGradientPng(
	width: number,
	height: number,
	seed: number,
	labels: string[],
): Uint8Array {
	const hue = (seed * 137.508) % 360; // golden-angle hop per seed
	const [r1, g1, b1] = hslToRgb(hue, 0.62, 0.42);
	const [r2, g2, b2] = hslToRgb(hue + 130, 0.62, 0.72);
	const rgb = new Uint8Array(width * height * 3);
	const denom = Math.max(1, width + height - 2);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const t = (x + y) / denom;
			const idx = (y * width + x) * 3;
			rgb[idx] = Math.round(r1 + (r2 - r1) * t);
			rgb[idx + 1] = Math.round(g1 + (g2 - g1) * t);
			rgb[idx + 2] = Math.round(b1 + (b2 - b1) * t);
		}
	}
	labels.forEach((label, i) => {
		drawLabel(rgb, width, height, label, 8, 8 + i * 22, 2);
	});
	return encodeRgbPng(width, height, rgb);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const PROMPT_EXCERPT_LEN = 24;

export class MockProvider implements ImageGenProvider {
	readonly name = 'mock';

	async generate(req: ImageGenRequest): Promise<ImageGenResult> {
		validateImageGenRequest(req);
		const seed = req.seed ?? fnv1a(`${req.prompt}|${req.styleId ?? ''}`) % 0x7fff_ffff;
		const batch = req.batchCount ?? 1;
		const refCount = req.characterRefs?.length ?? 0;
		const images: Blob[] = [];
		for (let i = 0; i < batch; i++) {
			const labels = [
				`MOCK ${req.width}X${req.height} SEED:${seed + i}`,
				`BATCH ${i + 1}/${batch}${refCount > 0 ? ` REFS:${refCount}` : ''}`,
				req.prompt.slice(0, PROMPT_EXCERPT_LEN),
			];
			const bytes = renderGradientPng(req.width, req.height, seed + i, labels);
			images.push(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }));
		}
		return {
			images,
			seed,
			providerMeta: {
				provider: this.name,
				model: 'mock-gradient',
				workflowId: refCount > 0 ? 'spread-gen-multi-ref' : 'pillar-gen',
				costEstimateUsd: 0,
			},
		};
	}

	async upscale(req: UpscaleRequest): Promise<UpscaleResult> {
		const scale = req.scale ?? 4;
		if (!Number.isFinite(scale) || scale <= 0 || scale > 8) {
			throw new ImageGenError('invalid-request', `imagegen: upscale scale must be in (0, 8] (got ${scale})`);
		}
		let srcW = 512;
		let srcH = 512;
		if (typeof req.image !== 'string') {
			const bytes = new Uint8Array(await req.image.arrayBuffer());
			try {
				const size = readPngSize(bytes);
				srcW = size.width;
				srcH = size.height;
			} catch {
				// Non-PNG source: keep the 512x512 default.
			}
		}
		const width = Math.round(srcW * scale);
		const height = Math.round(srcH * scale);
		const seed = req.seed ?? fnv1a(`upscale|${srcW}x${srcH}|${scale}`) % 0x7fff_ffff;
		const bytes = renderGradientPng(width, height, seed, [
			`MOCK UPSCALE ${width}X${height}`,
			`SCALE:${scale} FROM ${srcW}X${srcH}`,
		]);
		return {
			image: new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }),
			providerMeta: {
				provider: this.name,
				model: 'mock-upscale',
				workflowId: 'upscale',
				costEstimateUsd: 0,
			},
		};
	}
}
