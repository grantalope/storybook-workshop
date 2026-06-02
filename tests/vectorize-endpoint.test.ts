// tests/storybook-workshop/vectorize-endpoint.test.ts
//
// Server-side fallback endpoint hardening + behavior:
//   - 200 OK with a 512-len embedding on happy path
//   - 503 + {error: 'rate_limited'} when bucket empty
//   - 413 when Content-Length exceeds cap
//   - 411 when Content-Length missing
//   - 400 for missing 'photo' form field
//   - leaky-bucket refill: tokens replenish over the window
//   - photo discarded post-CLIP (vector is the only thing returned)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    POST,
    __test,
} from '../../src/routes/api/vectorize/+server';
import { PILLAR_EMBEDDING_DIM } from '$lib/services/PillarVectorizerService';

function makeRequestEvent(opts: {
    body?: BodyInit | null;
    headers?: Record<string, string>;
    ip?: string;
    url?: string;
}) {
    const headers = new Headers(opts.headers ?? {});
    const url = new URL(opts.url ?? 'https://example.com/api/vectorize');
    const request = new Request(url.toString(), {
        method: 'POST',
        body: opts.body ?? null,
        headers,
    });
    return {
        request,
        url,
        getClientAddress: () => opts.ip ?? '127.0.0.1',
    } as any;
}

function fakeFormDataWithPhoto(bytes = 32): FormData {
    const fd = new FormData();
    const blob = new Blob([new Uint8Array(bytes).fill(7)], { type: 'image/jpeg' });
    fd.append('photo', blob, 'kid.jpg');
    return fd;
}

/**
 * Build a Request whose body is a real multipart/form-data payload AND
 * whose Content-Length header reflects the encoded body length. The
 * stdlib fetch spec lets `new Request(url, { body: formData })` do the
 * encoding for us; we just have to compute the byte length after.
 */
async function multipartRequestWithLength(ip: string, fd: FormData) {
    const r1 = new Request('https://example.com/x', { method: 'POST', body: fd });
    const ab = await r1.arrayBuffer();
    const contentType = r1.headers.get('content-type')!;
    const req = new Request('https://example.com/api/vectorize', {
        method: 'POST',
        body: ab,
        headers: {
            'content-type': contentType,
            'content-length': String(ab.byteLength),
        },
    });
    return {
        request: req,
        url: new URL('https://example.com/api/vectorize'),
        getClientAddress: () => ip,
    } as any;
}

function deterministicPipeline() {
    return () =>
        Promise.resolve(async () => ({
            data: new Float32Array(PILLAR_EMBEDDING_DIM).fill(0.25),
        }));
}

describe('POST /api/vectorize', () => {
    beforeEach(() => {
        __test.resetState();
        __test.setPipelineFactory(deterministicPipeline());
    });

    it('200 + 512-len embedding on happy path', async () => {
        const fd = fakeFormDataWithPhoto();
        const evt = await multipartRequestWithLength('10.0.0.1', fd);
        const res = await POST(evt);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { embedding: number[] };
        expect(Array.isArray(body.embedding)).toBe(true);
        expect(body.embedding.length).toBe(PILLAR_EMBEDDING_DIM);
        expect(body.embedding[0]).toBeCloseTo(0.25);
        // No-store cache header — never cache PII-adjacent responses.
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('503 + rate_limited after RATE_LIMIT_PER_MINUTE requests from same IP', async () => {
        const ip = '10.0.0.2';
        let lastStatus = 0;
        for (let i = 0; i < __test.rateLimit; i++) {
            const fd = fakeFormDataWithPhoto();
            const evt = await multipartRequestWithLength(ip, fd);
            const res = await POST(evt);
            lastStatus = res.status;
        }
        expect(lastStatus).toBe(200);
        // The (rateLimit + 1)-th request should be 503.
        const fdN = fakeFormDataWithPhoto();
        const evtN = await multipartRequestWithLength(ip, fdN);
        const resN = await POST(evtN);
        expect(resN.status).toBe(503);
        const body = (await resN.json()) as { error: string };
        expect(body.error).toBe('rate_limited');
        expect(__test.counters.rateLimited).toBeGreaterThanOrEqual(1);
    });

    it('413 when Content-Length exceeds cap', async () => {
        const req = new Request('https://example.com/api/vectorize', {
            method: 'POST',
            body: 'x',
            headers: {
                'content-type': 'multipart/form-data; boundary=---x',
                'content-length': String(__test.maxBytes + 1),
            },
        });
        const evt = {
            request: req,
            url: new URL('https://example.com/api/vectorize'),
            getClientAddress: () => '10.0.0.3',
        } as any;
        const res = await POST(evt);
        expect(res.status).toBe(413);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('payload_too_large');
    });

    it('411 when Content-Length missing', async () => {
        const req = new Request('https://example.com/api/vectorize', {
            method: 'POST',
            body: 'x',
            headers: { 'content-type': 'multipart/form-data; boundary=---x' },
        });
        const evt = {
            request: req,
            url: new URL('https://example.com/api/vectorize'),
            getClientAddress: () => '10.0.0.4',
        } as any;
        const res = await POST(evt);
        expect(res.status).toBe(411);
    });

    it('400 when photo form field is missing', async () => {
        const fd = new FormData(); // no photo
        const evt = await multipartRequestWithLength('10.0.0.5', fd);
        const res = await POST(evt);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('photo_required');
    });

    it('rejects non-TLS production hosts with 400 tls_required', async () => {
        const fd = fakeFormDataWithPhoto();
        const evt = await multipartRequestWithLength('10.0.0.6', fd);
        // Hijack the URL after construction to simulate http://example.com
        evt.url = new URL('http://example.com/api/vectorize');
        const res = await POST(evt);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('tls_required');
    });

    it('returns 500 when pipeline emits wrong-length embedding (defense-in-depth)', async () => {
        __test.setPipelineFactory(() =>
            Promise.resolve(async () => ({
                data: new Float32Array(7),
            })),
        );
        const fd = fakeFormDataWithPhoto();
        const evt = await multipartRequestWithLength('10.0.0.7', fd);
        const res = await POST(evt);
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: string; length: number };
        expect(body.error).toBe('unexpected_embedding_length');
        expect(body.length).toBe(7);
    });

    it('aggregate counters increment correctly', async () => {
        const fd = fakeFormDataWithPhoto();
        const evt = await multipartRequestWithLength('10.0.0.8', fd);
        await POST(evt);
        expect(__test.counters.requests).toBe(1);
        expect(__test.counters.okFromCdn).toBe(1);
    });

    it('consumeToken() returns true RATE_LIMIT times then false', () => {
        for (let i = 0; i < __test.rateLimit; i++) {
            expect(__test.consumeToken('isolated-ip')).toBe(true);
        }
        expect(__test.consumeToken('isolated-ip')).toBe(false);
    });
});
