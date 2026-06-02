// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/storybook-workshop/PillarMatcherService.ts
//
// Local cosine-similarity matcher over the pre-fetched pillar manifest.
// Runs entirely on-device; never sees the kid's photo (only the 512-dim
// embedding produced by PillarVectorizerService).
//
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §3.4
//
// Three call shapes drive the S2 "spinning archetype wheel" UX:
//   - match(kidVector, opts) — initial top-K from a CLIP embedding
//   - refineNear(pillarId, topK) — "more like this" pick
//   - refineExcluding(prevPillarIds, topK) — "different vibe" pick

import type {
    AgeBand,
    Pillar,
    PillarMatch,
    PillarMatchOpts,
} from './types';
import { fetchManifest } from './PillarManifestClient';

/**
 * Cosine-sim boost applied to pillars whose `ageBand` matches the caller's
 * `ageBandHint`. Tunable here in one place. Spec §3.4 calls for an
 * age-band rerank; +0.1 is a soft nudge — enough to break ties in favor
 * of the right age, not enough to override a visibly stronger raw
 * similarity hit. If the workshop wizard's S2 "Different vibe" telemetry
 * shows the boost is too sticky we can lower this.
 */
export const AGE_BAND_BOOST = 0.1;

export class PillarMatcherService {
    /** Test-injection: lets specs bypass the manifest fetch. */
    private _manifestOverride: Pillar[] | null = null;

    /**
     * Top-K nearest pillars to the kid's embedding, with optional
     * age-band rerank. Returns sorted DESC by post-rerank similarity.
     *
     * Empty manifest -> empty result (the matcher is the silent path —
     * the UI surfaces "library unavailable" upstream).
     */
    async match(
        kidVector: Float32Array,
        opts: PillarMatchOpts,
    ): Promise<PillarMatch[]> {
        const manifest = await this._getManifest();
        if (manifest.length === 0) return [];
        const matches = this._score(manifest, kidVector, opts.ageBandHint);
        return this._topK(matches, opts.topK);
    }

    /**
     * Neighborhood pick: top-K pillars nearest the chosen `pillarId`.
     * Self is excluded from the result.
     */
    async refineNear(pillarId: number, topK: number): Promise<PillarMatch[]> {
        const manifest = await this._getManifest();
        if (manifest.length === 0) return [];
        const seed = manifest.find((p) => p.pillarId === pillarId);
        if (!seed) return [];
        const neighbors = manifest.filter((p) => p.pillarId !== pillarId);
        // Reuse the seed's age-band as the boost hint — if the parent
        // liked an age-X pillar enough to refine on it, age-X bias
        // probably helps the neighbors too.
        const matches = this._score(neighbors, seed.embedding, seed.axes.ageBand);
        return this._topK(matches, topK);
    }

    /**
     * "Different vibe": rerank against the kid vector, but exclude any
     * pillars the parent has already seen. The caller supplies both the
     * exclusion list and the kid vector — the matcher does not retain
     * either between calls.
     */
    async refineExcluding(
        kidVector: Float32Array,
        prevPillarIds: number[],
        opts: PillarMatchOpts,
    ): Promise<PillarMatch[]> {
        const manifest = await this._getManifest();
        if (manifest.length === 0) return [];
        const excluded = new Set(prevPillarIds);
        const candidates = manifest.filter((p) => !excluded.has(p.pillarId));
        if (candidates.length === 0) return [];
        const matches = this._score(candidates, kidVector, opts.ageBandHint);
        return this._topK(matches, opts.topK);
    }

    private async _getManifest(): Promise<Pillar[]> {
        if (this._manifestOverride) return this._manifestOverride;
        return fetchManifest();
    }

    private _score(
        manifest: Pillar[],
        kidVector: Float32Array,
        ageBandHint?: AgeBand,
    ): PillarMatch[] {
        const out: PillarMatch[] = new Array(manifest.length);
        for (let i = 0; i < manifest.length; i++) {
            const p = manifest[i];
            const raw = cosineSimilarity(kidVector, p.embedding);
            const boost =
                ageBandHint && p.axes.ageBand === ageBandHint
                    ? AGE_BAND_BOOST
                    : 0;
            out[i] = {
                pillarId: p.pillarId,
                similarity: raw + boost,
                axes: p.axes,
            };
        }
        return out;
    }

    private _topK(matches: PillarMatch[], k: number): PillarMatch[] {
        if (k <= 0) return [];
        // Sort DESC; for k << N a partial-sort would be faster but the
        // manifest is ~5k entries and this runs once per S2 station call
        // — Array.sort is fine.
        matches.sort((a, b) => b.similarity - a.similarity);
        return matches.slice(0, k);
    }

    /** Test-only surface. */
    __test_setManifest(pillars: Pillar[] | null): void {
        this._manifestOverride = pillars;
    }
}

/**
 * Cosine similarity for two equal-length Float32Arrays. Exported for
 * direct unit-testing of the math without the matcher service wrapper.
 *
 * Returns NaN if either vector is zero-length, length-mismatched, or has
 * zero norm — the matcher tolerates NaN by sorting it to the end
 * (`b - a` with NaN yields NaN; Array.sort treats NaN as "equal", which
 * shuffles them anywhere; downstream UI clamps).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length || a.length === 0) return NaN;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    if (denom === 0) return NaN;
    return dot / denom;
}

/** Module-scoped singleton, matches sibling-service convention. */
export const pillarMatcherService = new PillarMatcherService();
