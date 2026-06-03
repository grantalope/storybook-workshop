// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/storybook-workshop/index.ts
//
// Public barrel for the storybook-workshop pillar-vectorizer subsystem
// (Wave 1 / Goal #1). Future workshop goals (story-author, kids-content-
// safety, pretext-book-adapter, book-assembler, ui-shell, ...) will add
// their own barrels under this directory; the workshop UI imports each
// subsystem barrel independently — no cross-workshop service deps.

export type {
    AgeBand,
    ClothingVibe,
    EyeColor,
    HairKind,
    Pillar,
    PillarAxes,
    PillarManifestEntry,
    PillarMatch,
    PillarMatchOpts,
    PillarVectorizerOpts,
    SkinTone,
} from './types';

export {
    PillarVectorizerService,
    pillarVectorizerService,
    PILLAR_EMBEDDING_DIM,
} from './PillarVectorizerService';

export {
    fetchManifest,
    getCachedManifest,
    getCachedManifestSource,
    invalidate as invalidateManifest,
    parseManifest,
    type PillarManifestSource,
} from './PillarManifestClient';

export {
    AGE_BAND_BOOST,
    PillarMatcherService,
    cosineSimilarity,
    pillarMatcherService,
} from './PillarMatcherService';
