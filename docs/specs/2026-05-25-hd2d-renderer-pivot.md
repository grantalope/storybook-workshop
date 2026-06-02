# Storybook Workshop — HD-2D Renderer Pivot (Spec Patch)

**Date:** 2026-05-25
**Status:** APPROVED (user explicit: "wire storybook workshop to consume this pipeline instead of the WB API I specced")
**Patches:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](2026-05-24-storybook-workshop-design.md) §3.1, §3.2, §3.6, §3.7, §3.8 — original spec called for `POST /api/world/scene` against World Builder for painted_2d PNGs. Pivoting to consume the in-repo THREE r171 HD-2D engine (`Real3dHd2dScene` + 7 modules under `components/hd2d/three/`) that shipped on `feat/real-place-pipeline-e2e` branch 2026-05-23/25.

---

## Why pivot

The original spec called the upstream WB at `localhost:3000` to render painted_2d spreads. That assumption is now wrong:

1. **A separate worker shipped a full HD-2D engine in 3 days.** `Real3dHd2dScene.svelte` (930 LOC) + 7 modular pieces (`MapCompiler`, `Tilemap3D`, `RegionExtruder`, `LitBillboardSystem`, `PropsBuilder`, `OctopathGradePipeline`, `CameraRig`, `SettlerAnimator`) consume a `RealPlaceBundle` → render Octopath-grade output on `/dashboard/real-place/[slug]?renderer=real-3d`.
2. **Quality is multiple tiers higher** than what we'd get from painted_2d PNGs: real 3D BoxGeometry buildings (12 baked GLBs via Pixal3D + TRELLIS.2 on RTX 4090 — 534.5 MB at `static/hd2d-report/glbs/`), camera-facing lit billboard sprites with NE-cast shadows, full UnrealBloom + tilt-shift + 16×16×16 sunset LUT + FXAA postFX chain, ortho 28° tilt camera at 22wu distance, instanced floor (484→6-10 draw calls).
3. **No upstream coordination needed.** The engine lives in pachinko-app already. Goal #12 `worldbuilder-upstream-changes` becomes deprecated; storybook workshop owns the renderer adapter directly.
4. **Photo + assembly story strengthens.** Per-spread render = a real WebGL2 canvas frame → `canvas.toBlob('image/png')` at print-resolution → composited locally per spec §3.9 (the `BookAssembler` name-overlay-keystone path is unchanged). No external API hop for the rendered scene at all. **Privacy story tightens** — pillar IDs + scene briefs never leave the device.

---

## Architecture change summary

| Spec section | Before pivot | After pivot |
|---|---|---|
| §3.1 outbound payload | `POST /api/world/scene` with pillarId + sceneBrief + biome + style → upstream WB returns PNG | **No outbound call.** Compose `RealPlaceBundle` locally + render via `Real3dHd2dScene` headless → grab `canvas.toBlob('image/png')` |
| §3.2 pillar library | 5,000 archetypes × 12 art styles × SDXL/Midjourney → 60k WebP on CDN | **5,000 archetypes baked as multi-view billboard sprites** via Pixal3D + TRELLIS.2 on RTX 4090. Each pillar = 4 sprite sheets (front/back/left/right) at 8×4 frame grid per `SettlerAnimator` contract. Stored as `pillar-billboards-v1/{pillarId}/{front,back,left,right}.png`. Total ~ 12 GB CDN. CLIP embedding for cosine match unchanged. Art-style enum compressed from 12 → 3 supported by engine: `octopath-hd2d` (default, lit), `flat-painted` (postFX off — kid-book softer feel), `pixel-pure` (no postFX, hard-edge sprites). |
| §3.6 scene rendering | Per beat → WB API call → PNG returned | Per beat → build a `RealPlaceBundle` locally combining `localeBiome` (one of 4 pre-baked: coastal-village / forest-shrine / desert-oasis / mountain-monastery — extensible via `pillar-library-assets` goal) + kid pillar billboard + sidekick settler billboard + supporting cast → invoke `Real3dHd2dScene` headless via OffscreenCanvas → `OctopathGradePipeline` runs → `canvas.toBlob('image/png')` returns 16×8 inches @ 300dpi PNG |
| §3.7 (revised) per-scene multi-spread | WB upstream feature `spreadCount > 1` per scene | Local `CameraRig` state machine: each spread within a scene = a different camera yaw/zoom keyframe per the `cameraSequence` enum ('establishing' / 'pan' / 'follow' / 'tight-on-hero' / 'reveal' / 'wide-shot'). One scene-mount, N captures at different `cameraRig` states. ~10× faster than rebuilding WB scene per spread |
| §3.8 PreText typography | Composited atop WB-rendered PNG via `BookSpreadSurfaceAdapter` | UNCHANGED — overlays atop the HD-2D-rendered PNG. The PreText pipeline doesn't care what generated the bottom layer |
| §3.9 BookAssembler | Consumed WB PNGs + composited name locally | UNCHANGED — only the source of the PNGs changes (local HD-2D canvas instead of WB API), the name-overlay-keystone path is preserved |

---

## New entry point — `StorybookSceneRenderer` service

```ts
// src/routes/dashboard/services/storybook-workshop/render/StorybookSceneRenderer.ts

export interface SpreadRenderRequest {
  pillarId: number;
  pillarBillboardUrl: string;        // resolved from PillarManifestClient
  sidekickSettlerId: string;
  supportingCast: Array<{ kind: 'settler' | 'pillar'; id: string }>;
  localeBiome: 'coastal-village' | 'forest-shrine' | 'desert-oasis' | 'mountain-monastery' | string;
  artStyle: 'octopath-hd2d' | 'flat-painted' | 'pixel-pure';
  sceneBrief: string;                // PrivacyFilter+KidsSafety pre-scrubbed prose
  beatNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  sceneIndexInBeat: number;
  spreadCount: 1 | 2 | 3 | 4 | 5;
  cameraSequence: 'establishing' | 'pan' | 'follow' | 'tight-on-hero' | 'reveal' | 'wide-shot';
  lighting: 'warm-front' | 'cool-side' | 'dramatic-back' | 'golden-hour' | 'moonlight' | 'firelit';
  width: number;                     // 4800 for 16-inch @ 300dpi
  height: number;                    // 2400 for 8-inch @ 300dpi (gutter-aware)
}

export interface SpreadRenderResult {
  spreads: Blob[];                   // length = spreadCount, each PNG
  focalPoints: Array<{ x: number; y: number; radius: number }>; // for PretextFlowEngine text-wrap
  audit: { pillarId, biome, lighting, gpuBackend: 'webgl2' | 'webgpu', frameTimeMs: number };
}

export class StorybookSceneRenderer {
  async render(req: SpreadRenderRequest): Promise<SpreadRenderResult> {
    // 1. Compose RealPlaceBundle from biome template + kid/sidekick/cast positions
    const bundle = buildBundle(req);

    // 2. Mount Real3dHd2dScene on an OffscreenCanvas at req.width × req.height
    const canvas = new OffscreenCanvas(req.width, req.height);
    const scene = await mountHeadlessScene(canvas, bundle, req);

    // 3. For each spread: set CameraRig state per cameraSequence + sceneIndex →
    //    render frame → OctopathGradePipeline → canvas.toBlob('image/png') →
    //    push to spreads[]
    const spreads: Blob[] = [];
    for (let i = 0; i < req.spreadCount; i++) {
      scene.cameraRig.setState(cameraSequenceForIndex(req.cameraSequence, i));
      scene.renderFrame();                          // includes OctopathGradePipeline pass
      spreads.push(await canvas.convertToBlob({ type: 'image/png' }));
    }

    return { spreads, focalPoints: scene.lastFocalPoints(), audit: scene.lastAudit() };
  }
}
```

The HD-2D engine modules are reused unchanged. Only the **bundle-composition** + **headless-mount** layers are new.

---

## Goal updates

### Goal #12 `worldbuilder-upstream-changes` — DEPRECATED

The original goal was to extend WB's `/api/world/scene` with `spreadCount > 1` + pillar overlay support. **Skip entirely.** The pivot makes WB irrelevant for storybook rendering. Workers can still ship the WB-side changes for other consumers (the existing fishbowl integration may want them), but storybook workshop no longer depends on them.

### Goal #12 (new) `storybook-workshop-hd2d-renderer-adapter` — REPLACES old #12

See [docs/superpowers/goals/2026-05-25-storybook-workshop-hd2d-renderer-adapter.md](../goals/2026-05-25-storybook-workshop-hd2d-renderer-adapter.md). Implements `StorybookSceneRenderer` + headless mount + bundle composition + camera-sequence-per-spread iteration + 4 biome bundle templates. Consumes the existing engine modules unchanged.

### Goal #10 `pillar-library-assets` — REVISED for Pixal3D pipeline

See [docs/superpowers/goals/2026-05-25-storybook-workshop-pillar-library-pixal3d.md](../goals/2026-05-25-storybook-workshop-pillar-library-pixal3d.md). Instead of SDXL flat 2D archetypes × 12 art styles, generate the 5,000 kid archetypes once via SDXL flat → bake each through Pixal3D + TRELLIS.2 (on the RTX 4090 box) → output multi-view billboard sprite sheets (front/back/left/right at 8×4 frame grid) compatible with `SettlerAnimator`. Total ~12 GB CDN. CLIP embedding step unchanged.

### Goal #4 `pretext-book-adapter` — UNCHANGED

PreText overlays apply on top of the rendered PNG regardless of source. No edits.

### Goal #5 `book-assembler` — UNCHANGED

Consumes PNG blobs from `StorybookSceneRenderer` instead of WB API. Same name-overlay-keystone path. No edits.

### Goal #6 `ui-shell` — MINOR EDIT

Station 5 art-style grid: 12 styles → 3 styles (`octopath-hd2d` default, `flat-painted`, `pixel-pure`). Other 9 style options removed (they were upstream-WB capabilities we won't be supporting). Pillar preview thumbnails come from `pillar-library-assets/{pillarId}/preview.png` (the front facing sprite).

### Other goals — UNCHANGED

#1 pillar-vectorizer (WASM CLIP), #2 kids-content-safety, #3 story-author, #7 advanced-mode, #8 fulfillment, #9 subscription-engine, #11 marketing-funnel — no changes from the original 2026-05-24 spec.

---

## Tradeoffs

| Aspect | WB-API path (specced) | HD-2D-pipeline path (pivot) |
|---|---|---|
| Visual quality | painted_2d (good 2D) | Octopath-HD-2D (real 3D + lighting + shadows + bloom + tilt-shift) — **multiple tiers higher** |
| Privacy | scene-brief + pillarId crosses network | **zero outbound** (everything renders locally; pillar billboards fetched from CDN by ID, no per-user data ever leaves device) |
| Latency per spread | ~2-5s WB API roundtrip + render | ~300-800ms local headless render |
| Per-spread cost | upstream GPU on WB host | local device GPU (WebGL2 / WebGPU when available) |
| Art-style flexibility | 12 styles supported | 3 styles (octopath-hd2d / flat-painted / pixel-pure) — narrower but each tuned |
| Asset library | 60k WebP @ 30GB CDN | ~12GB CDN (sprite sheets) + 534MB of building GLBs |
| Browser support | any browser (just receives PNG) | requires WebGL2 minimum (WebGPU optional). Per project May 2026 caniuse — universal modern browser support |
| Development cost | Goal #12 = full WB-side API extension | Goal #12 = thin adapter on existing engine (~2-3 days) |
| Marketing line | *"AI-rendered painted_2d picture book"* | *"Every spread is a real 3D Octopath-grade scene rendered on your device. Your kid stars as a lit billboard in a working game engine."* |

---

## Migration order

1. **PR #1 (this spec patch):** spec doc + 2 new goal files + this patch document. **No code.**
2. **Goal #1 stack proceeds unchanged** (pillar-vectorizer, kids-content-safety, story-author, pretext-book-adapter, book-assembler all already merged or in-flight).
3. **Goal #12-new (hd2d-renderer-adapter):** workers can spawn against `feat/storybook-workshop-worldbuilder-upstream-changes` branch (already pushed at main HEAD per yesterday's branch-creation pass) once spec patch merges. Their kickoff swaps to the new goal file.
4. **Goal #10-revised (pillar-library-pixal3d):** workers spawn against `feat/storybook-workshop-pillar-library-assets` branch with the revised goal file. Asset gen runs on lilaiputia's RTX 4090 (~24h bake for 5000 archetypes via Pixal3D — well within budget since fleet operator already validated the pipeline this week).
5. **Goal #6 ui-shell** worker edits the art-style grid down from 12 to 3 styles when it ships (already on `feat/storybook-workshop-ui-shell` branch at main HEAD).

---

## Risks

- **Headless WebGL2 in OffscreenCanvas:** Real3dHd2dScene currently mounts on a regular `<canvas>` in `Real3dHd2dScene.svelte`. Adapting it to `OffscreenCanvas` for headless render requires a small refactor — verify before committing. Fallback: run a hidden full-screen `<canvas>` element off-DOM if OffscreenCanvas path is too disruptive.
- **Print resolution (16×8 inches @ 300dpi = 4800×2400):** browser WebGL2 max texture / framebuffer typically supports this on desktop, may degrade on phone (mobile cap often 4096). Per spec §9.1 perf target ≤90s p95 full pipeline — phone path may render at 2× (8×4 inches at 600dpi internal then upscale) for production tier.
- **Pixal3D pillar bake budget:** 5000 kid archetypes × 4 views = 20,000 renders @ ~20s each on RTX 4090 = ~110 hours. Fleet operator's RTX 4090 already churned 12 building GLBs in <6h — so 110h is feasible but blocks the GPU for ~5 days. Mitigation: phase the bake — ship v1 with 500 archetypes (11h bake), expand library over time.
- **License story for the 12 baked building GLBs:** Pixal3D + TRELLIS.2 outputs need a re-check. We may need to bake fresh for storybook workshop with explicit copyright cleanliness — confirm before shipping the pillar library asset job to a worker.

---

## End of pivot spec.

Goal files reference this patch + the original 2026-05-24 spec.
