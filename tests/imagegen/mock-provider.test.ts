// tests/imagegen/mock-provider.test.ts
//
// MockProvider determinism + real-PNG output (NOT 1x1 stubs).

import { describe, it, expect } from 'vitest';
import { MockProvider, readPngSize } from '$lib/services/imagegen';

async function blobBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

const baseReq = {
	prompt: 'a gentle dragon learns to bake',
	width: 512,
	height: 512,
	seed: 33,
};

describe('MockProvider determinism', () => {
	it('returns byte-identical PNGs for the same request', async () => {
		const provider = new MockProvider();
		const a = await provider.generate(baseReq);
		const b = await provider.generate(baseReq);
		expect(bytesEqual(await blobBytes(a.images[0]), await blobBytes(b.images[0]))).toBe(true);
		expect(a.seed).toBe(33);
	});

	it('returns different bytes for different seeds', async () => {
		const provider = new MockProvider();
		const a = await provider.generate(baseReq);
		const b = await provider.generate({ ...baseReq, seed: 34 });
		expect(bytesEqual(await blobBytes(a.images[0]), await blobBytes(b.images[0]))).toBe(false);
	});

	it('derives a deterministic seed from the prompt when seed is omitted', async () => {
		const provider = new MockProvider();
		const a1 = await provider.generate({ ...baseReq, seed: undefined });
		const a2 = await provider.generate({ ...baseReq, seed: undefined });
		const other = await provider.generate({
			...baseReq,
			seed: undefined,
			prompt: 'a shy comet finds a friend',
		});
		expect(a1.seed).toBe(a2.seed);
		expect(bytesEqual(await blobBytes(a1.images[0]), await blobBytes(a2.images[0]))).toBe(true);
		expect(other.seed).not.toBe(a1.seed);
	});
});

describe('MockProvider output shape', () => {
	it('emits a valid PNG at the requested dimensions (512x512, not 1x1)', async () => {
		const provider = new MockProvider();
		const result = await provider.generate(baseReq);
		const bytes = await blobBytes(result.images[0]);

		// PNG signature
		expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(readPngSize(bytes)).toEqual({ width: 512, height: 512 });
		expect(result.images[0].type).toBe('image/png');
		expect(result.providerMeta.provider).toBe('mock');
	});

	it('honors batchCount with per-index variation', async () => {
		const provider = new MockProvider();
		const result = await provider.generate({ ...baseReq, width: 128, height: 128, batchCount: 3 });
		expect(result.images).toHaveLength(3);
		const b0 = await blobBytes(result.images[0]);
		const b1 = await blobBytes(result.images[1]);
		expect(bytesEqual(b0, b1)).toBe(false);
	});

	it('upscales to source dims x scale (print res)', async () => {
		const provider = new MockProvider();
		const small = await provider.generate({ ...baseReq, width: 128, height: 96 });
		const result = await provider.upscale({ image: small.images[0], scale: 4 });
		const bytes = await blobBytes(result.image);
		expect(readPngSize(bytes)).toEqual({ width: 512, height: 384 });
		expect(result.providerMeta.workflowId).toBe('upscale');
	});
});
