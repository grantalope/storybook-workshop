// src/routes/api/vectorize/+server.ts
//
// Server-side CLIP fallback for the Storybook Workshop S2 station. Invoked
// ONLY when the on-device WASM CLIP fails to initialize (see
// PillarVectorizerService.activeBackend === 'fallback') AND the parent
// has explicitly consented to the one-shot upload (UI gates this via the
// disclosure modal per ADR-0043).
//
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §3.3 + §4.4
// ADR:  docs/adr/0043
//
// Hardening posture (audit-ready):
// - Stateless: no DB, no IDB, no session, no auth header consumed.
// - No logging beyond an in-memory aggregate counter (request count +
//   rate-limit hit count). No request body bytes ever land on disk.
// - Photo discarded synchronously after the CLIP forward pass. The
//   Float32Array vector is the ONLY thing that survives past the
//   function-return boundary.
// - TLS-only check (rejects http: in production). Vite dev server is
//   exempt because dev runs over http://localhost by convention.
// - Per-IP leaky-bucket rate limit (10 req/min). Returns 503 + a
//   stable `{ error: 'rate_limited' }` JSON envelope on overflow.
// - 10 MB body cap (defends against memory-pressure DoS via huge
//   uploads); 4xx returned pre-CLIP so we never spin up the pipeline
//   on garbage input.

import type { RequestHandler } from './$types';
import { PILLAR_EMBEDDING_DIM } from '$lib/services/PillarVectorizerService';

const MAX_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;

interface BucketState {
    /** Tokens currently held. Refills at RATE_LIMIT_PER_MINUTE per RATE_WINDOW_MS. */
    tokens: number;
    /** Wall-clock ms at last refill. */
    lastRefill: number;
}

/** Per-IP leaky-bucket state. Eviction: capped at 10k entries, oldest evicted. */
const buckets = new Map<string, BucketState>();
const BUCKETS_MAX = 10_000;
const BUCKETS_EVICT_BATCH = 100;

/** In-memory aggregate counters — never persisted, surface via internal debug if ever needed. */
const counters = {
    requests: 0,
    rateLimited: 0,
    okFromCdn: 0,
    failures: 0,
};

/**
 * Pluggable CLIP pipeline factory. In production, the pipeline is
 * loaded from CDN exactly the same way the on-device path loads it (see
 * PillarVectorizerService) — keeps the embedding space identical so
 * server-fallback vectors are cosine-comparable with on-device ones.
 *
 * Tests can override via `__test.setPipelineFactory` to skip the CDN.
 */
type ImagePipeFn = (
    input: unknown,
    opts?: { pooling?: string; normalize?: boolean },
) => Promise<{ data: Float32Array | number[] }>;

let _pipelineFactoryOverride: (() => Promise<ImagePipeFn>) | null = null;
let _cachedPipeline: ImagePipeFn | null = null;

async function getPipeline(): Promise<ImagePipeFn> {
    if (_cachedPipeline) return _cachedPipeline;
    if (_pipelineFactoryOverride) {
        _cachedPipeline = await _pipelineFactoryOverride();
        return _cachedPipeline;
    }
    // Dynamic CDN import — keep identical to PillarVectorizerService's
    // path so the embedding space matches.
    const xfm: any = await import(
        /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
    );
    _cachedPipeline = (await xfm.pipeline(
        'image-feature-extraction',
        'Xenova/clip-vit-base-patch32',
    )) as ImagePipeFn;
    return _cachedPipeline;
}

function _clientIp(headers: Headers, getClientAddress: () => string): string {
    // Prefer SvelteKit's `getClientAddress` (respects platform trust);
    // fall back to xff for proxied dev envs.
    try {
        const direct = getClientAddress();
        if (direct) return direct;
    } catch {
        // ignore
    }
    const xff = headers.get('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
    return 'unknown';
}

/**
 * Returns `true` if the request is within the per-IP budget and consumes
 * a token; `false` if the bucket is empty (caller should 503).
 */
function _consumeToken(ip: string): boolean {
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket) {
        bucket = { tokens: RATE_LIMIT_PER_MINUTE, lastRefill: now };
        buckets.set(ip, bucket);
        _evictIfNeeded();
    } else {
        // Refill proportional to elapsed window.
        const elapsed = now - bucket.lastRefill;
        if (elapsed >= RATE_WINDOW_MS) {
            bucket.tokens = RATE_LIMIT_PER_MINUTE;
            bucket.lastRefill = now;
        } else if (elapsed > 0) {
            const refill =
                (elapsed / RATE_WINDOW_MS) * RATE_LIMIT_PER_MINUTE;
            bucket.tokens = Math.min(
                RATE_LIMIT_PER_MINUTE,
                bucket.tokens + refill,
            );
            bucket.lastRefill = now;
        }
    }
    if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
    }
    return false;
}

function _evictIfNeeded(): void {
    if (buckets.size <= BUCKETS_MAX) return;
    let removed = 0;
    for (const k of buckets.keys()) {
        buckets.delete(k);
        if (++removed >= BUCKETS_EVICT_BATCH) break;
    }
}

function _isTlsOrLocal(url: URL): boolean {
    if (url.protocol === 'https:') return true;
    // Dev-server carve-out: localhost over http: is fine (Vite default).
    if (
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '::1')
    ) {
        return true;
    }
    return false;
}

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
    counters.requests++;

    if (!_isTlsOrLocal(url)) {
        return jsonResponse(
            { error: 'tls_required' },
            400,
        );
    }

    const ip = _clientIp(request.headers, getClientAddress);

    if (!_consumeToken(ip)) {
        counters.rateLimited++;
        return jsonResponse(
            { error: 'rate_limited' },
            503,
        );
    }

    // Body size check via Content-Length pre-read. multipart/form-data
    // POSTs always set Content-Length in practice (browsers + curl both
    // do); absence = treat as 411 since we can't enforce the cap.
    const cl = request.headers.get('content-length');
    if (cl) {
        const n = Number(cl);
        if (!Number.isFinite(n) || n < 0) {
            return jsonResponse({ error: 'invalid_content_length' }, 400);
        }
        if (n > MAX_BYTES) {
            return jsonResponse({ error: 'payload_too_large' }, 413);
        }
    } else {
        return jsonResponse({ error: 'content_length_required' }, 411);
    }

    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        counters.failures++;
        return jsonResponse({ error: 'invalid_form_data' }, 400);
    }

    const entry = form.get('photo');
    if (!(entry instanceof Blob)) {
        return jsonResponse({ error: 'photo_required' }, 400);
    }

    // Scope the blob to this function frame — we drop the ref in the
    // finally block before returning.
    let photo: Blob | null = entry;
    let embedding: Float32Array | null = null;
    try {
        let pipe: ImagePipeFn;
        try {
            pipe = await getPipeline();
        } catch (err) {
            counters.failures++;
            return jsonResponse(
                { error: 'pipeline_unavailable' },
                503,
            );
        }
        let result: { data: Float32Array | number[] };
        try {
            result = await pipe(photo, {
                pooling: 'mean',
                normalize: true,
            });
        } catch (err) {
            counters.failures++;
            return jsonResponse({ error: 'vectorize_failed' }, 500);
        }
        const vec =
            result.data instanceof Float32Array
                ? result.data
                : new Float32Array(result.data);
        if (vec.length !== PILLAR_EMBEDDING_DIM) {
            counters.failures++;
            return jsonResponse(
                {
                    error: 'unexpected_embedding_length',
                    length: vec.length,
                },
                500,
            );
        }
        embedding = vec;
    } finally {
        // Synchronous discard. The Blob's underlying body is GC-eligible
        // once no outer scope retains it. FormData entries are also
        // dropped when `form` goes out of scope after function return.
        photo = null;
    }

    counters.okFromCdn++;
    return jsonResponse(
        {
            embedding: Array.from(embedding!),
        },
        200,
    );
};

function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

/**
 * Test-only surface. Lets vitest:
 * - inject a deterministic pipeline (no CDN required)
 * - reset bucket state between specs
 * - inspect aggregate counters
 */
export const __test = {
    setPipelineFactory(fn: (() => Promise<ImagePipeFn>) | null): void {
        _pipelineFactoryOverride = fn;
        _cachedPipeline = null;
    },
    resetState(): void {
        buckets.clear();
        _cachedPipeline = null;
        counters.requests = 0;
        counters.rateLimited = 0;
        counters.okFromCdn = 0;
        counters.failures = 0;
    },
    counters,
    consumeToken: _consumeToken,
    rateLimit: RATE_LIMIT_PER_MINUTE,
    maxBytes: MAX_BYTES,
};
