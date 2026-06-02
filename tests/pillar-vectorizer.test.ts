// tests/storybook-workshop/pillar-vectorizer.test.ts
//
// Pillar-vectorizer service spec. Covers:
//   - 512-dim Float32Array output
//   - photo Blob reference dropped post-call
//   - warmup probe (webgpu present / wasm fallback / both fail)
//   - isReady() lifecycle
//   - activeBackend() returns the right tier
//   - clean error when both probes fail and vectorize() is called

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    PillarVectorizerService,
    PILLAR_EMBEDDING_DIM,
} from '$lib/services/PillarVectorizerService';

/** Build a stub CLIP pipeline that returns a deterministic vector. */
function deterministicPipeline(seed = 42) {
    return () =>
        Promise.resolve(
            async (input: unknown, opts?: { pooling?: string; normalize?: boolean }) => {
                // Use a tiny RNG seeded by the input "kind" so a Blob and
                // a different input yield different vectors deterministically.
                let s = seed;
                const data = new Float32Array(PILLAR_EMBEDDING_DIM);
                for (let i = 0; i < PILLAR_EMBEDDING_DIM; i++) {
                    s = (s * 1664525 + 1013904223) >>> 0;
                    data[i] = (s / 2 ** 32) * 2 - 1;
                }
                // mark that the pipeline was actually invoked with the blob
                (data as any)._invokedWith = input;
                (data as any)._opts = opts;
                return { data };
            },
        );
}

/** Stub pipeline that always throws on import. */
function throwingPipeline() {
    return () => Promise.reject(new Error('stub-init-failed'));
}

/** Tiny fake Blob — vitest/node has Blob globally. */
function fakeBlob(): Blob {
    return new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/jpeg' });
}

describe('PillarVectorizerService', () => {
    let svc: PillarVectorizerService;

    beforeEach(() => {
        svc = new PillarVectorizerService();
    });

    afterEach(() => {
        svc.__test_reset();
    });

    it('warmup() lands on wasm when webgpu absent + wasm pipeline succeeds', async () => {
        svc.__test_setHooks({
            imagePipelineFactory: deterministicPipeline(),
            probeOrder: ['webgpu', 'wasm'],
        });
        // navigator.gpu intentionally absent in node — webgpu probe should skip silently
        await svc.warmup();
        expect(svc.isReady()).toBe(true);
        expect(svc.activeBackend()).toBe('wasm');
    });

    it('warmup() picks webgpu when navigator.gpu exists AND pipeline boots', async () => {
        // node has a non-writable `navigator` getter; install a `gpu` field
        // on whatever object it currently returns and restore after.
        const nav = (globalThis as any).navigator;
        const hadGpu = nav && 'gpu' in nav;
        const prevGpu = hadGpu ? nav.gpu : undefined;
        if (nav) nav.gpu = {};
        try {
            svc.__test_setHooks({
                imagePipelineFactory: deterministicPipeline(),
                probeOrder: ['webgpu', 'wasm'],
            });
            await svc.warmup();
            expect(svc.activeBackend()).toBe('webgpu');
        } finally {
            if (nav) {
                if (hadGpu) nav.gpu = prevGpu;
                else delete nav.gpu;
            }
        }
    });

    it('warmup() falls through to fallback when both probes fail', async () => {
        const nav = (globalThis as any).navigator;
        const hadGpu = nav && 'gpu' in nav;
        const prevGpu = hadGpu ? nav.gpu : undefined;
        if (nav) nav.gpu = {};
        try {
            svc.__test_setHooks({
                imagePipelineFactory: throwingPipeline(),
                probeOrder: ['webgpu', 'wasm'],
            });
            await svc.warmup();
            expect(svc.isReady()).toBe(true);
            expect(svc.activeBackend()).toBe('fallback');
        } finally {
            if (nav) {
                if (hadGpu) nav.gpu = prevGpu;
                else delete nav.gpu;
            }
        }
    });

    it('warmup() is idempotent — second call returns the same in-flight promise', async () => {
        const factory = vi.fn(deterministicPipeline());
        svc.__test_setHooks({
            imagePipelineFactory: factory,
            probeOrder: ['wasm'],
        });
        const a = svc.warmup();
        const b = svc.warmup();
        await Promise.all([a, b]);
        // factory called exactly once across two concurrent warmup() calls
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('vectorize() returns a Float32Array of length PILLAR_EMBEDDING_DIM', async () => {
        svc.__test_setHooks({
            imagePipelineFactory: deterministicPipeline(),
            probeOrder: ['wasm'],
        });
        const blob = fakeBlob();
        const vec = await svc.vectorize(blob);
        expect(vec).toBeInstanceOf(Float32Array);
        expect(vec.length).toBe(PILLAR_EMBEDDING_DIM);
    });

    it('vectorize() auto-warms when called before explicit warmup()', async () => {
        svc.__test_setHooks({
            imagePipelineFactory: deterministicPipeline(),
            probeOrder: ['wasm'],
        });
        expect(svc.isReady()).toBe(false);
        const vec = await svc.vectorize(fakeBlob());
        expect(svc.isReady()).toBe(true);
        expect(vec.length).toBe(PILLAR_EMBEDDING_DIM);
    });

    it('vectorize() throws a clean error when both webgpu + wasm fail', async () => {
        svc.__test_setHooks({
            imagePipelineFactory: throwingPipeline(),
            probeOrder: ['wasm'],
        });
        await svc.warmup();
        await expect(svc.vectorize(fakeBlob())).rejects.toThrow(
            /no on-device backend|fallback|stub-init-failed/,
        );
    });

    it('vectorize() drops its local photo reference after the forward pass', async () => {
        // The "local ref drop" is observable by setting up a WeakRef on the
        // blob and asserting the service does not retain an own-property
        // reference to it. We can't reliably force GC in node, so we
        // assert the weaker (but still meaningful) property: no field on
        // the service instance holds the blob after vectorize() resolves.
        let observedBlobIdentity: unknown = null;
        const pipe = () =>
            Promise.resolve(async (input: unknown) => {
                observedBlobIdentity = input;
                const data = new Float32Array(PILLAR_EMBEDDING_DIM);
                return { data };
            });
        svc.__test_setHooks({
            imagePipelineFactory: pipe,
            probeOrder: ['wasm'],
        });
        const blob = fakeBlob();
        await svc.vectorize(blob);
        expect(observedBlobIdentity).toBe(blob); // pipeline did see it
        // service must not retain a reference on any own enumerable field
        for (const key of Object.keys(svc)) {
            const v = (svc as any)[key];
            expect(v).not.toBe(blob);
        }
    });

    it('vectorize() rejects when the pipeline returns a wrong-length embedding', async () => {
        svc.__test_setHooks({
            imagePipelineFactory: () =>
                Promise.resolve(async () => ({
                    data: new Float32Array(64), // wrong length
                })),
            probeOrder: ['wasm'],
        });
        await expect(svc.vectorize(fakeBlob())).rejects.toThrow(
            /unexpected embedding length/,
        );
    });

    it('vectorize() converts number[] pipeline output to Float32Array', async () => {
        const arr: number[] = new Array(PILLAR_EMBEDDING_DIM).fill(0.5);
        svc.__test_setHooks({
            imagePipelineFactory: () =>
                Promise.resolve(async () => ({ data: arr })),
            probeOrder: ['wasm'],
        });
        const vec = await svc.vectorize(fakeBlob());
        expect(vec).toBeInstanceOf(Float32Array);
        expect(vec.length).toBe(PILLAR_EMBEDDING_DIM);
        expect(vec[0]).toBeCloseTo(0.5);
    });
});
