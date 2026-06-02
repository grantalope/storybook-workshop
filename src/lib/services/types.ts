// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/storybook-workshop/types.ts
//
// Canonical type surface for the Storybook Workshop pillar-vectorizer
// subsystem (Wave 1 / Goal #1).
//
// Source of truth for `Pillar`, `PillarAxes`, `PillarMatch` shapes consumed by
// `PillarVectorizerService`, `PillarManifestClient`, `PillarMatcherService`,
// and the `/api/vectorize` fallback endpoint.
//
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §3.2-§3.4
// ADR:  docs/adr/0043-storybook-workshop-privacy-on-device-pillar.md

/**
 * Hair archetype family. 8 buckets at v1; tunable as the upstream pillar
 * library evolves. Strings (not enums) so the manifest payload stays
 * JSON-serializable across the on-device <-> WB CDN boundary.
 */
export type HairKind =
    | 'straight-short'
    | 'straight-long'
    | 'wavy-short'
    | 'wavy-long'
    | 'curly-short'
    | 'curly-long'
    | 'coily'
    | 'buzz';

/** 6 skin-tone buckets (Fitzpatrick-style). */
export type SkinTone = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI';

/** 4 eye-color buckets. */
export type EyeColor = 'brown' | 'blue' | 'green' | 'hazel';

/** 3 age-bands aligned to §3.6 vocabulary calibration. */
export type AgeBand = 'toddler' | 'preschool' | 'grade-school';

/** 5 clothing-vibe buckets (style axis, not a wardrobe). */
export type ClothingVibe =
    | 'casual'
    | 'sporty'
    | 'formal'
    | 'whimsical'
    | 'cozy';

/**
 * The 6 axes that compose a pillar archetype (§3.2). `extras` is the open
 * set (glasses / freckles / hat / etc.) — not enumerated so the upstream
 * pillar library can grow them without breaking the type.
 */
export interface PillarAxes {
    hair: HairKind;
    skinTone: SkinTone;
    eyeColor: EyeColor;
    ageBand: AgeBand;
    clothingVibe: ClothingVibe;
    extras: string[];
}

/**
 * One pillar = one pre-rendered archetype + its 512-dim CLIP embedding.
 * `pillarId` is an opaque integer; it is the only piece of pillar identity
 * that ever leaves the device on the happy path.
 *
 * `embedding` is a Float32Array (not number[]) for cosine-sim perf — the
 * manifest client converts inbound JSON `number[]` arrays into Float32Array
 * at parse time.
 */
export interface Pillar {
    pillarId: number;
    axes: PillarAxes;
    embedding: Float32Array;
}

/**
 * Match result returned by `PillarMatcherService.match` (+ `refineNear`,
 * `refineExcluding`).
 *
 * `similarity` is the post-rerank cosine score (raw cosine + optional
 * age-band boost). Range nominally [-1, +1]; with the +0.1 boost
 * floor/ceiling not strictly enforced (math is preserved; downstream
 * UI/scoring consumers care only about ordering, not absolute scale).
 */
export interface PillarMatch {
    pillarId: number;
    similarity: number;
    axes: PillarAxes;
}

/**
 * Caller-side opts threaded through the workshop wizard's S2 station.
 *
 * - `ageBandHint` lets the matcher reweight pillars matching the kid's age
 *   band (§3.4 "age-band re-rank"). The hint is sourced from the kid
 *   profile (S1 → preflow) — not from the photo itself.
 * - `fallback` chooses the UX when on-device WASM init fails:
 *     - `'consent-required'`: surface the explicit-consent modal +
 *       one-shot POST to `/api/vectorize` per ADR-0043.
 *     - `'manual-grid'`: skip photo entirely; parent picks from a curated
 *       archetype grid filtered by age (§2 Station 2).
 *
 * Both fallback modes are valid; the workshop UI exposes both — the type
 * just records which path the caller has authorized.
 */
export interface PillarVectorizerOpts {
    ageBandHint?: AgeBand;
    fallback: 'consent-required' | 'manual-grid';
}

/**
 * The on-the-wire shape of a `Pillar` as served by the World Builder
 * manifest endpoint. Embeddings arrive as plain `number[]` (JSON has no
 * Float32 type); the client casts at parse time.
 */
export interface PillarManifestEntry {
    pillarId: number;
    axes: PillarAxes;
    embedding: number[];
}

/**
 * Top-K matcher input.
 */
export interface PillarMatchOpts {
    ageBandHint?: AgeBand;
    topK: number;
}
