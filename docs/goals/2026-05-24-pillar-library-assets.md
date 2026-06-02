# Goal: Storybook Workshop — Pillar Library Asset Generation (Codex Image Tool)

**Wave:** 3 (parallel with marketing-funnel + wb-upstream; runs after Wave 1 lands the manifest contract)
**Branch:** `feat/storybook-workshop-pillar-library-assets`
**Worktree:** `~/devbox/pachinko-app-sw-pillar-library-assets/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §3.2
**Executor preference:** **CODEX** (image generation tool is critical for this goal)

---

## Why

Pre-rendered pillar library is the privacy keystone — 5,000 archetypal kid avatars × 12 art styles ≈ 60,000 images. Each gets a CLIP embedding for client-side cosine matching. Pre-launch deliverable; the entire on-device privacy story collapses without this asset library hosted at the World Builder CDN. Codex's image tool generates these efficiently in batch.

---

## Scope (files to create)

```
scripts/storybook-workshop/pillar-library/
├── generate-archetypes.mjs            # one-time orchestrator: 5000 archetypes × 12 styles
├── axis-config.ts                     # axis definitions (hair, skin, eye, age-band, vibe, extras)
├── prompt-templates.ts                # per-style SDXL prompt templates
├── embed-pillars.mjs                  # CLIP embed each generated image, write manifest
├── compress-and-deploy.mjs            # WebP encode + upload to CDN
├── validate-manifest.mjs              # check manifest shape + dedupe + diversity report
└── README.md                          # how to run, GPU/credit budget, time estimate
infra/cdn/pillar-library-v1/             # output directory (gitignored except manifest)
└── manifest.json                       # 5,000 entries, axes + embedding + URL → fetched by clients
docs/superpowers/specs/2026-05-24-storybook-workshop-pillar-library-spec.md   # asset-pipeline detail spec
```

## Out of scope

- ❌ No service code (PillarVectorizer + Matcher already live from goal #1).
- ❌ No UI integration (workshop UI consumes via World Builder API from goal #6).
- ❌ No WB API endpoint — that's goal #12 (`worldbuilder-upstream-changes`).
- ❌ No ongoing personalization — pillar library is static + pre-rendered, refresh cadence is "as needed" not "live."

---

## Build sequence

### Phase 1 — Axis definitions
1. Read spec §3.2 + ADR-0043 in full.
2. `axis-config.ts`:
   - Hair: 8 variants (color × style combos — black-curly, brown-straight, blonde-wavy, red-curly, dark-braids, light-pixie, mid-shoulder, locs)
   - Skin tone: 6 variants (full Fitzpatrick range)
   - Eye color: 4 variants (brown, blue, green, hazel)
   - Age band: 3 (toddler 2-3, preschool 4-5, grade-school 6-8)
   - Clothing vibe: 5 (cozy, adventurous, whimsy, sporty, classic)
   - Extras: optional combos of {glasses, freckles, none, bandana, hat} — keep this axis sparse
3. Combinatorial space: 8×6×4×3×5×~3 ≈ 8,640 — sample 5,000 archetypes via stratified random to ensure axis coverage.

### Phase 2 — Prompt templates per style
4. `prompt-templates.ts`: 12 styles × prompt template.
   - pixel-32, painted-2d, watercolor, ghibli-ish, low-poly, ink-line, crayon, gouache, manga, claymation, chalkboard, paper-cutout.
   - Each template: `"A {age_band} child with {hair}, {skin_tone} skin, {eye_color} eyes, wearing {clothing_vibe} clothing, {extras_block}, in {style} style, neutral expression, centered portrait, transparent background, no text, no logos, suitable for a children's picture book"`.
   - Style-specific suffix tuning (e.g., `pixel-32`: "8-bit pixel art, 32x32 base, retro game style"; `watercolor`: "soft watercolor wash, paper texture, hand-painted feel").

### Phase 3 — Generation orchestrator
5. `generate-archetypes.mjs`:
   - Reads `axis-config.ts` + `prompt-templates.ts`.
   - Builds the 5000-archetype × 12-style work queue (60,000 jobs).
   - Calls **codex image tool** (or SDXL via OpenAI/Stability/Replicate API — document which) per job.
   - Cost budget cap (document in implementation-notes): ~$0.02/image @ 60k images = ~$1200 worst case. Aim for under $800 via smart batching.
   - Stores generated PNGs at `infra/cdn/pillar-library-v1/{pillarId}/{style}.png`.
   - Idempotency: skip already-generated entries on resume. Crash-safe.
   - Progress logging to console every 100 images.
   - Failure handling: log + skip + collate failures at end. Re-run script targets just failures.

### Phase 4 — Diversity validation
6. After generation: visually-spot-check 5% via inspection sheet (grid of 250 images sampled stratified). Verify:
   - All Fitzpatrick skin tones represented.
   - All hair types represented including coily/textured.
   - No accidental clustering on any axis.
   - No obvious SDXL artifacts (claw fingers, mangled features) in spot-checked sample — re-generate failures.
7. Implement `validate-manifest.mjs` to programmatically check axis coverage post-hoc.

### Phase 5 — CLIP embedding
8. `embed-pillars.mjs`:
   - Load all 5000 PNGs (`default` style — pixel-32 chosen as the embedding-source style for consistency).
   - Run CLIP-ViT-Base-Patch32 over each → 512-dim Float32 vector.
   - Use Python ONNX export (`onnx-clip` or equivalent) for batch speed.
   - Write manifest entry: `{ pillarId, axes, embedding: [...512 floats] }`.
   - Total manifest: ~5 MB JSON (compressed ~1.5 MB gzip).

### Phase 6 — Compress + deploy
9. `compress-and-deploy.mjs`:
   - WebP encode each PNG (lossless quality 90 for v1).
   - Upload to CDN under `cdn.lilaiputia.com/pillar-library/v1/{pillarId}/{style}.webp` (or equivalent CDN path — document the choice).
   - Manifest JSON uploaded to `cdn.lilaiputia.com/pillar-library/v1/manifest.json`.
   - Smoke-check 10 random URLs work + return correct MIME.

### Phase 7 — Documentation
10. `README.md`:
    - How to run the generation pipeline (which env vars, API keys, GPU/credit budget).
    - Estimated time (~6-12 hours total for 60k images at modest concurrency).
    - Re-run instructions for axis updates.
    - Failure-mode handling.

### Phase 8 — Spec doc
11. `2026-05-24-storybook-workshop-pillar-library-spec.md`:
    - Detailed asset-pipeline spec: axis combinatorics, style template language, embedding choice, CDN structure, refresh cadence policy, diversity-coverage validation criteria.
    - This spec lives alongside the main workshop spec; goal #12 (WB upstream) references this for what to serve.

### Phase 9 — Verification
12. Run pipeline end-to-end (likely 6-12 hours wall-clock, can run overnight). Codex worker can drive this with `/codex:rescue` if stuck on any single batch.
13. Manifest JSON validates (every entry has axes + embedding + URL).
14. ~5% spot-check passes diversity criteria.
15. CDN URLs serve valid WebP at expected resolutions.
16. Smoke test from a browser: `fetch('https://cdn.lilaiputia.com/pillar-library/v1/manifest.json').then(r=>r.json())` returns 5,000 entries.

---

## Done criteria
- ✅ All scripts created.
- ✅ Pillar library generated: 5,000 × 12 = 60,000 WebP images on CDN.
- ✅ Manifest JSON published.
- ✅ 5% diversity spot-check passes.
- ✅ Smoke test from browser fetches manifest successfully.
- ✅ Implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged (scripts + spec only; CDN bucket update happens outside the PR via deploy-from-script).

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 4 (codex audits diversity — confirms no accidental clustering, no missing demographics)
- `/codex:rescue` on > 20min stuck (especially around generation failures)

## Implementation-notes.md must document
- Image-tool choice + cost actual vs budget
- Axis stratification method (random vs systematic)
- Style template tuning iterations
- Embedding source-style choice + reasoning
- CDN provider + path structure
- Refresh policy

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-pillar-library-assets -b feat/storybook-workshop-pillar-library-assets origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
