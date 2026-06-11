// tests/imagegen/local-gpu-provider.test.ts
//
// LocalGpuProvider against a mocked ComfyHttpClient boundary: request shape,
// template routing, polling, error paths, timeout. NO real GPU calls.

import { describe, it, expect } from 'vitest';
import {
	LocalGpuProvider,
	ImageGenError,
	type ComfyHttpClient,
	type ComfyImageRef,
	type ComfyWorkflowGraph,
} from '$lib/services/imagegen';

interface MockComfyOpts {
	/** getHistory returns null this many times before the run is ready. */
	readyAfterPolls?: number;
	nodeErrors?: Record<string, unknown>;
	errorStatus?: boolean;
	neverReady?: boolean;
	noImages?: boolean;
	images?: ComfyImageRef[];
}

function makeMockComfy(opts: MockComfyOpts = {}) {
	const posted: Array<{ graph: ComfyWorkflowGraph; clientId: string }> = [];
	const uploads: Array<{ filename: string; size: number }> = [];
	const viewed: ComfyImageRef[] = [];
	let polls = 0;
	const images = opts.images ?? [{ filename: 'out_00001_.png', subfolder: '', type: 'output' }];
	const http: ComfyHttpClient = {
		async postPrompt(graph, clientId) {
			posted.push({ graph, clientId });
			return { prompt_id: 'p-1', node_errors: opts.nodeErrors };
		},
		async getHistory() {
			polls++;
			if (opts.neverReady) return null;
			if (polls <= (opts.readyAfterPolls ?? 0)) return null;
			if (opts.errorStatus) return { status: { status_str: 'error', completed: false } };
			const outputs: Record<string, { images?: ComfyImageRef[] }> = opts.noImages
				? {}
				: { '7': { images } };
			return { status: { status_str: 'success', completed: true }, outputs };
		},
		async getImage(ref) {
			viewed.push(ref);
			return new Blob([new Uint8Array([0x89, 1, 2, 3]).buffer], { type: 'image/png' });
		},
		async uploadImage(image, filename) {
			uploads.push({ filename, size: image.size });
			return { name: filename, subfolder: 'uploads' };
		},
	};
	return { http, posted, uploads, viewed, getPolls: () => polls };
}

const instantSleep = async () => {};

function makeProvider(mock: ReturnType<typeof makeMockComfy>, extra: Record<string, unknown> = {}) {
	return new LocalGpuProvider({
		http: mock.http,
		sleep: instantSleep,
		pollIntervalMs: 10,
		...extra,
	});
}

const baseReq = {
	prompt: 'a cozy lighthouse at dusk',
	width: 1024,
	height: 768,
	seed: 7,
};

describe('LocalGpuProvider.generate — request shape', () => {
	it('queues the pillar-gen (txt2img) workflow with all slots filled', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock);
		await provider.generate({ ...baseReq, negativePrompt: 'blurry, low-res', batchCount: 2 });

		expect(mock.posted).toHaveLength(1);
		const { graph, clientId } = mock.posted[0];
		expect(clientId).toBe('storybook-workshop');
		expect(graph['2'].inputs.text).toBe('a cozy lighthouse at dusk');
		expect(graph['3'].inputs.text).toBe('blurry, low-res');
		expect(graph['4'].inputs).toMatchObject({ width: 1024, height: 768, batch_size: 2 });
		expect(graph['5'].inputs.seed).toBe(7);
		expect(graph['7'].inputs.filename_prefix).toBe('storybook/pillar');
	});

	it('returns Blobs + seed + providerMeta', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock);
		const result = await provider.generate(baseReq);

		expect(result.images).toHaveLength(1);
		expect(result.images[0]).toBeInstanceOf(Blob);
		expect(result.images[0].type).toBe('image/png');
		expect(result.seed).toBe(7);
		expect(result.providerMeta).toMatchObject({
			provider: 'local-gpu',
			workflowId: 'pillar-gen',
			promptId: 'p-1',
		});
		expect(mock.viewed[0]).toMatchObject({ filename: 'out_00001_.png' });
	});

	it('draws a CSPRNG seed when omitted and threads it into the graph', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock);
		const result = await provider.generate({ ...baseReq, seed: undefined });

		expect(Number.isInteger(result.seed)).toBe(true);
		expect(result.seed).toBeGreaterThanOrEqual(0);
		expect(result.seed).toBeLessThan(0x7fff_ffff);
		expect(mock.posted[0].graph['5'].inputs.seed).toBe(result.seed);
	});
});

describe('LocalGpuProvider.generate — template routing', () => {
	it('routes string characterRefs to the multi-ref edit workflow', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock);
		const result = await provider.generate({
			...baseReq,
			characterRefs: ['hero-sheet.png', 'sidekick-sheet.png'],
		});

		const graph = mock.posted[0].graph;
		expect(graph['2'].class_type).toBe('TextEncodeQwenImageEditPlus');
		expect(graph['10'].inputs.image).toBe('hero-sheet.png');
		expect(graph['11'].inputs.image).toBe('sidekick-sheet.png');
		expect(graph['12']).toBeUndefined();
		expect('image3' in graph['2'].inputs).toBe(false);
		expect(result.providerMeta.workflowId).toBe('spread-gen-multi-ref');
		expect(mock.uploads).toHaveLength(0); // string refs are server-side names already
	});

	it('uploads Blob characterRefs before queueing and wires uploaded names', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock, { uploadIdSource: () => 'refs123' });
		const refA = new Blob([new Uint8Array([1]).buffer], { type: 'image/png' });
		const refB = new Blob([new Uint8Array([2, 2]).buffer], { type: 'image/png' });
		await provider.generate({ ...baseReq, characterRefs: [refA, refB] });

		expect(mock.uploads).toHaveLength(2);
		expect(mock.uploads[0].filename).toBe('storybook-ref-refs123-0.png');
		expect(mock.uploads[1].filename).toBe('storybook-ref-refs123-1.png');
		const graph = mock.posted[0].graph;
		expect(graph['10'].inputs.image).toBe('uploads/storybook-ref-refs123-0.png');
		expect(graph['11'].inputs.image).toBe('uploads/storybook-ref-refs123-1.png');
	});

	it('routes lora:<path>@<scale> styleId to the lora-spread workflow', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock);
		const result = await provider.generate({
			...baseReq,
			styleId: 'lora:hero-char.safetensors@0.8',
		});

		const graph = mock.posted[0].graph;
		expect(graph['8'].class_type).toBe('LoraLoader');
		expect(graph['8'].inputs.lora_name).toBe('hero-char.safetensors');
		expect(graph['8'].inputs.strength_model).toBe(0.8);
		expect(result.providerMeta.workflowId).toBe('lora-spread');
	});

	it('defaults lora strength to 0.9 when styleId omits @scale', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock);
		await provider.generate({ ...baseReq, styleId: 'lora:hero-char.safetensors' });
		expect(mock.posted[0].graph['8'].inputs.strength_model).toBe(0.9);
	});
});

describe('LocalGpuProvider.generate — polling + error paths', () => {
	it('polls /history until the run shows up', async () => {
		const mock = makeMockComfy({ readyAfterPolls: 2 });
		const provider = makeProvider(mock);
		const result = await provider.generate(baseReq);
		expect(result.images).toHaveLength(1);
		expect(mock.getPolls()).toBe(3);
	});

	it('times out with code=timeout when the run never completes', async () => {
		let t = 0;
		const mock = makeMockComfy({ neverReady: true });
		const provider = new LocalGpuProvider({
			http: mock.http,
			pollIntervalMs: 10,
			timeoutMs: 50,
			nowSource: () => t,
			sleep: async (ms) => {
				t += ms;
			},
		});
		const err = await provider.generate(baseReq).catch((e) => e);
		expect(err).toBeInstanceOf(ImageGenError);
		expect(err.code).toBe('timeout');
		expect(mock.getPolls()).toBeGreaterThan(1);
	});

	it('surfaces node_errors from /prompt as code=provider', async () => {
		const mock = makeMockComfy({ nodeErrors: { '5': { message: 'bad sampler' } } });
		const provider = makeProvider(mock);
		const err = await provider.generate(baseReq).catch((e) => e);
		expect(err).toBeInstanceOf(ImageGenError);
		expect(err.code).toBe('provider');
		expect(err.message).toMatch(/bad sampler/);
	});

	it('surfaces history status=error as code=provider', async () => {
		const mock = makeMockComfy({ errorStatus: true });
		const provider = makeProvider(mock);
		const err = await provider.generate(baseReq).catch((e) => e);
		expect(err).toBeInstanceOf(ImageGenError);
		expect(err.code).toBe('provider');
	});

	it('rejects a completed run with no images as code=provider', async () => {
		const mock = makeMockComfy({ noImages: true });
		const provider = makeProvider(mock);
		const err = await provider.generate(baseReq).catch((e) => e);
		expect(err).toBeInstanceOf(ImageGenError);
		expect(err.code).toBe('provider');
		expect(err.message).toMatch(/no images/);
	});

	it('propagates HTTP-boundary failures with code=http', async () => {
		const mock = makeMockComfy();
		mock.http.postPrompt = async () => {
			throw new ImageGenError('http', 'ComfyUI POST /prompt failed: HTTP 502');
		};
		const provider = makeProvider(mock);
		const err = await provider.generate(baseReq).catch((e) => e);
		expect(err).toBeInstanceOf(ImageGenError);
		expect(err.code).toBe('http');
	});

	it('rejects invalid requests before any HTTP call', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock);
		for (const bad of [
			{ ...baseReq, prompt: '   ' },
			{ ...baseReq, width: 0 },
			{ ...baseReq, height: 5000 },
			{ ...baseReq, batchCount: 9 },
			{ ...baseReq, characterRefs: ['a', 'b', 'c', 'd'] },
		]) {
			const err = await provider.generate(bad as never).catch((e) => e);
			expect(err).toBeInstanceOf(ImageGenError);
			expect(err.code).toBe('invalid-request');
		}
		expect(mock.posted).toHaveLength(0);
	});
});

describe('LocalGpuProvider.upscale', () => {
	it('uploads a Blob source and queues the upscale workflow', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock, { uploadIdSource: () => 'upscale456' });
		const source = new Blob([new Uint8Array([5, 5, 5]).buffer], { type: 'image/png' });
		const result = await provider.upscale({ image: source, scale: 2 });

		expect(mock.uploads).toHaveLength(1);
		const graph = mock.posted[0].graph;
		expect(graph['1'].inputs.image).toBe('uploads/storybook-ref-upscale456-0.png');
		expect(graph['2'].class_type).toBe('UpscaleModelLoader');
		// 4x model + lanczos trim to the requested 2x.
		expect(graph['4'].inputs.scale_by).toBe(0.5);
		expect(result.image).toBeInstanceOf(Blob);
		expect(result.providerMeta.workflowId).toBe('upscale');
	});

	it('uses a string source as a server-side image name (no upload), default 4x', async () => {
		const mock = makeMockComfy();
		const provider = makeProvider(mock);
		await provider.upscale({ image: 'spread-04.png' });

		expect(mock.uploads).toHaveLength(0);
		const graph = mock.posted[0].graph;
		expect(graph['1'].inputs.image).toBe('spread-04.png');
		expect(graph['4'].inputs.scale_by).toBe(1);
	});
});
