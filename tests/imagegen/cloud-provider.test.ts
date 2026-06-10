// tests/imagegen/cloud-provider.test.ts
//
// CloudProvider (fal.ai-shaped) against a mocked FalHttpClient boundary:
// model routing, request body shape, ref inlining, cost estimate, errors.

import { describe, it, expect } from 'vitest';
import {
	CloudProvider,
	FAL_MODELS,
	ImageGenError,
	type FalHttpClient,
	type FalRunResult,
} from '$lib/services/imagegen';

function makeMockFal(result?: FalRunResult) {
	const runs: Array<{ modelId: string; input: Record<string, unknown> }> = [];
	const fetched: string[] = [];
	const http: FalHttpClient = {
		async run(modelId, input) {
			runs.push({ modelId, input });
			return (
				result ?? {
					images: [{ url: 'https://fal.cdn/img-1.png' }],
					seed: 1234,
					request_id: 'req-1',
				}
			);
		},
		async fetchImage(url) {
			fetched.push(url);
			return new Blob([new Uint8Array([9, 9]).buffer], { type: 'image/png' });
		},
	};
	return { http, runs, fetched };
}

const baseReq = {
	prompt: 'a brave fox sets sail',
	width: 1000,
	height: 1000,
	seed: 42,
};

describe('CloudProvider.generate — model routing + body shape', () => {
	it('routes plain txt2img to qwen-image-2512 with the documented body', async () => {
		const mock = makeMockFal();
		const provider = new CloudProvider({ http: mock.http });
		await provider.generate({ ...baseReq, batchCount: 2 });

		expect(mock.runs).toHaveLength(1);
		expect(mock.runs[0].modelId).toBe(FAL_MODELS.txt2img);
		expect(mock.runs[0].input).toMatchObject({
			prompt: 'a brave fox sets sail',
			image_size: { width: 1000, height: 1000 },
			num_images: 2,
			seed: 42,
			output_format: 'png',
		});
		expect('negative_prompt' in mock.runs[0].input).toBe(false);
		expect('image_urls' in mock.runs[0].input).toBe(false);
		expect('loras' in mock.runs[0].input).toBe(false);
	});

	it('includes negative_prompt only when provided', async () => {
		const mock = makeMockFal();
		const provider = new CloudProvider({ http: mock.http });
		await provider.generate({ ...baseReq, negativePrompt: 'photorealistic' });
		expect(mock.runs[0].input.negative_prompt).toBe('photorealistic');
	});

	it('routes characterRefs to qwen-image-edit-2511 with image_urls', async () => {
		const mock = makeMockFal();
		const provider = new CloudProvider({ http: mock.http });
		await provider.generate({
			...baseReq,
			characterRefs: ['https://refs/hero.png', 'https://refs/sidekick.png'],
		});

		expect(mock.runs[0].modelId).toBe(FAL_MODELS.edit);
		expect(mock.runs[0].input.image_urls).toEqual([
			'https://refs/hero.png',
			'https://refs/sidekick.png',
		]);
	});

	it('routes lora styleId to the /lora endpoints (txt2img + edit variants)', async () => {
		const mock = makeMockFal();
		const provider = new CloudProvider({ http: mock.http });

		await provider.generate({ ...baseReq, styleId: 'lora:https://lora/hero.safetensors@0.7' });
		expect(mock.runs[0].modelId).toBe(FAL_MODELS.txt2imgLora);
		expect(mock.runs[0].input.loras).toEqual([
			{ path: 'https://lora/hero.safetensors', scale: 0.7 },
		]);

		await provider.generate({
			...baseReq,
			styleId: 'lora:https://lora/hero.safetensors',
			characterRefs: ['https://refs/hero.png'],
		});
		expect(mock.runs[1].modelId).toBe(FAL_MODELS.editLora);
		expect(mock.runs[1].input.loras).toEqual([
			{ path: 'https://lora/hero.safetensors', scale: 0.9 },
		]);
	});

	it('inlines Blob characterRefs as base64 data URIs', async () => {
		const mock = makeMockFal();
		const provider = new CloudProvider({ http: mock.http });
		const ref = new Blob([new Uint8Array([1, 2, 3]).buffer], { type: 'image/png' });
		await provider.generate({ ...baseReq, characterRefs: [ref] });

		const urls = mock.runs[0].input.image_urls as string[];
		expect(urls).toHaveLength(1);
		expect(urls[0].startsWith('data:image/png;base64,')).toBe(true);
	});
});

describe('CloudProvider.generate — results + errors', () => {
	it('downloads each result image and prefers the response seed', async () => {
		const mock = makeMockFal({
			images: [{ url: 'https://fal.cdn/a.png' }, { url: 'https://fal.cdn/b.png' }],
			seed: 777,
		});
		const provider = new CloudProvider({ http: mock.http });
		const result = await provider.generate(baseReq);

		expect(result.images).toHaveLength(2);
		expect(result.images[0]).toBeInstanceOf(Blob);
		expect(mock.fetched).toEqual(['https://fal.cdn/a.png', 'https://fal.cdn/b.png']);
		expect(result.seed).toBe(777);
		expect(result.providerMeta.provider).toBe('cloud-fal');
		expect(result.providerMeta.model).toBe(FAL_MODELS.txt2img);
	});

	it('estimates cost at $0.02/MP for txt2img and $0.03/MP for edit', async () => {
		const mock = makeMockFal();
		const provider = new CloudProvider({ http: mock.http });

		// 1000x1000 x2 = 2.0 MP at $0.02
		const pillar = await provider.generate({ ...baseReq, batchCount: 2 });
		expect(pillar.providerMeta.costEstimateUsd).toBeCloseTo(0.04, 5);

		// 1000x1000 x1 = 1.0 MP at $0.03
		const spread = await provider.generate({
			...baseReq,
			characterRefs: ['https://refs/hero.png'],
		});
		expect(spread.providerMeta.costEstimateUsd).toBeCloseTo(0.03, 5);
	});

	it('rejects an empty image result with code=provider', async () => {
		const mock = makeMockFal({ images: [] });
		const provider = new CloudProvider({ http: mock.http });
		const err = await provider.generate(baseReq).catch((e) => e);
		expect(err).toBeInstanceOf(ImageGenError);
		expect(err.code).toBe('provider');
	});

	it('rejects invalid requests before any HTTP call', async () => {
		const mock = makeMockFal();
		const provider = new CloudProvider({ http: mock.http });
		const err = await provider.generate({ ...baseReq, prompt: '' }).catch((e) => e);
		expect(err).toBeInstanceOf(ImageGenError);
		expect(err.code).toBe('invalid-request');
		expect(mock.runs).toHaveLength(0);
	});
});

describe('CloudProvider.upscale', () => {
	it('routes to the upscale model with image_url + scale', async () => {
		const mock = makeMockFal({ image: { url: 'https://fal.cdn/up.png' } });
		const provider = new CloudProvider({ http: mock.http });
		const result = await provider.upscale({ image: 'https://src/spread.png', scale: 4 });

		expect(mock.runs[0].modelId).toBe(FAL_MODELS.upscale);
		expect(mock.runs[0].input).toMatchObject({
			image_url: 'https://src/spread.png',
			scale: 4,
		});
		expect(result.image).toBeInstanceOf(Blob);
		expect(result.providerMeta.model).toBe(FAL_MODELS.upscale);
	});

	it('inlines a Blob source as a data URI', async () => {
		const mock = makeMockFal({ image: { url: 'https://fal.cdn/up.png' } });
		const provider = new CloudProvider({ http: mock.http });
		const source = new Blob([new Uint8Array([4, 4]).buffer], { type: 'image/jpeg' });
		await provider.upscale({ image: source });

		const url = mock.runs[0].input.image_url as string;
		expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
	});
});
