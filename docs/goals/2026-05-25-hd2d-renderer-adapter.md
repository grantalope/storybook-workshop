# Goal: Storybook Workshop — HD-2D Renderer Adapter

**Wave:** 3 (replaces deprecated goal #12 `worldbuilder-upstream-changes`)
**Branch:** `feat/storybook-workshop-worldbuilder-upstream-changes` (reuse existing pushed branch — name is legacy, scope is now HD-2D adapter)
**Worktree:** `~/devbox/pachinko-app-sw-worldbuilder-upstream-changes/` (create against branch above)
**Spec:** [docs/superpowers/specs/2026-05-25-storybook-workshop-hd2d-renderer-pivot.md](../specs/2026-05-25-storybook-workshop-hd2d-renderer-pivot.md) + [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §3
**Executor preference:** claude (with /codex:rescue for HD-2D engine-internals questions)

---

## Why

Storybook Workshop pivots from "call WB upstream API for painted_2d PNGs" to "consume the in-repo THREE r171 HD-2D engine locally + capture per-spread WebGL2 canvas frames." Engine modules already shipped under `src/routes/dashboard/components/hd2d/three/` on a sibling branch. This goal builds the **adapter layer** on top — bundle composition + headless mount + camera-sequence iteration + 4 biome bundle templates.

Privacy strengthens: no outbound API hop for the rendered scene. Pillar IDs + scene briefs stay on-device. Quality jumps multiple tiers (real 3D + lit billboards + bloom + tilt-shift vs flat 2D).

---

## Scope (files to create)

```
src/routes/dashboard/services/storybook-workshop/render/
├── StorybookSceneRenderer.ts         # public API: render(req) → spreads + focal points
├── BundleComposer.ts                  # locale + cast → RealPlaceBundle
├── HeadlessSceneMounter.ts            # mount Real3dHd2dScene on OffscreenCanvas
├── CameraSequenceResolver.ts          # cameraSequence enum + sceneIndex → CameraRig state keyframes
├── LightingPresetResolver.ts          # 6 lighting enum → OctopathGradePipeline LUT + bloom + tilt-shift config
├── biome-templates/
│   ├── coastal-village.bundle.json    # static template per biome
│   ├── forest-shrine.bundle.json
│   ├── desert-oasis.bundle.json
│   └── mountain-monastery.bundle.json
└── types.ts                           # SpreadRenderRequest, SpreadRenderResult, FocalPoint shapes
tests/storybook-workshop/render/
├── storybook-scene-renderer.test.ts
├── bundle-composer.test.ts
├── camera-sequence-resolver.test.ts
└── lighting-preset-resolver.test.ts
e2e/storybook-workshop-hd2d-render.spec.ts  # Playwright: drive a render request, verify PNG output non-empty + roughly correct
```

## Out of scope

- ❌ Modifying HD-2D engine modules (`MapCompiler` / `Tilemap3D` / `RegionExtruder` / `LitBillboardSystem` / `PropsBuilder` / `OctopathGradePipeline` / `CameraRig` / `SettlerAnimator` / `Real3dHd2dScene`). Consume them unchanged.
- ❌ Generating pillar billboard assets — goal #10 pillar-library-pixal3d does that.
- ❌ Story authoring — goal #3 done.
- ❌ PDF assembly — goal #5 done.
- ❌ UI integration into workshop Station 6 generation sequence — wired in goal #6 ui-shell.

---

## Build sequence

### Phase 1 — Types
1. Read pivot spec + original spec §3 in full + the existing HD-2D engine modules at `src/routes/dashboard/components/hd2d/three/`.
2. Create `types.ts` with `SpreadRenderRequest`, `SpreadRenderResult`, `FocalPoint`, `BiomeId`, `ArtStyle ('octopath-hd2d' | 'flat-painted' | 'pixel-pure')`, `CameraSequence`, `LightingPreset` enums.

### Phase 2 — Biome templates
3. Create 4 static `*.bundle.json` files. Each is a `RealPlaceBundle` skeleton (per `src/routes/dashboard/types/RealPlaceTypes.ts`) describing the locale: map.png reference, asciiGrid (or seed for one), cutout placements (settler + monument + vegetation hotspots), pre-computed building regions.
4. Coastal-village + forest-shrine + desert-oasis + mountain-monastery should map to the 4 already-rendered biomes from `static/hd2d-report/octopath-engine-*.png`. Copy their bundle source from the existing `feat/real-place-pipeline-e2e` branch's bundle generator output.

### Phase 3 — BundleComposer
5. `BundleComposer.compose(req): RealPlaceBundle` — clone biome template, then patch:
   - Replace/insert kid pillar billboard at the "hero focal" cutout slot (each biome template designates one).
   - Replace/insert sidekick settler at "companion" slot.
   - Insert supporting cast cutouts at "side cast" slots (capped at 3).
   - Override sceneBrief into the bundle's narrative field if the bundle has one (for future LLM-driven map rebuilds; v1 unused).

### Phase 4 — CameraSequenceResolver
6. Map `(cameraSequence, sceneIndex)` → `CameraRig` state keyframe (`{ yaw, zoom, focus }`):
   - `establishing` → wide ortho, zoom 0.8, focus map-center
   - `pan` → over N spreads, yaw drifts +15° per spread (locked focus)
   - `follow` → focus tracks hero pillar position, zoom 1.0
   - `tight-on-hero` → zoom 1.4, focus = hero pillar, yaw stable
   - `reveal` → zoom 0.6 spread 1 → 1.2 by spread N
   - `wide-shot` → zoom 0.7, full map visible

### Phase 5 — LightingPresetResolver
7. Map `LightingPreset` → `OctopathGradePipeline` config:
   - `warm-front` → bloom thresh 0.85, sunset LUT (default), tilt-shift mid
   - `cool-side` → cool dawn LUT (new), bloom thresh 0.9, side rim-light direction
   - `dramatic-back` → silhouette-favoring back-light, bloom thresh 0.7 str 0.8, deeper tilt-shift
   - `golden-hour` → warm-gold LUT, bloom thresh 0.8 str 0.7
   - `moonlight` → cool-blue desat LUT, bloom thresh 0.95 str 0.4
   - `firelit` → orange-warm LUT, dynamic per-tile flicker light at fire-source positions, bloom thresh 0.75 str 0.8
8. **Add 5 new LUT textures** to `static/hd2d-luts/` if not already present: dawn / golden-hour / moonlight / dramatic-back / firelit. Each 16×16×16 baked from a reference grade.
9. Document each LUT's source (which reference image / palette).

### Phase 6 — HeadlessSceneMounter
10. **Critical refactor:** `Real3dHd2dScene.svelte` mounts on a DOM canvas. To render headless we need either:
    - **Option A (preferred):** add an off-DOM hidden `<canvas>` element to a temporary container, mount the scene component there, capture once via `canvas.toBlob`, unmount. Minimal engine refactor.
    - **Option B:** refactor the engine to accept an `OffscreenCanvas` instead of HTMLCanvasElement. Bigger change; coordinate with codex worker on `feat/real-place-pipeline-e2e`.
11. Implement Option A first. Component lifecycle: create hidden div → mount component with props (`bundle`, `positions`, `settlerSlugList`, `width`, `height`) → wait for `loadingLabel` to clear → trigger one frame render → capture → destroy. Use Svelte 5 imperative mount API.
12. After capture, swap CameraRig state, re-render, re-capture for subsequent spreads in the scene. Avoid full remount.

### Phase 7 — StorybookSceneRenderer
13. Public `render(req: SpreadRenderRequest): Promise<SpreadRenderResult>` orchestrates:
    a. BundleComposer.compose(req) → bundle
    b. HeadlessSceneMounter.mount(bundle, req.width, req.height) → scene
    c. For each `i in 0..req.spreadCount`: CameraSequenceResolver(req.cameraSequence, i) → set rig state; LightingPresetResolver(req.lighting) applied once at mount; render frame; capture; collect.
    d. Extract focal points (hero pillar screen-space position + radius from rendered frame projection) for PretextFlowEngine text-wrap.
    e. Return `SpreadRenderResult`.
14. Audit object includes: gpuBackend, frameTimeMs[], pillarId, biome, lighting — for telemetry per §3.11.

### Phase 8 — Tests
15. `storybook-scene-renderer.test.ts`: mock the inner engine, verify orchestration: bundle composed correctly, cameraSequence iterated, lighting applied once per scene, focal points returned, audit populated. 8+ cases.
16. `bundle-composer.test.ts`: 4 biomes × kid/sidekick/cast placement variants, cutout slot replacement semantics. 12+ cases.
17. `camera-sequence-resolver.test.ts`: each 6 sequences × spreadCount {1,3,5} producing the right CameraRig state arrays. 10+ cases.
18. `lighting-preset-resolver.test.ts`: each 6 lightingPresets maps to correct OctopathGradePipeline config; LUT path resolution. 8+ cases.
19. Playwright `e2e/storybook-workshop-hd2d-render.spec.ts`: invoke a real render in the dev server, verify the returned PNG blob is non-empty + dimensions correct + visually contains the expected pillar (basic image-diff vs a fixture).

### Phase 9 — Verification
20. `pnpm check` clean.
21. `npx vitest run tests/storybook-workshop/render/` all green.
22. Lint invariants clean.
23. Manual smoke in real browser: `pnpm dev:agent` → open `/dashboard/debug/storybook-workshop-render-preview` (new dev page, optional) → input a SpreadRenderRequest → see the captured PNG. Verify visual quality matches Real3dHd2dScene output on `/dashboard/real-place/[slug]?renderer=real-3d`.

---

## Done criteria
- ✅ All files created.
- ✅ ≥38 vitest tests + Playwright e2e green.
- ✅ Headless render produces print-quality PNG matching live `/dashboard/real-place/[slug]?renderer=real-3d` quality.
- ✅ All 6 cameraSequence × {1..5} spreadCount combos produce sensible camera state progression.
- ✅ All 6 lightingPreset values produce visibly distinct frames.
- ✅ implementation-notes.md per CLAUDE.md Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 6 (HeadlessSceneMounter — codex tests OffscreenCanvas vs hidden-DOM-canvas edge cases)
- `/codex:adversarial-review` after Phase 7 (codex hand-crafts edge-case render requests)
- `/codex:rescue` for HD-2D engine-internals questions — the engine worker on `feat/real-place-pipeline-e2e` can answer specifics

## Implementation-notes.md must document
- HeadlessSceneMounter Option A vs B chosen + why
- 5 new LUT texture sources + license confirmation
- Camera state keyframe formulae per sequence
- Lighting preset → bloom thresh/str/rad mappings
- Headless render perf observed (frameTimeMs distribution)
- Tradeoff: OffscreenCanvas WebGL2 vs hidden-DOM-canvas — which the production path uses + why

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-worldbuilder-upstream-changes -b feat/storybook-workshop-worldbuilder-upstream-changes origin/feat/storybook-workshop-worldbuilder-upstream-changes  # reuse the existing pushed empty branch
# branch name is legacy from yesterday's spec; the goal IS the HD-2D adapter now
```

## Merge-back per CLAUDE.md §6b → main.
