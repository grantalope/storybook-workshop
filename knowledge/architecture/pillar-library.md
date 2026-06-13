---
type: Service
title: Pillar Library
description: 150 kid hero archetypes with CLIP embeddings; matched to a child's photo on-device for privacy-safe hero personalization.
tags: [pillars, archetypes, clip, privacy, hero, a11y]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/services/PillarManifestClient.ts
status: active
---

# Pillar Library

150 kid archetypes used to generate a personalized hero. Photo never leaves device — only CLIP embedding used for matching.

## Source Files

- `src/lib/services/PillarManifestClient.ts` — `fetchManifest()` with 3-tier waterfall
- `src/lib/services/PillarMatcherService.ts` — cosine-nearest archetype lookup
- Station 2 component: `src/lib/components/Station2ForgeHero.svelte` — archetype picker UI

## Manifest Waterfall

```
fetchManifest()
  1. GET /api/world/pillar-library/manifest
       → 404 in standalone demo (handled gracefully)
  2. GET /pillar-library-v2/manifest.json
       → static bake, 150 entries  ← primary path
  3. /pillar-library-v1-placeholder
       → minimal fallback
```

## Entry Schema

```ts
type PillarEntry = {
  pillarId: string
  archetypeId: string
  displayName: string
  axes: {
    hair: string
    skinTone: 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI'  // Fitzpatrick scale
    eyeColor: string
    ageBand: string
    clothingVibe: string
    extras: string[]
  }
  embedding: number[]    // 512-dim CLIP
  previewUrl: string     // /pillar-library-v2/portraits-thumb/pNNN.jpg
  fullUrl: string
}
```

## Matching Flow

```
Kid photo (device only)
  -> CLIP encode on-device (never uploaded)
  -> PillarMatcherService.match(embedding)
     cosine similarity vs all 150 entries
  -> nearest archetypeId returned
  -> hero generation uses axes + style pack
```

Raw photo never transmitted. See [privacy](/architecture/privacy.md).

## A11y — Station2ForgeHero

```svelte
<button aria-label={pillarLabel}>
  <img src={entry.previewUrl} alt="">  <!-- decorative; button carries label -->
</button>
```

Pattern: button labeled, image decorative (`alt=""`). Correct — avoids duplicate announcement.

## Portrait Assets

Static at `/pillar-library-v2/portraits-thumb/pNNN.jpg` (N = 001..150). Full resolution at `fullUrl`. Thumbnails served from same static host as the app; no CDN dependency.

## Relations

- Matching uses on-device CLIP embedding — privacy contract → [privacy](/architecture/privacy.md)
- Hero axes feed style pack prompt merge → [style packs](/architecture/style-packs.md)
- Station 2 in creation sequence → [create flow](/architecture/create-flow.md)
