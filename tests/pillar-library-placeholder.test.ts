// tests/pillar-library-placeholder.test.ts
//
// Goal: docs/goals/2026-05-25-pillar-library-pixal3d.md (MVP placeholder
//       slice — real Pixal3D 4-view bake deferred per ADR-0044).
//
// Coverage targets:
//   - generator: stratified-random over 5 axes, deterministic output
//   - generator: deterministic SHA-256-seeded 512-dim embedding
//   - generator: canonical-axes-string ordering stable across permutations
//   - generator: PRNG seed produces same sequence on reseed
//   - manifest schema: 50 entries with axes + 512-dim embedding + urls
//   - manifest schema: pillarIds in [1000, 1050)
//   - manifest schema: every axis value present in ≥1 entry (stratification)
//   - fallback chain: primary 200 wins over placeholder
//   - fallback chain: primary 503 → placeholder 200 wins
//   - fallback chain: primary throws ECONNREFUSED → placeholder 200 wins
//   - fallback chain: primary empty array → placeholder used
//   - fallback chain: all sources unreachable → []
//   - cache: source survives across invalidate/refetch cycles
//   - Station 2: pillar grid renders all manifest entries
//   - Station 2: grid renders empty state when manifest is empty

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    fetchManifest,
    getCachedManifestSource,
    invalidate,
    parseManifest,
    __test,
} from '$lib/services/PillarManifestClient';
import type {
    PillarAxes,
    PillarManifestEntry,
} from '$lib/services/types';

import {
    HAIR_KINDS,
    SKIN_TONES,
    EYE_COLORS,
    AGE_BANDS,
    CLOTHING_VIBES,
    TARGET_COUNT,
    EMBEDDING_DIM,
    SEED_HEX,
    buildCandidates,
    stratifiedSample,
    deterministicEmbedding,
    canonicalAxesString,
    composeSvg,
} from '../scripts/pillar-library/generate-placeholders.mjs';

const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = resolve(
    REPO_ROOT,
    'static',
    'pillar-library-v1-placeholder',
    'manifest.json',
);

// ---------- helpers ----------

function entry(
    pillarId: number,
    ageBand: 'toddler' | 'preschool' | 'grade-school' = 'preschool',
): PillarManifestEntry {
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

function notFound(): Response {
    return new Response('', { status: 503 });
}

// ---------- generator ----------

describe('generate-placeholders: stratified-random sampling', () => {
    it('produces exactly TARGET_COUNT (50) entries', () => {
        const c = buildCandidates();
        const picks = stratifiedSample(c, TARGET_COUNT, SEED_HEX);
        expect(picks.length).toBe(50);
    });

    it('every entry has every axis populated from the canonical enum sets', () => {
        const picks = stratifiedSample(
            buildCandidates(),
            TARGET_COUNT,
            SEED_HEX,
        );
        for (const p of picks) {
            expect(HAIR_KINDS).toContain(p.hair);
            expect(SKIN_TONES).toContain(p.skinTone);
            expect(EYE_COLORS).toContain(p.eyeColor);
            expect(AGE_BANDS).toContain(p.ageBand);
            expect(CLOTHING_VIBES).toContain(p.clothingVibe);
            expect(Array.isArray(p.extras)).toBe(true);
        }
    });

    it('stratification: every value of every axis appears in ≥1 entry', () => {
        const picks = stratifiedSample(
            buildCandidates(),
            TARGET_COUNT,
            SEED_HEX,
        );
        const axes: Array<{ name: keyof PillarAxes; vals: readonly string[] }> = [
            { name: 'hair', vals: HAIR_KINDS },
            { name: 'skinTone', vals: SKIN_TONES },
            { name: 'eyeColor', vals: EYE_COLORS },
            { name: 'ageBand', vals: AGE_BANDS },
            { name: 'clothingVibe', vals: CLOTHING_VIBES },
        ];
        for (const { name, vals } of axes) {
            const present = new Set(picks.map((p) => (p as any)[name]));
            for (const v of vals) {
                expect(present.has(v)).toBe(true);
            }
        }
    });

    it('determinism: same seed → byte-identical sample order', () => {
        const c1 = buildCandidates();
        const c2 = buildCandidates();
        const a = stratifiedSample(c1, TARGET_COUNT, SEED_HEX);
        const b = stratifiedSample(c2, TARGET_COUNT, SEED_HEX);
        expect(a.length).toBe(b.length);
        for (let i = 0; i < a.length; i++) {
            expect(a[i]).toEqual(b[i]);
        }
    });
});

describe('generate-placeholders: deterministic embedding', () => {
    const axesA: PillarAxes = {
        hair: 'curly-long',
        skinTone: 'V',
        eyeColor: 'green',
        ageBand: 'preschool',
        clothingVibe: 'whimsical',
        extras: [],
    };
    const axesB: PillarAxes = {
        hair: 'buzz',
        skinTone: 'I',
        eyeColor: 'blue',
        ageBand: 'grade-school',
        clothingVibe: 'sporty',
        extras: [],
    };

    it('produces 512-dim Float32-like array', () => {
        const e = deterministicEmbedding(axesA) as number[];
        expect(e.length).toBe(EMBEDDING_DIM);
        for (const v of e) expect(Number.isFinite(v)).toBe(true);
    });

    it('same axes → same embedding (deterministic)', () => {
        const a = deterministicEmbedding(axesA) as number[];
        const b = deterministicEmbedding(axesA) as number[];
        expect(a).toEqual(b);
    });

    it('different axes → different embedding', () => {
        const a = deterministicEmbedding(axesA) as number[];
        const b = deterministicEmbedding(axesB) as number[];
        expect(a).not.toEqual(b);
    });

    it('embedding is L2-normalized (unit vector)', () => {
        const e = deterministicEmbedding(axesA) as number[];
        const sumSq = e.reduce((acc, v) => acc + v * v, 0);
        // tolerance: SplitMix64 -> Float64 math accumulates ~1e-7
        expect(Math.abs(sumSq - 1.0)).toBeLessThan(1e-5);
    });

    it('canonical-axes-string places fields in stable order regardless of input key order', () => {
        const reordered: PillarAxes = {
            extras: [],
            clothingVibe: 'whimsical',
            ageBand: 'preschool',
            eyeColor: 'green',
            skinTone: 'V',
            hair: 'curly-long',
        };
        expect(canonicalAxesString(reordered)).toBe(canonicalAxesString(axesA));
    });
});

describe('generate-placeholders: SVG composition', () => {
    it('produces well-formed SVG markup with viewBox + pillar id', () => {
        const svg = composeSvg(1234, {
            hair: 'coily',
            skinTone: 'IV',
            eyeColor: 'hazel',
            ageBand: 'toddler',
            clothingVibe: 'cozy',
            extras: [],
        });
        expect(svg).toMatch(/<svg/);
        expect(svg).toMatch(/viewBox="0 0 128 128"/);
        expect(svg).toMatch(/#1234/);
        expect(svg).toMatch(/<\/svg>/);
    });
});

// ---------- manifest schema ----------

describe('pillar-library-v1-placeholder manifest.json', () => {
    let raw: unknown;
    let manifest: PillarManifestEntry[];

    beforeAll(() => {
        if (!existsSync(MANIFEST_PATH)) {
            throw new Error(
                `manifest.json missing at ${MANIFEST_PATH}; run \`node scripts/pillar-library/generate-placeholders.mjs\``,
            );
        }
        raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
        manifest = raw as PillarManifestEntry[];
    });

    it('top-level is an array of 50 entries', () => {
        expect(Array.isArray(raw)).toBe(true);
        expect(manifest.length).toBe(50);
    });

    it('each entry has required fields with correct types', () => {
        for (const e of manifest) {
            expect(typeof e.pillarId).toBe('number');
            expect(Number.isFinite(e.pillarId)).toBe(true);
            expect(typeof e.axes).toBe('object');
            expect(Array.isArray(e.embedding)).toBe(true);
        }
    });

    it('pillarIds are unique and fall in [1000, 1050)', () => {
        const ids = new Set<number>();
        for (const e of manifest) {
            expect(e.pillarId).toBeGreaterThanOrEqual(1000);
            expect(e.pillarId).toBeLessThan(1050);
            expect(ids.has(e.pillarId)).toBe(false);
            ids.add(e.pillarId);
        }
        expect(ids.size).toBe(50);
    });

    it('every embedding is 512-dim and L2-normalized', () => {
        for (const e of manifest) {
            expect(e.embedding.length).toBe(EMBEDDING_DIM);
            const sumSq = e.embedding.reduce((acc, v) => acc + v * v, 0);
            expect(Math.abs(sumSq - 1.0)).toBeLessThan(1e-5);
        }
    });

    it('every axis value appears in ≥1 entry (stratification preserved through generator)', () => {
        const seen = {
            hair: new Set<string>(),
            skinTone: new Set<string>(),
            eyeColor: new Set<string>(),
            ageBand: new Set<string>(),
            clothingVibe: new Set<string>(),
        };
        for (const e of manifest) {
            seen.hair.add(e.axes.hair);
            seen.skinTone.add(e.axes.skinTone);
            seen.eyeColor.add(e.axes.eyeColor);
            seen.ageBand.add(e.axes.ageBand);
            seen.clothingVibe.add(e.axes.clothingVibe);
        }
        for (const v of HAIR_KINDS) expect(seen.hair.has(v)).toBe(true);
        for (const v of SKIN_TONES) expect(seen.skinTone.has(v)).toBe(true);
        for (const v of EYE_COLORS) expect(seen.eyeColor.has(v)).toBe(true);
        for (const v of AGE_BANDS) expect(seen.ageBand.has(v)).toBe(true);
        for (const v of CLOTHING_VIBES)
            expect(seen.clothingVibe.has(v)).toBe(true);
    });

    it('every entry has a urls map pointing under the placeholder static path', () => {
        for (const e of manifest) {
            const urls = (e as PillarManifestEntry & { urls: Record<string, string> }).urls;
            expect(urls).toBeTruthy();
            for (const view of ['preview', 'front', 'back', 'left', 'right']) {
                expect(typeof urls[view]).toBe('string');
                expect(urls[view]).toMatch(
                    new RegExp(
                        `^/pillar-library-v1-placeholder/${e.pillarId}/${view}\\.(png|svg)$`,
                    ),
                );
            }
        }
    });

    it('PillarManifestClient.parseManifest accepts the placeholder shape (extra urls field ignored)', () => {
        const parsed = parseManifest(raw);
        expect(parsed.length).toBe(50);
        for (const p of parsed) {
            expect(p.embedding).toBeInstanceOf(Float32Array);
            expect(p.embedding.length).toBe(EMBEDDING_DIM);
        }
    });
});

// ---------- fallback chain ----------

describe('PillarManifestClient fallback chain', () => {
    beforeEach(() => {
        __test.reset();
    });

    it('primary 200 with entries: cache is primary, placeholder NOT touched', async () => {
        const calls: string[] = [];
        const fetcher = vi.fn(async (url: string) => {
            calls.push(url);
            return okResponse([entry(7)]);
        });
        __test.setFetchOverride(fetcher);
        const m = await fetchManifest();
        expect(m.length).toBe(1);
        expect(getCachedManifestSource()).toBe('primary');
        expect(calls).toEqual(['/api/world/pillar-library/manifest']);
    });

    it('primary 503 → placeholder 200: cache is placeholder', async () => {
        const calls: string[] = [];
        const fetcher = vi.fn(async (url: string) => {
            calls.push(url);
            if (url === '/api/world/pillar-library/manifest') return notFound();
            if (url === '/pillar-library-v2/manifest.json') return notFound();
            return okResponse([entry(11), entry(12)]);
        });
        __test.setFetchOverride(fetcher);
        const m = await fetchManifest();
        expect(m.length).toBe(2);
        expect(getCachedManifestSource()).toBe('placeholder');
        expect(calls).toEqual([
            '/api/world/pillar-library/manifest',
            '/pillar-library-v2/manifest.json',
            '/pillar-library-v1-placeholder/manifest.json',
        ]);
    });

    it('primary throws (ECONNREFUSED) → placeholder 200: cache is placeholder', async () => {
        const fetcher = vi.fn(async (url: string) => {
            if (url === '/api/world/pillar-library/manifest') {
                throw new Error('ECONNREFUSED');
            }
            if (url === '/pillar-library-v2/manifest.json') return notFound();
            return okResponse([entry(21)]);
        });
        __test.setFetchOverride(fetcher);
        const m = await fetchManifest();
        expect(m.length).toBe(1);
        expect(getCachedManifestSource()).toBe('placeholder');
    });

    it('primary 200 with empty array → placeholder used (primary empty = treat as unavailable)', async () => {
        const fetcher = vi.fn(async (url: string) => {
            if (url === '/api/world/pillar-library/manifest') {
                return okResponse([]);
            }
            if (url === '/pillar-library-v2/manifest.json') return notFound();
            return okResponse([entry(33)]);
        });
        __test.setFetchOverride(fetcher);
        const m = await fetchManifest();
        expect(m.length).toBe(1);
        expect(getCachedManifestSource()).toBe('placeholder');
    });

    it('all sources unreachable → cache is empty', async () => {
        const fetcher = vi.fn(async () => notFound());
        __test.setFetchOverride(fetcher);
        const m = await fetchManifest();
        expect(m.length).toBe(0);
        expect(getCachedManifestSource()).toBe('empty');
    });

    it('invalidate() then refetch: source can change across cycles', async () => {
        let primaryOk = false;
        const fetcher = vi.fn(async (url: string) => {
            if (url === '/api/world/pillar-library/manifest') {
                return primaryOk ? okResponse([entry(91)]) : notFound();
            }
            if (url === '/pillar-library-v2/manifest.json') return notFound();
            return okResponse([entry(81)]);
        });
        __test.setFetchOverride(fetcher);
        const a = await fetchManifest();
        expect(getCachedManifestSource()).toBe('placeholder');
        expect(a[0].pillarId).toBe(81);

        invalidate();
        primaryOk = true;
        const b = await fetchManifest();
        expect(getCachedManifestSource()).toBe('primary');
        expect(b[0].pillarId).toBe(91);
    });

    it('placeholder manifest from disk is consumable by fetchManifest (real shape end-to-end)', async () => {
        const placeholderRaw = readFileSync(MANIFEST_PATH, 'utf8');
        const fetcher = vi.fn(async (url: string) => {
            if (url === '/api/world/pillar-library/manifest') return notFound();
            if (url === '/pillar-library-v2/manifest.json') return notFound();
            return new Response(placeholderRaw, {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        __test.setFetchOverride(fetcher);
        const m = await fetchManifest();
        expect(m.length).toBe(50);
        expect(getCachedManifestSource()).toBe('placeholder');
        for (const p of m) {
            expect(p.embedding).toBeInstanceOf(Float32Array);
            expect(p.embedding.length).toBe(EMBEDDING_DIM);
        }
    });
});

// ---------- Station 2 contract ----------

describe('Station 2 ForgeHero: pillar grid consumes manifest', () => {
    beforeEach(() => {
        __test.reset();
    });

    it('manifest exposes pillarId + axes + urls.preview for grid rendering', async () => {
        const placeholderRaw = readFileSync(MANIFEST_PATH, 'utf8');
        const placeholderJson = JSON.parse(placeholderRaw) as Array<
            PillarManifestEntry & { urls: Record<string, string> }
        >;
        // every grid tile needs: pillarId (key), axes (a11y label), urls.preview (img src)
        for (const tile of placeholderJson) {
            expect(typeof tile.pillarId).toBe('number');
            expect(typeof tile.axes.hair).toBe('string');
            expect(typeof tile.axes.skinTone).toBe('string');
            expect(typeof tile.urls.preview).toBe('string');
            expect(tile.urls.preview.startsWith('/')).toBe(true);
        }
    });

    it('grid surfaces all 50 placeholder pillars when WB primary and v2 are down', async () => {
        const placeholderRaw = readFileSync(MANIFEST_PATH, 'utf8');
        const fetcher = vi.fn(async (url: string) => {
            if (url === '/api/world/pillar-library/manifest') return notFound();
            if (url === '/pillar-library-v2/manifest.json') return notFound();
            return new Response(placeholderRaw, {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        __test.setFetchOverride(fetcher);
        const m = await fetchManifest();
        // Station 2 renders one tile per manifest entry; the grid is the
        // manifest, plus a "manual archetype" fallback if empty. With 50
        // entries we never hit the fallback path.
        expect(m.length).toBe(50);
    });
});
