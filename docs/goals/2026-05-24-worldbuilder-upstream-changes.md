# Goal: Storybook Workshop — World Builder Upstream API Extensions

**Wave:** 3 (parallel with pillar-library + marketing-funnel)
**Branch:** `feat/storybook-workshop-wb-extensions` (in DIFFERENT repo)
**Worktree:** `~/devbox/living-village-fishbowl-sw-extensions/` (DIFFERENT repo)
**Upstream repo:** `C:\Users\grant\Downloads\living-village-fishbowl\sveltekit-port` (per pachinko-app CLAUDE.md "Source of truth (upstream)")
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §3.1, §3.7
**Executor preference:** codex (asset-rendering-adjacent; understands existing WB scene compositor)

---

## Why

Storybook Workshop calls World Builder for every spread render. WB API needs three extensions:
1. **`spreadCount > 1` per scene** — N spreads in one API call with shared lighting/biome/staging but different camera framings (continuity within scene).
2. **Pillar overlay on scenes** — given a `pillarId`, compose the pre-rendered archetype avatar into the scene at scene focal point.
3. **Pillar library endpoints** — `GET /api/world/pillar-library/manifest` + per-pillar per-style asset URLs (consumes goal #10's generated assets).

This goal lands in the **separate `living-village-fishbowl` repo**, not pachinko-app. Per CLAUDE.md ASCII+ Rendering Engine section: WB is upstream, pachinko consumes. Goal coordinates the upstream change so pachinko's storybook-workshop UI + assembler can consume it.

---

## Scope (files to create/modify in DIFFERENT REPO `~/devbox/living-village-fishbowl-sw-extensions/`)

```
src/routes/api/world/
├── scene/+server.ts                          # MODIFY: support spreadCount > 1 + pillarId overlay
└── pillar-library/
    ├── manifest/+server.ts                   # NEW: serves manifest.json from CDN proxy
    └── [pillarId]/preview/+server.ts         # NEW: serves per-pillar per-style preview URL
src/lib/game/scene-composer/
├── SpreadContinuityComposer.ts               # NEW: same-scene multi-spread with camera-sequence variation
├── PillarOverlayComposer.ts                  # NEW: composite pillar PNG onto WB scene at focal point
└── (existing files)                          # respect existing architecture, no major refactor
src/lib/game/tiles/
└── (existing — review if pose recipes need to extend for pillar overlay positioning)
tests/storybook-workshop-upstream/
├── scene-spread-count.test.ts                # N-spread continuity
├── pillar-overlay.test.ts                    # focal-point composite + size scaling
└── pillar-library-manifest.test.ts           # endpoint serves valid JSON
```

## Out of scope

- ❌ No pachinko-app code changes (those are goal #1-#11).
- ❌ No pillar library generation (that's pachinko goal #10).
- ❌ No new art styles — workshop uses existing WB style enum.
- ❌ No fishbowl gameplay changes — extensions are storybook-workshop-only consumers.

---

## Build sequence

### Phase 1 — Setup
1. Read upstream `living-village-fishbowl` CLAUDE.md + existing scene-composer in full.
2. From the `living-village-fishbowl` repo main:
   ```bash
   cd ~/devbox/living-village-fishbowl
   git fetch origin
   git worktree add ~/devbox/living-village-fishbowl-sw-extensions -b feat/storybook-workshop-wb-extensions origin/main
   ```
3. Verify the existing `POST /api/world/scene` endpoint shape + scene compositor flow.

### Phase 2 — Multi-spread continuity
4. Modify `src/routes/api/world/scene/+server.ts`:
   - Accept new request fields: `spreadCount: 1..5`, `cameraSequence: 'establishing'|'pan'|'follow'|'tight-on-hero'|'reveal'|'wide-shot'`, `pillarId: number`, `sceneIndexInBeat: number`.
   - Return `{ spreads: [PngBlob, PngBlob, ...] }` array length == spreadCount.
   - For spreadCount > 1: invoke new `SpreadContinuityComposer` to render N spreads with shared lighting/biome/staging but camera-sequence variation per spread.
5. `SpreadContinuityComposer.ts`:
   - Algorithm: lock biome + lighting + staging across the N spreads. Vary only camera framing per spread per `cameraSequence`.
   - Each spread inherits prior spread's color palette + character position with smooth-progression interpolation (for `pan`/`follow` modes especially).
6. Verify spread-to-spread continuity visually in a spot-check (3 sample scenes).

### Phase 3 — Pillar overlay
7. `PillarOverlayComposer.ts`:
   - Input: scene PNG + `pillarId` + `style` (matches scene style) + focal point coords.
   - Fetch pillar asset from CDN (or local proxy if dev): `cdn.lilaiputia.com/pillar-library/v1/{pillarId}/{style}.webp`.
   - Scale pillar to scene focal-point bbox.
   - Alpha-composite onto scene PNG.
   - Output: composite PNG with pillar at focal point.
8. Modify `/api/world/scene` to call `PillarOverlayComposer` after primary scene render.

### Phase 4 — Pillar library endpoints
9. `src/routes/api/world/pillar-library/manifest/+server.ts`:
   - Proxies to CDN-hosted `manifest.json` (5 MB).
   - Cache 1h (manifest is essentially static).
   - Returns same JSON shape as CDN.
10. `[pillarId]/preview/+server.ts`:
    - Validates `pillarId` (int) + `style` (enum).
    - Returns 302 redirect to CDN URL OR serves directly via proxy (document choice; redirect preferred for caching).

### Phase 5 — Tests
11. `scene-spread-count.test.ts`: request spreadCount=3 + cameraSequence='pan' → 3 PNGs returned, continuity assertions (color-palette closeness, character-position smooth-progression).
12. `pillar-overlay.test.ts`: pillar composited at focal point at correct scale.
13. `pillar-library-manifest.test.ts`: manifest endpoint serves valid JSON, per-pillar preview URL returns 302.

### Phase 6 — Pachinko-side consumption verification
14. After upstream PR merges + deploys (or runs locally on localhost:3000):
    - Drive a pachinko-side smoke test: from `~/devbox/pachinko-app-sw-book-assembler` worktree, manually drive `/api/world/scene` with the new fields, verify spread PNGs come back correctly + composite pillar overlay correctly.

### Phase 7 — Sync notice
15. Per CLAUDE.md "Bidirectional awareness" rule + commit message tags: tag the PR commit message with `[NEW-API]` so the pachinko-side ASCII+ sync rule can pick it up.
16. Update pachinko-app CLAUDE.md's "World Builder API:" section to reference new `spreadCount` + `pillarId` fields (separate small PR to pachinko-app, not in this WB-side branch).

---

## Done criteria
- ✅ Upstream `living-village-fishbowl` PR opened against `main`.
- ✅ All 3 endpoint changes shipped + tests green.
- ✅ `[NEW-API]` tag in commit message per sync convention.
- ✅ Pachinko-side smoke verifies the new API end-to-end.
- ✅ implementation-notes.md per Rule 14 in this worktree.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 3 (codex tries to break pillar overlay with edge-case focal points)
- `/codex:rescue` on > 20min stuck

## Implementation-notes.md must document
- Multi-spread continuity algorithm details (interpolation choices)
- Pillar overlay scaling formula
- Manifest proxy vs direct-CDN-redirect choice
- API request schema change documentation

## Branch setup (DIFFERENT REPO)
```bash
cd ~/devbox/living-village-fishbowl
git fetch origin
git worktree add ~/devbox/living-village-fishbowl-sw-extensions -b feat/storybook-workshop-wb-extensions origin/main
```

## Merge-back
Standard PR to upstream `living-village-fishbowl` `main`. King-review pattern is upstream-repo-specific; check that repo's CLAUDE.md for queue.
