// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/storybook-workshop/PillarVectorizerService.ts
//
// On-device CLIP image vectorizer for the Storybook Workshop S2 (Forge Your
// Hero) station. The kid's photo never leaves the device on the happy path
// — the CLIP forward pass runs locally, returns a 512-dim embedding, and
// the photo Blob reference is dropped synchronously before returning.
//
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §3.3
// ADR:  docs/adr/0043-storybook-workshop-privacy-on-device-pillar.md
//
// Why this is its own service (not just a thin wrapper around
// `$lib/llr` embedding.embed-image) — it is the front line of the
// workshop's marketing-claim privacy moat. The lifecycle (warmup →
// vectorize → discard) is specific enough that mixing it into the general
// LLR embedding queue would risk a future caller forgetting the
// post-call discard. Keeping it standalone makes the discard guarantee
// auditable in one file.
//
// CDN load — @xenova/transformers 2.17.2 from cdn.jsdelivr.net per the
// project gotcha (Vite's dep-optimizer 504s on the npm path). Same shape
// as `src/lib/llr/engines/embedding/TransformersEmbeddingEngine.ts`.
//
// TODO Wave 2: register a kernel manifest + capability port for this
// service so other workshop services connect via
// `kernel.connect('storybook-workshop.vectorize', '<caller>')`. Today the
// UI imports the singleton directly.

import type {
    PillarVectorizerOpts,
} from './types';

/**
 * Stub pipeline shape (what `xfm.pipeline('image-feature-extraction', ...)`
 * resolves to). Returns `{ data }` where `data` is a Float32Array or
 * number[] holding the embedding.
 */
export type ImagePipeFn = (
    input: unknown,
    opts?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array | number[] }>;

/**
 * Test-injection hook for the WASM backend. In production this is the
 * pipeline loaded from the CDN; in tests, vitest passes a deterministic
 * stub. Kept off the public surface — only `__test` exposes it.
 */
export interface PillarVectorizerTestHooks {
    /** Pre-built image pipeline (skips the CDN import). */
    imagePipelineFactory?: () => Promise<ImagePipeFn>;
    /** Override probe order for deterministic tests. */
    probeOrder?: Array<'webgpu' | 'wasm'>;
}

/** Vector dim emitted by `Xenova/clip-vit-base-patch32`. */
export const PILLAR_EMBEDDING_DIM = 512;

const CDN_URL =
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

const MODEL_SOURCE = 'Xenova/clip-vit-base-patch32';

type Backend = 'webgpu' | 'wasm' | 'fallback';

export class PillarVectorizerService {
    private pipe: ImagePipeFn | null = null;
    private _activeBackend: Backend = 'fallback';
    private _warmupAttempted = false;
    private _warmupPromise: Promise<void> | null = null;
    private _initError: Error | null = null;
    private _hooks: PillarVectorizerTestHooks = {};

    /**
     * Pre-load the CLIP pipeline. Idempotent: subsequent calls return the
     * in-flight or resolved promise.
     *
     * Probe order: webgpu (only if `navigator.gpu` is reachable) → wasm.
     * Both failing leaves the service in `'fallback'` backend; callers
     * should consult `activeBackend()` and route to the
     * `/api/vectorize` endpoint per the consent flow.
     */
    async warmup(): Promise<void> {
        if (this._warmupPromise) return this._warmupPromise;
        this._warmupPromise = this._doWarmup();
        return this._warmupPromise;
    }

    /**
     * Run a single CLIP forward pass on the photo blob. Returns a 512-dim
     * Float32Array.
     *
     * Post-call invariant (privacy-critical): the local reference to
     * `photoBlob` is dropped synchronously before the embedding is
     * returned. The caller's binding to the original Blob is outside our
     * control; the workshop UI clears its own store after `vectorize()`
     * resolves (see §4.4 settler banter "Photo's gone from our memory
     * now"). This service guarantees only that WE do not hold a reference
     * past the function-return boundary.
     *
     * Throws if warmup has not been called, or if both webgpu + wasm
     * failed during warmup.
     */
    async vectorize(photoBlob: Blob): Promise<Float32Array> {
        if (!this._warmupAttempted) {
            await this.warmup();
        }
        if (this._activeBackend === 'fallback' || !this.pipe) {
            throw new Error(
                this._initError?.message ??
                'PillarVectorizer: no on-device backend available (webgpu + wasm both failed). Use /api/vectorize fallback.',
            );
        }

        // Scope the photo to this function frame ONLY. After this block
        // exits, the local `photo` binding is unreachable; only the
        // returned Float32Array survives.
        let photo: Blob | null = photoBlob;
        let result: { data: Float32Array | number[] };
        try {
            // The CLIP pipeline accepts a URL/Blob/RawImage; pass the blob
            // straight through. `pooling: 'mean'` + `normalize: true`
            // gives the 512-dim unit-norm embedding used for cosine sim.
            result = await this.pipe(photo, {
                pooling: 'mean',
                normalize: true,
            });
        } finally {
            // Synchronous discard — the local ref is gone before we return
            // to the caller. The Blob's underlying buffer is GC-eligible
            // once no outer scope retains it.
            photo = null;
        }

        const out =
            result.data instanceof Float32Array
                ? result.data
                : new Float32Array(result.data);

        if (out.length !== PILLAR_EMBEDDING_DIM) {
            throw new Error(
                `PillarVectorizer: unexpected embedding length ${out.length} (expected ${PILLAR_EMBEDDING_DIM})`,
            );
        }
        return out;
    }

    /** True once warmup has chosen a backend (success or fallback). */
    isReady(): boolean {
        return this._warmupAttempted;
    }

    /** Which backend the warmup probe landed on. */
    activeBackend(): Backend {
        return this._activeBackend;
    }

    private async _doWarmup(): Promise<void> {
        if (this._warmupAttempted) return;

        const probeOrder = this._hooks.probeOrder ?? ['webgpu', 'wasm'];

        for (const backend of probeOrder) {
            if (backend === 'webgpu') {
                // Cheap availability check — actual device acquisition is
                // done by the transformers pipeline itself.
                const gpu = (globalThis as any)?.navigator?.gpu;
                if (!gpu) continue;
            }
            try {
                const pipe = await this._loadPipeline();
                this.pipe = pipe;
                this._activeBackend = backend;
                this._warmupAttempted = true;
                return;
            } catch (err) {
                this._initError =
                    err instanceof Error
                        ? err
                        : new Error(String(err));
                // try the next backend
            }
        }

        // Both probes failed — service is in fallback state. isReady()
        // returns true so callers don't loop forever; activeBackend()
        // returns 'fallback' so callers route to the endpoint.
        this._activeBackend = 'fallback';
        this._warmupAttempted = true;
    }

    private async _loadPipeline(): Promise<ImagePipeFn> {
        if (this._hooks.imagePipelineFactory) {
            return this._hooks.imagePipelineFactory();
        }
        // Real CDN path. The @vite-ignore directive keeps Vite's dep
        // optimizer from attempting to resolve the URL — same workaround
        // as `TransformersEmbeddingEngine`.
        const xfm: any = await import(/* @vite-ignore */ CDN_URL);
        const pipe: ImagePipeFn = await xfm.pipeline(
            'image-feature-extraction',
            MODEL_SOURCE,
        );
        return pipe;
    }

    /** Test-only surface — never call from app code. */
    __test_setHooks(hooks: PillarVectorizerTestHooks): void {
        this._hooks = hooks;
    }

    /** Test-only surface — reset between specs. */
    __test_reset(): void {
        this.pipe = null;
        this._activeBackend = 'fallback';
        this._warmupAttempted = false;
        this._warmupPromise = null;
        this._initError = null;
        this._hooks = {};
    }
}

/**
 * Module-scoped singleton — matches the existing service convention
 * (PrivacyFilterService, ClawRegistry, etc.). The Wave-2 kernel manifest
 * will publish this same instance under `storybook-workshop.vectorize`.
 */
export const pillarVectorizerService = new PillarVectorizerService();

/**
 * Convenience re-export so callers don't have to import the type from a
 * sibling file when they only need `vectorize()`.
 */
export type { PillarVectorizerOpts };
