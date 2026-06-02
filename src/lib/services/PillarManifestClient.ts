// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/storybook-workshop/PillarManifestClient.ts
//
// Fetches the World Builder pillar-library manifest exactly once per
// session, caches in a module-scoped variable, validates the wire shape,
// converts inbound `number[]` embeddings to Float32Array.
//
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §3.2
// ADR:  docs/adr/0043 — only opaque integer `pillarId` ever leaves the
//        device; the manifest itself is anonymous, public, CDN-cacheable.
//
// Why module-scoped (not class-scoped) cache: the manifest is genuinely
// process-wide singleton state — every workshop session in the same tab
// reads the same upstream catalog. Class-scoping would invite confusion
// about "which instance has the cache." The trade-off (one global mutable
// ref) is acceptable because the cache is immutable per-fetch and
// invalidate() is the only mutator.
//
// Failure mode: on any network / parse error, this returns an empty
// `Pillar[]` and logs a warning. Downstream `PillarMatcherService.match()`
// will return [] which the workshop UI surfaces as the
// "WB pillar library unavailable, please try again later." path.

import type { Pillar, PillarAxes, PillarManifestEntry } from './types';

const MANIFEST_URL = '/api/world/pillar-library/manifest';

/** Module-scoped session cache. Cleared via `invalidate()`. */
let _cache: Pillar[] | null = null;
let _inflight: Promise<Pillar[]> | null = null;

/** Test-injection hook for the fetcher (so vitest doesn't need a real network). */
let _fetchOverride:
    | ((url: string) => Promise<Response>)
    | null = null;

/**
 * One-shot fetch + cache. Subsequent callers within a session get the
 * cached array. `invalidate()` forces a re-fetch on next call.
 *
 * Returns `[]` (and logs a warning) if the manifest endpoint is
 * unreachable or returns malformed data — the workshop UI treats empty
 * as "library unavailable" rather than crashing.
 */
export async function fetchManifest(): Promise<Pillar[]> {
    if (_cache) return _cache;
    if (_inflight) return _inflight;

    _inflight = (async (): Promise<Pillar[]> => {
        try {
            const fetcher =
                _fetchOverride ??
                (typeof fetch !== 'undefined' ? fetch : null);
            if (!fetcher) {
                console.warn(
                    '[PillarManifestClient] no fetch available; returning empty manifest',
                );
                _cache = [];
                return _cache;
            }
            const res = await fetcher(MANIFEST_URL);
            if (!res.ok) {
                console.warn(
                    `[PillarManifestClient] manifest fetch ${res.status} ${res.statusText}; returning empty`,
                );
                _cache = [];
                return _cache;
            }
            const raw = await res.json();
            const pillars = parseManifest(raw);
            _cache = pillars;
            return pillars;
        } catch (err) {
            console.warn(
                '[PillarManifestClient] manifest fetch threw; returning empty:',
                err,
            );
            _cache = [];
            return _cache;
        } finally {
            _inflight = null;
        }
    })();

    return _inflight;
}

/**
 * Clear the session cache. Next `fetchManifest()` call re-issues the
 * network request. Used by the workshop's "refresh pillar library"
 * admin debug action and by vitest between specs.
 */
export function invalidate(): void {
    _cache = null;
    _inflight = null;
}

/**
 * Synchronous accessor — returns the cached array (or `null` if not yet
 * fetched). Useful for UI components that want to render immediately if
 * the cache is warm without awaiting.
 */
export function getCachedManifest(): Pillar[] | null {
    return _cache;
}

/**
 * Validate + convert the JSON payload into the strongly-typed `Pillar[]`
 * shape. Drops any entry whose shape is malformed (with a warn) rather
 * than throwing — one bad entry shouldn't take down the whole library.
 *
 * Top-level shape: `Pillar[]` (the endpoint returns an array, not an
 * object — keeps the JSON small and the parser simple).
 */
export function parseManifest(raw: unknown): Pillar[] {
    if (!Array.isArray(raw)) {
        throw new Error(
            `PillarManifestClient: expected top-level array, got ${typeof raw}`,
        );
    }
    const out: Pillar[] = [];
    for (let i = 0; i < raw.length; i++) {
        const entry = raw[i] as Partial<PillarManifestEntry>;
        if (!entry || typeof entry !== 'object') {
            console.warn(
                `[PillarManifestClient] entry ${i} not an object; skipping`,
            );
            continue;
        }
        if (typeof entry.pillarId !== 'number' || !Number.isFinite(entry.pillarId)) {
            console.warn(
                `[PillarManifestClient] entry ${i} missing/invalid pillarId; skipping`,
            );
            continue;
        }
        if (!entry.axes || !_isPillarAxes(entry.axes)) {
            console.warn(
                `[PillarManifestClient] entry ${i} (pillarId ${entry.pillarId}) missing/invalid axes; skipping`,
            );
            continue;
        }
        if (!Array.isArray(entry.embedding) || entry.embedding.length === 0) {
            console.warn(
                `[PillarManifestClient] entry ${i} (pillarId ${entry.pillarId}) missing/empty embedding; skipping`,
            );
            continue;
        }
        const emb = new Float32Array(entry.embedding.length);
        let ok = true;
        for (let j = 0; j < entry.embedding.length; j++) {
            const v = entry.embedding[j];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                ok = false;
                break;
            }
            emb[j] = v;
        }
        if (!ok) {
            console.warn(
                `[PillarManifestClient] entry ${i} (pillarId ${entry.pillarId}) non-finite embedding value; skipping`,
            );
            continue;
        }
        out.push({
            pillarId: entry.pillarId,
            axes: entry.axes,
            embedding: emb,
        });
    }
    return out;
}

function _isPillarAxes(x: unknown): x is PillarAxes {
    if (!x || typeof x !== 'object') return false;
    const o = x as Record<string, unknown>;
    return (
        typeof o.hair === 'string' &&
        typeof o.skinTone === 'string' &&
        typeof o.eyeColor === 'string' &&
        typeof o.ageBand === 'string' &&
        typeof o.clothingVibe === 'string' &&
        Array.isArray(o.extras)
    );
}

/** Test-only surface. */
export const __test = {
    setFetchOverride(fn: ((url: string) => Promise<Response>) | null): void {
        _fetchOverride = fn;
    },
    reset(): void {
        _cache = null;
        _inflight = null;
        _fetchOverride = null;
    },
    getCache(): Pillar[] | null {
        return _cache;
    },
};
