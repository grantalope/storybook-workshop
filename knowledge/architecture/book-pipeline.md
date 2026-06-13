---
type: Pipeline
title: WorkshopBookPipeline
description: Orchestrates Station-6 generation — story authoring, scene rendering, and PDF/ePub assembly — from a completed WorkshopDraft.
tags: [pipeline, generation, book, pdf, epub, assembly]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/workshop/services/WorkshopBookPipeline.ts
status: production
---

# Entry Point

```ts
export async function runWorkshopPipeline(
  draft: WorkshopDraft,
  opts: PipelineOpts = {},
): Promise<PipelineResult>
```

Requires stations 1-5 complete (`outputs.s1`–`s5` present); throws otherwise.

---

# Pipeline Stages

## 1. Build StoryInput

```ts
const input = await buildStoryInput(draft, draft.outputs)
```

- Loads `KidProfile` from `KidProfileStore` (kid's `ageBand` used for reading-level gates).
- Maps `Station4Output.sidekickSettlerId` → fictional display name via `FICTIONAL_SIDEKICK_NAMES` map (`ada→Ada`, `rumi→Rumi`, `jules→Jules`, `nico→Nico`).
- Sanitises `supportingCast` — strips all fields except `id`, `role`, `name` (privacy guard against extra data leaking into LLM prompt).
- Supporting cast `name` values where `fictionalName !== true` are excluded from the privacy `allowNames` list built later in `StoryAuthorService.castAllowNames()`.

## 2. Author Story

```ts
const tree = await storyAuthorService.author(input, { forceTemplate: opts.forceTemplate })
```

See [Story Author Service](/architecture/story-author.md) for full gate chain. Returns a `SceneTree` with beats, scenes, spread text, and `meta.grammarGate` telemetry.

If `grammarGate.salvaged === true` the pipeline emits a progress warning and logs to console — story is real LLM prose that cleared all gate bars except full grammar pass.

## 3. Resolve Image-Gen Provider

```ts
const provider = opts.provider ?? resolveImageGenProvider(opts.imageGenEnv)
```

`resolveImageGenProvider` reads `process.env.IMAGE_GEN_PROVIDER`:

| Value | Provider | Notes |
|---|---|---|
| `mock` (default) | `MockProvider` | 1×1 transparent PNG per scene; `skipValidation: true` in assembler |
| `local` | `LocalGpuProvider` | ComfyUI at `IMAGE_GEN_SERVER_URL` (default `http://100.101.215.25:8188` — 4090 box via Tailscale) |
| `cloud` | `CloudProvider` | fal.ai; requires `IMAGE_GEN_CLOUD_API_KEY` |

`process.env` is absent in the browser → `IMAGE_GEN_PROVIDER` reads as `undefined` → **mock path always runs in browser**. Real rendering requires a Node/server context with env set.

## 4. Render Scenes

**Mock path** (`provider.name === 'mock'`):
```ts
({ wbPngsByScene } = await mockRenderAllScenes(tree, stylePackId))
```
Returns a `Map<sceneId, Blob[]>` of deterministic 1×1 PNGs. Byte-identical across runs; enables headless pipeline smoke without an image-gen server.

**Real path**:
```ts
const renderer = new RealSceneRenderer({ provider, ...opts.renderOpts, onProgress })
const rendered = await renderer.renderAllScenes(tree, {
  stylePackId,
  locale: input.localeBiome,
  characters: charactersFromStation4(outputs.s4, input.ageBand, opts.heroDna),
  compositionPlansBySpread: opts.compositionPlansBySpread,
})
```
- Default concurrency: 2 spreads in parallel.
- `opts.heroDna` — optional hero appearance DNA string (e.g. from `heroDnaFromPillarAxes(matchedPillar.axes)`).
- `opts.compositionPlansBySpread` — optional T1 layout plans (`CompositionPlan`) for direct-gen prompt serialisation via `ScenePromptComposer`.
- Full Lulu print-res upscale runs inside `RealSceneRenderer`.

## 5. Pick Format + Page Count

```ts
function pickFormat(targetSpreads: number): BookFormat
// ≤8sp → 'saddlestitch-8x8'  |  ≥16sp → 'hardcover-8x8'  |  else 'softcover-8x8'

function clampPagesToFormat(spreadCount: number, format: BookFormat): number
// pages = max(spreadCount*2, dims.minPages), rounded up to dims.pageCountMultiple
```

Mock path uses legacy math (`max(spreadCount*2, 4)`) and skips validation. Real path must declare a Lulu-valid count because `LuluPdfSpecValidator` gate is live.

## 6. Assemble Book

```ts
const book = await assemble(bundle, assembleOpts)
```

`BookAssetBundle` fields:

| Field | Source |
|---|---|
| `wbPngsByScene` | renderer output |
| `kidName` | `outputs.s4.heroName` |
| `dedication` | `outputs.s3.dedicationText` |
| `sidekickSettlerInfo` | `{ settlerId, displayName }` |
| `title` | `tree.title` |
| `backCoverBlurb` | `tree.back_cover_blurb` |
| `format` | `pickFormat(targetSpreads)` |
| `pages` | `clampPagesToFormat(...)` (real) or legacy (mock) |
| `authorByline` | `outputs.s5.authorByline` |
| `stylePackId` | `outputs.s5.artStyle` |
| `sceneOrder` | `sceneOrderOf(tree)` — real path only; pins spread order in assembler |

`assemble()` (BookAssembler) returns `AssembledBook` containing `pdfBlob`, `epubBlob`, and `audit.pageCount`.

## 7. Hash + Return

```ts
const pdfHash = await blobHash(book.pdfBlob)  // SHA-256 via crypto.subtle.digest
return { tree, book, pdfHash, pageCount: book.audit.pageCount, grammarGate }
```

Hash used for `ConsentRecord.pdfHash` in `Station6Output` (tamper-evidence).

---

# PipelineOpts

| Option | Purpose |
|---|---|
| `onProgress` | `(p: PipelineProgress) => void` — stages: `author` `render` `assemble` `done` |
| `forceTemplate` | Skip LLM; use deterministic template fallback |
| `provider` | Injectable `ImageGenProvider` (tests) |
| `imageGenEnv` | Env override for provider resolution (tests) |
| `renderOpts` | Tuning overrides for `RealSceneRenderer` (e.g. `{ concurrency: 1, retryDelayMs: 0 }`) |
| `compositionPlansBySpread` | T1 layout/composition plans |
| `heroDna` | Hero appearance DNA string |

---

# Related Concepts

- [Story Author Service](/architecture/story-author.md) — stage 2 internals
- [Image Generation](/architecture/imagegen.md) — provider selection, ComfyUI workflows, fal.ai
- [Inference / LLR](/architecture/inference-llr.md) — how author's LLM calls route
- [Pure-JS Hashing and UUID](/decisions/pure-js-hashing-and-uuid.md) — why `crypto.subtle` not a Node dep
