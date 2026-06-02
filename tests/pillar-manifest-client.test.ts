// tests/storybook-workshop/pillar-manifest-client.test.ts
//
// Covers:
//   - cache: 2 consecutive fetchManifest() calls = 1 network fetch
//   - invalidate() triggers refetch
//   - in-flight dedup: concurrent fetchManifest() calls share one fetch
//   - empty array when WB unreachable (network throws)
//   - empty array when WB returns non-ok status
//   - parseManifest() drops malformed entries with warn, keeps valid ones
//   - parseManifest() throws when top-level shape wrong
//   - embeddings converted from number[] → Float32Array

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    fetchManifest,
    invalidate,
    parseManifest,
    getCachedManifest,
    __test,
} from '$lib/services/PillarManifestClient';
import type { PillarManifestEntry } from '$lib/services/types';

function entry(pillarId: number, ageBand: 'toddler' | 'preschool' | 'grade-school' = 'preschool'): PillarManifestEntry {
    return {
        pillarId,
        axes: {
            hair: 'wavy-short',
            skinTone: 'III',
            eyeColor: 'brown',
            ageBand,
            clothingVibe: 'casual',
            extras: [],
        },
        embedding: [0.1, 0.2, 0.3, 0.4],
    };
}

function okResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('PillarManifestClient.fetchManifest', () => {
    beforeEach(() => {
        __test.reset();
    });

    it('caches: 2 calls = 1 network fetch', async () => {
        const fetcher = vi.fn(async () => okResponse([entry(1), entry(2)]));
        __test.setFetchOverride(fetcher);
        const a = await fetchManifest();
        const b = await fetchManifest();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(a).toBe(b); // exact same array ref from cache
        expect(a.length).toBe(2);
    });

    it('invalidate() forces a refetch on the next call', async () => {
        const fetcher = vi.fn(async () => okResponse([entry(1)]));
        __test.setFetchOverride(fetcher);
        await fetchManifest();
        invalidate();
        await fetchManifest();
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('in-flight dedup: 2 concurrent calls share one fetch', async () => {
        let resolveFetch!: (r: Response) => void;
        const fetcher = vi.fn(
            () =>
                new Promise<Response>((res) => {
                    resolveFetch = res;
                }),
        );
        __test.setFetchOverride(fetcher);
        const p1 = fetchManifest();
        const p2 = fetchManifest();
        // Resolve the single in-flight fetch.
        resolveFetch(okResponse([entry(1)]));
        const [a, b] = await Promise.all([p1, p2]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
    });

    it('returns [] when fetch throws (WB unreachable)', async () => {
        __test.setFetchOverride(async () => {
            throw new Error('ECONNREFUSED');
        });
        const a = await fetchManifest();
        expect(a).toEqual([]);
    });

    it('returns [] on non-ok response', async () => {
        __test.setFetchOverride(async () => new Response('nope', { status: 503 }));
        const a = await fetchManifest();
        expect(a).toEqual([]);
    });

    it('getCachedManifest() returns the cached array', async () => {
        __test.setFetchOverride(async () => okResponse([entry(1)]));
        expect(getCachedManifest()).toBeNull();
        await fetchManifest();
        const cached = getCachedManifest();
        expect(cached).not.toBeNull();
        expect(cached!.length).toBe(1);
    });

    it('converts inbound number[] embedding to Float32Array', async () => {
        __test.setFetchOverride(async () =>
            okResponse([entry(42)]),
        );
        const [p] = await fetchManifest();
        expect(p.embedding).toBeInstanceOf(Float32Array);
        expect(p.embedding.length).toBe(4);
        expect(p.embedding[0]).toBeCloseTo(0.1);
    });
});

describe('PillarManifestClient.parseManifest', () => {
    it('throws when top-level is not an array', () => {
        expect(() => parseManifest({ pillars: [] })).toThrow(/expected top-level array/);
    });

    it('drops entries with missing pillarId', () => {
        const out = parseManifest([
            entry(1),
            // missing pillarId
            { axes: entry(2).axes, embedding: [0, 1] },
        ]);
        expect(out.length).toBe(1);
        expect(out[0].pillarId).toBe(1);
    });

    it('drops entries with invalid axes', () => {
        const out = parseManifest([
            entry(1),
            { pillarId: 2, axes: 'not an object', embedding: [0, 1] },
        ]);
        expect(out.length).toBe(1);
        expect(out[0].pillarId).toBe(1);
    });

    it('drops entries with empty embedding', () => {
        const out = parseManifest([
            entry(1),
            { pillarId: 2, axes: entry(2).axes, embedding: [] },
        ]);
        expect(out.length).toBe(1);
    });

    it('drops entries with non-finite embedding values', () => {
        const out = parseManifest([
            entry(1),
            {
                pillarId: 2,
                axes: entry(2).axes,
                embedding: [0.1, NaN, 0.3],
            },
        ]);
        expect(out.length).toBe(1);
        expect(out[0].pillarId).toBe(1);
    });
});
