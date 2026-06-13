---
type: Service
title: Style Packs
description: 15 curated art-history and legacy style packs that inject prompt recipes into image generation requests, surfaced at /styles and Station 5.
tags: [imagegen, styles, comfyui, prompt-engineering, art-history]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/services/stylepacks/
status: active
---

# Style Packs

Central registry of art styles injected into image generation. Each pack carries a prompt recipe, educational card, and provenance metadata.

## Source Layout

- `src/lib/services/stylepacks/packs.ts` — `STYLE_PACKS` array (15 entries)
- `src/lib/services/stylepacks/bannedNames.ts` — `assertNoBannedReferences()` guard
- `src/lib/services/stylepacks/index.ts` — `applyStylePackToRequest(pack, req)` merger

## Pack Roster

### Legacy / Modern (3)

| id | displayName |
|---|---|
| `octopath-hd2d` | Octopath HD-2D |
| `flat-painted` | Flat Painted |
| `pixel-pure` | Pixel Pure |

No `educationalCard` or `palette` on legacy packs.

### Art-History (12)

| id | displayName | Cultural origin |
|---|---|---|
| `ukiyo-e-woodblock` | Ukiyo-e Woodblock | Japanese Edo |
| `impressionist-garden` | Impressionist Garden | French 19th c |
| `post-impressionist-swirl` | Swirling Starlight | Van Gogh post-imp |
| `cutout-collage` | Cutout Collage | Matisse late |
| `watercolor-botanical` | Watercolor Botanical | European natural-hist |
| `stained-glass` | Stained Glass | Gothic cathedral |
| `illuminated-manuscript` | Illuminated Manuscript | Medieval European |
| `persian-miniature` | Persian Miniature | Safavid Iranian |
| `mexican-amate-folk` | Mexican Amate Folk | Nahua/Otomi |
| `scandinavian-rosemaling` | Scandinavian Rosemaling | Norwegian folk |
| `art-nouveau-poster` | Art Nouveau Poster | Belle Époque |
| `bauhaus-geometric` | Bauhaus Geometric | Weimar German |

> Note: `post-impressionist-swirl` displayName is "Swirling Starlight", NOT "Van Gogh" — `bannedNames.ts` blocks living-artist and named-artist references in prompts.

## StylePack Type

```ts
type StylePack = {
  id: string
  displayName: string
  era: { start: number; end: number }
  cultureTag: string
  respectNote: string
  inspirations: Array<{ name: string; died: number }> // deceased artists only
  promptRecipe: {
    positivePrefix: string
    positiveSuffix: string
    negativeAdditions: string[]
    palette: string[] // hex codes
  }
  educationalCard?: {
    kidExplainer: string
    funFact: string
    lookFor: string
    tryItYourself: string
    famousWorkDescription: string
  }
}
```

## Key Functions

### `applyStylePackToRequest(pack, req)`

Merges `pack.promptRecipe` into image generation request:
- Prepends `positivePrefix` + appends `positiveSuffix` to positive prompt
- Extends negative prompt with `negativeAdditions`
- Passes `palette` to provider if supported (ComfyUI color-conditioning)

### `assertNoBannedReferences(prompt)`

Throws if prompt contains living-artist names or copyrighted character names. Called before every provider dispatch. Defined in `bannedNames.ts`.

## Surfaces

- **`/styles` route** — gallery of all 15 packs with `educationalCard` expanded
- **Station 5** of the book creation flow — user picks style; see [create flow](/architecture/create-flow.md)

## Scaling Plan

`docs/art-style-expansion.md` — ComfyUI-packs scaling plan: per-pack LoRA/workflow templates, batch bake via the 4090, additional cultural packs roadmap.

## Relations

- Style pack prompt recipe feeds into → [imagegen provider](/architecture/imagegen.md)
- Station 5 picker lives in → [create flow](/architecture/create-flow.md)
- Educational card displayed alongside hero archetype → [pillar library](/architecture/pillar-library.md)
