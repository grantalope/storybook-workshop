# Art-Style Expansion — how we go from 16 styles to "way more"

> Status: launch set = **15 style packs** — 12 art-history traditions + 3 modern/game looks (live, in `src/lib/services/stylepacks/packs.ts`, surfaced at `/styles` and selectable at Station 5). This doc is the plan for scaling that catalogue without re-architecting anything.

## Why a child's picture book deserves real art styles

Picture books are most children's **first art museum**. The illustration style is not decoration — it is the visual vocabulary a child absorbs before they can read. So every style we ship is:

1. **A real tradition**, not a "filter" — Ukiyo-e woodblock, Impressionism, Post-Impressionist (Van Gogh) swirl, Matisse-era paper cutout, Persian miniature, illuminated manuscript, stained glass, Bauhaus, Art Nouveau, Mexican amate folk, Scandinavian rosemaling, botanical watercolour, plus three modern game/illustration looks (HD-2D, flat-painted, pixel).
2. **Taught, not just applied** — each pack carries an `educationalCard` (`kidExplainer`, `funFact`, `lookFor`, `tryItYourself`, `famousWorkDescription`). The same data renders the `/styles` gallery and can power an in-book "about this art style" page.
3. **Culturally respectful** — each pack has a `respectNote` framing the tradition honestly (e.g. "use this to notice carved-line technique, not to flatten Japanese art into one look"), and a `bannedNames` guard (`src/lib/services/stylepacks/bannedNames.ts`) prevents prompting against living artists' names.

## The architecture that makes expansion cheap

A **style is a recipe**, not code. Each `StylePack` is a pure data object:

```
{ id, displayName, era, cultureTag, respectNote, inspirations[],
  promptRecipe: { positivePrefix, positiveSuffix, negativeAdditions, palette[] },
  educationalCard: { kidExplainer, funFact, lookFor, tryItYourself, famousWorkDescription } }
```

`applyStylePackToRequest()` merges the recipe into the image-gen request at render time. Adding a style therefore means **adding one frozen object** to `STYLE_PACKS` — no renderer, pipeline, or UI change. The `/styles` page and Station 5 picker both iterate `STYLE_PACKS`, so a new pack appears everywhere automatically.

## The render path (why we can add styles freely)

Image generation runs **open models on our own GPU** (ComfyUI on the 4090 box, reachable over Tailscale), resolved by `src/lib/services/imagegen/` (`IMAGE_GEN_PROVIDER=local` → `LocalGpuProvider` → ComfyUI; `mock` is the default for CI/headless; `cloud` is fal.ai-swappable). Because the provider is swappable and the workflow graphs live in `src/lib/services/imagegen/workflows.ts`, a new style pack needs only:

1. A **palette** (5–6 hex anchors) — drives both the `/styles` swatch strip and a soft palette bias in the prompt.
2. A **technique prompt** (`positivePrefix` / `positiveSuffix` / `negativeAdditions`) describing the *technique* (carved ink contours, broken-colour dabs, cut-paper edges…), never a living artist.
3. A **kid art-lesson** (`educationalCard`).
4. Optional: a tuned ComfyUI workflow or LoRA when a tradition needs more than prompt-level control (e.g. true woodblock registration, gold-leaf illumination).

## Roadmap (batched style packs)

- **Batch 1 (shipped):** the 15 launch packs (12 art-history + 3 modern/game).
- **Batch 2 — world traditions:** Chinese ink-wash (shan shui), Indian Madhubani, West-African Adinkra/textile, Aboriginal-inspired dot patterning (with explicit cultural-consultation note before ship), Byzantine mosaic.
- **Batch 3 — eras & movements:** Art Deco, mid-century modern (Provensen/Scarry-era technique), Bauhaus II (photogram/collage), Suprematist shapes, Pointillism (Seurat technique).
- **Batch 4 — seasonal / themed:** bedtime-soft (low-contrast, warm), winter-paper-cut, spring-botanical, "crayon & construction-paper" (kid's-own-hand look).
- **Batch 5 — LoRA-backed precision packs:** styles where prompt-only control is insufficient; train small LoRAs on **public-domain** corpora only.

## Guardrails on expansion

- **No living-artist prompting** — `assertNoBannedReferences()` runs in the pack-validation test.
- **Public-domain / technique-only** training and prompting.
- **A `respectNote` is mandatory** for any culturally-rooted tradition, written with (not about) the culture where consultation is warranted.
- **Every pack ships its `educationalCard`** — if we can't explain it to a six-year-old, it's not ready.

## Where it lives

| Thing | Path |
|---|---|
| Pack data (single source of truth) | `src/lib/services/stylepacks/packs.ts` |
| Pack type + educational-card shape | `src/lib/services/stylepacks/types.ts` |
| Living-artist guard | `src/lib/services/stylepacks/bannedNames.ts` |
| Apply-to-request | `src/lib/services/stylepacks/applyStylePack.ts` |
| Public gallery | `src/routes/styles/+page.svelte` (`/styles`) |
| In-workshop picker | `src/lib/workshop/stations/Station5DressStory.svelte` |
| Render provider | `src/lib/services/imagegen/` (ComfyUI `local` / fal `cloud` / `mock`) |
