# Goal: Storybook Workshop — Pillar Library Asset Generation (Pixal3D Multi-View Billboard Bake)

**Wave:** 3 (REVISED — replaces goal #10 `pillar-library-assets` flat-2D approach)
**Branch:** `feat/storybook-workshop-pillar-library-assets` (reuse existing pushed branch at main HEAD)
**Worktree:** `~/devbox/pachinko-app-sw-pillar-library-assets/`
**Spec:** [docs/superpowers/specs/2026-05-25-storybook-workshop-hd2d-renderer-pivot.md](../specs/2026-05-25-storybook-workshop-hd2d-renderer-pivot.md) §"Goal #10 revised"
**Executor preference:** **CODEX** (image generation + Pixal3D bake pipeline tooling) — runs on lilaiputia's RTX 4090

---

## Why

Original goal #10 produced flat 2D archetype PNGs in 12 art styles. The HD-2D pivot requires **multi-view billboard sprite sheets** so each kid pillar can act as a lit camera-facing billboard in `Real3dHd2dScene` with NE-cast shadows. Use the same Pixal3D + TRELLIS.2 pipeline the fleet operator validated this week for the 12 building GLBs. Generate 5,000 kid archetypes once → bake each through Pixal3D → output 4-view sprite sheets compatible with `SettlerAnimator`'s 8×4 frame grid contract.

---

## Scope (files to create)

```
scripts/storybook-workshop/pillar-library/
├── generate-flat-archetypes.mjs       # SDXL → 5000 flat front portraits at 64×64 (axis-stratified)
├── bake-multiview-billboards.mjs      # Pixal3D + TRELLIS.2 per archetype → front/back/left/right sheets
├── embed-pillars.mjs                  # CLIP embed each archetype's front sheet → manifest.json
├── compose-spritesheets.mjs            # arrange 8×4 frame grids per view (idle + walk-cycle)
├── compress-and-deploy.mjs            # WebP encode + upload to CDN
├── validate-coverage.mjs              # axis-stratification + diversity report
├── axis-config.ts                     # archetype axes (hair × skin × eye × age × vibe × extras)
└── README.md                          # how to run on lilaiputia RTX 4090
infra/cdn/pillar-library-v1/
├── manifest.json                       # 5000 entries × axes + embedding + asset URLs
└── {pillarId}/
    ├── preview.png                     # front facing 256×256 thumbnail
    ├── front.png                       # 8×4 grid sprite sheet (idle 0-3 + walk 4-7 × 4 facing rows)
    ├── back.png
    ├── left.png
    └── right.png
docs/superpowers/specs/2026-05-25-storybook-workshop-pillar-library-pixal3d-spec.md   # asset pipeline detail
```

## Out of scope

- ❌ Service code (PillarVectorizer + Matcher already shipped in goal #1).
- ❌ UI integration (workshop UI consumes via manifest from goal #6).
- ❌ HD-2D adapter (separate goal `storybook-workshop-hd2d-renderer-adapter`).
- ❌ Building GLBs — those are already baked on `feat/real-place-pipeline-e2e` worktree at `static/hd2d-report/glbs/`. Reuse.
- ❌ Settler avatars — those exist in the dynamic roster. Only kid pillars are new here.

---

## Build sequence

### Phase 1 — Axis config + flat generation
1. Read pivot spec §"Goal #10 revised" + the original goal #10 in full.
2. `axis-config.ts`: same axes as original goal #10. Hair 8 × Skin 6 × Eye 4 × Age 3 × Vibe 5 × Extras (sparse) = ~8640 combo → stratified-random sample 5000.
3. `generate-flat-archetypes.mjs`: SDXL → 5000 flat front portraits at 64×64 pixel-art style (matches the Pack A tile aesthetic). Cost budget cap ~$100 worst-case via cloud SDXL OR free if running on lilaiputia 4090 itself. Document choice in implementation-notes.

### Phase 2 — Pixal3D multi-view bake
4. `bake-multiview-billboards.mjs`: drive Pixal3D + TRELLIS.2 on RTX 4090 (resolution 1536, `--low_vram` orchestration, bf16 image_cond_models per the verified config from `feat/real-place-pipeline-e2e` implementation-notes).
5. Per archetype: input 64×64 front PNG → Pixal3D output is a full 3D mesh GLB. Render 4 camera angles around the GLB (front 0°, right 90°, back 180°, left 270°) at 256×256 → 4 view sheets per archetype.
6. Per view: render 8 animation frames (idle 4 frames + walk-cycle 4 frames). Compose into 8×4 sprite sheet (8 columns × 4 facing rows — convention from `SettlerAnimator`).
7. Idempotency: skip archetypes already baked on resume. Crash-safe.
8. Failure handling: log + skip + collate at end. Re-run targets just failures.
9. **Bake budget: ~20s per archetype × 4 views = 80s per archetype × 5000 = ~110 hours wall-clock.** Phase v1 with 500 archetypes (~11h) to ship workshop launch; expand library over time.

### Phase 3 — Sprite sheet composition
10. `compose-spritesheets.mjs`: stitches 8 frames × 4 facings into one 2048×1024 PNG (256×256 per cell × 8 cols × 4 rows). One sheet per view direction (so 4 sheets per archetype). Or alternative: single mega-sheet per archetype with all 32 frames in a row (8 frames × 4 facings = 32 cells). Match exactly what `SettlerAnimator`'s `setBillboardFrame()` expects — read its source first.

### Phase 4 — CLIP embedding
11. `embed-pillars.mjs`: load each archetype's front-facing idle-frame-0 PNG → CLIP-ViT-Base-Patch32 embed → 512-dim Float32 vector. Write to `manifest.json` per archetype.
12. Manifest entry: `{ pillarId, axes, embedding, urls: { preview, front, back, left, right } }`. Total ~5 MB JSON.

### Phase 5 — CDN deploy
13. `compress-and-deploy.mjs`: WebP encode each PNG (lossless quality 90). Upload to `cdn.lilaiputia.com/pillar-library/v1/{pillarId}/{view}.webp`. Manifest at `cdn.lilaiputia.com/pillar-library/v1/manifest.json`. Smoke-check 10 random URLs.

### Phase 6 — Diversity validation
14. `validate-coverage.mjs`: spot-check 5% via inspection sheet — confirm Fitzpatrick skin tones, hair textures including coily, no SDXL artifacts in front-facing idle frame. Re-bake failures. Programmatic axis-coverage check post-hoc.

### Phase 7 — Spec + README
15. Detailed asset-pipeline spec at `docs/superpowers/specs/2026-05-25-storybook-workshop-pillar-library-pixal3d-spec.md`. Cover the SDXL prompt template, Pixal3D config, multi-view camera angles, animation frame count, sprite-sheet layout convention, CDN structure, refresh-policy, diversity-validation criteria.
16. `scripts/storybook-workshop/pillar-library/README.md`: how to run on lilaiputia (env vars, GPU/disk requirements, time estimate, re-run failures).

### Phase 8 — Verification
17. Run pipeline end-to-end for **500-archetype v1** (~11h wall-clock — overnight bake fine).
18. Manifest JSON validates (every entry has axes + embedding + 5 URLs).
19. 5% spot-check passes diversity criteria.
20. CDN URLs serve valid WebP at expected resolutions.
21. Smoke test from browser: `fetch('https://cdn.lilaiputia.com/pillar-library/v1/manifest.json').then(r=>r.json())` returns 500 entries.
22. Manual visual smoke: load 5 random archetypes in a test page → confirm all 4 views match the front (same kid, just rotated).
23. Adapter smoke (depends on goal `hd2d-renderer-adapter` for the testbed): plug one pillar into `Real3dHd2dScene` as `settlerSlugList[0]` → confirm `SettlerAnimator` consumes the sprite sheet without errors → 4-facing yaw billboard rotates correctly.

---

## Done criteria
- ✅ All scripts created + spec written.
- ✅ Pillar library v1 generated: 500 × 4-view sprite sheets on CDN.
- ✅ Manifest JSON published with 500 entries.
- ✅ 5% diversity spot-check passes.
- ✅ Adapter smoke: pillar billboard renders correctly in `Real3dHd2dScene` via `SettlerAnimator` contract.
- ✅ implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged (scripts + spec only; CDN bucket updates outside PR).

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 6 — codex audits diversity + multi-view consistency (same kid front vs back?)
- `/codex:rescue` on bake failures (especially RTX 4090 OOM / VRAM exhaustion)

## Implementation-notes.md must document
- SDXL provider + cost actual vs budget
- Pixal3D + TRELLIS.2 config (resolution, low_vram, bf16 — match `feat/real-place-pipeline-e2e` notes)
- Multi-view camera angle scheme (0/90/180/270 vs offset)
- Animation frame count + walk-cycle approach (idle-loop only? walk added?)
- Sprite sheet layout per `SettlerAnimator` contract (8×4 grid)
- CDN provider + path structure
- v1 = 500 archetypes; v2 expansion plan
- License confirmation for Pixal3D + TRELLIS.2 outputs

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-pillar-library-assets -b feat/storybook-workshop-pillar-library-assets origin/feat/storybook-workshop-pillar-library-assets  # reuse existing pushed empty branch
```

## Merge-back per CLAUDE.md §6b → main.
