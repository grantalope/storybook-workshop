// tests/imagegen/provider-factory.test.ts
//
// resolveImageGenProvider() env-driven factory resolution.

import { describe, it, expect } from 'vitest';
import {
	resolveImageGenProvider,
	LocalGpuProvider,
	CloudProvider,
	MockProvider,
	ImageGenError,
	DEFAULT_IMAGE_GEN_SERVER_URL,
	FAL_RUN_BASE_URL,
} from '$lib/services/imagegen';

/** Fake fetch implementing the happy-path ComfyUI surface. */
function makeComfyFetch() {
	const urls: string[] = [];
	const fakeFetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		urls.push(url);
		if (url.endsWith('/prompt')) {
			return new Response(JSON.stringify({ prompt_id: 'p-9' }), {
				headers: { 'content-type': 'application/json' },
			});
		}
		if (url.includes('/history/')) {
			return new Response(
				JSON.stringify({
					'p-9': {
						status: { completed: true },
						outputs: { '7': { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } },
					},
				}),
			);
		}
		if (url.includes('/view')) {
			return new Response(new Uint8Array([1, 2, 3]).buffer);
		}
		throw new Error(`unexpected fetch ${url}`);
	}) as typeof fetch;
	return { fakeFetch, urls };
}

const req = { prompt: 'factory smoke', width: 64, height: 64, seed: 1 };

describe('resolveImageGenProvider', () => {
	it('defaults to the mock provider when IMAGE_GEN_PROVIDER is unset', () => {
		const provider = resolveImageGenProvider({});
		expect(provider).toBeInstanceOf(MockProvider);
		expect(provider.name).toBe('mock');
	});

	it('resolves mock explicitly (case-insensitive)', () => {
		expect(resolveImageGenProvider({ IMAGE_GEN_PROVIDER: 'mock' })).toBeInstanceOf(MockProvider);
		expect(resolveImageGenProvider({ IMAGE_GEN_PROVIDER: 'MOCK' })).toBeInstanceOf(MockProvider);
	});

	it('resolves local against the default Tailscale ComfyUI URL', async () => {
		const { fakeFetch, urls } = makeComfyFetch();
		const provider = resolveImageGenProvider({ IMAGE_GEN_PROVIDER: 'local' }, fakeFetch);
		expect(provider).toBeInstanceOf(LocalGpuProvider);
		expect(provider.name).toBe('local-gpu');

		await provider.generate(req);
		expect(urls[0]).toBe(`${DEFAULT_IMAGE_GEN_SERVER_URL}/prompt`);
	});

	it('honors IMAGE_GEN_SERVER_URL override for local', async () => {
		const { fakeFetch, urls } = makeComfyFetch();
		const provider = resolveImageGenProvider(
			{ IMAGE_GEN_PROVIDER: 'local', IMAGE_GEN_SERVER_URL: 'http://gpu.lan:8188/' },
			fakeFetch,
		);
		await provider.generate(req);
		expect(urls[0]).toBe('http://gpu.lan:8188/prompt');
	});

	it('resolves cloud when IMAGE_GEN_CLOUD_API_KEY is present and sends Key auth', async () => {
		const seen: Array<{ url: string; auth?: string }> = [];
		const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const headers = (init?.headers ?? {}) as Record<string, string>;
			seen.push({ url: String(input), auth: headers.authorization });
			if (String(input).startsWith(FAL_RUN_BASE_URL)) {
				return new Response(JSON.stringify({ images: [{ url: 'https://fal.cdn/i.png' }] }));
			}
			return new Response(new Uint8Array([7]).buffer);
		}) as typeof fetch;

		const provider = resolveImageGenProvider(
			{ IMAGE_GEN_PROVIDER: 'cloud', IMAGE_GEN_CLOUD_API_KEY: 'fal-key-123' },
			fakeFetch,
		);
		expect(provider).toBeInstanceOf(CloudProvider);
		expect(provider.name).toBe('cloud-fal');

		await provider.generate(req);
		expect(seen[0].url).toBe(`${FAL_RUN_BASE_URL}/fal-ai/qwen-image-2512`);
		expect(seen[0].auth).toBe('Key fal-key-123');
	});

	it('throws code=config for cloud without an API key', () => {
		const err = (() => {
			try {
				resolveImageGenProvider({ IMAGE_GEN_PROVIDER: 'cloud' });
				return null;
			} catch (e) {
				return e;
			}
		})();
		expect(err).toBeInstanceOf(ImageGenError);
		expect((err as ImageGenError).code).toBe('config');
	});

	it('throws code=config for an unknown provider kind', () => {
		const err = (() => {
			try {
				resolveImageGenProvider({ IMAGE_GEN_PROVIDER: 'dalle' });
				return null;
			} catch (e) {
				return e;
			}
		})();
		expect(err).toBeInstanceOf(ImageGenError);
		expect((err as ImageGenError).code).toBe('config');
		expect((err as ImageGenError).message).toMatch(/local \| cloud \| mock/);
	});
});
