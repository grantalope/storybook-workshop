# Goal: Storybook Workshop — Pillar Vectorizer (WASM CLIP + Fallback)

**Wave:** 1 (parallel with kids-content-safety, story-author, pretext-book-adapter, book-assembler)
**Branch:** `feat/storybook-workshop-pillar-vectorizer`
**Worktree:** `~/devbox/pachinko-app-sw-pillar-vectorizer/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §3.2-§3.4, §4.4
**ADR:** [docs/adr/0043-storybook-workshop-privacy-on-device-pillar.md](../../adr/0043-storybook-workshop-privacy-on-device-pillar.md)
**Executor preference:** claude

---

## Why

Privacy moat starts here. On-device WASM CLIP vectorizes the kid's photo and matches it against a pre-rendered pillar library — opaque pillar IDs are the only thing that ever leaves the device on the happy path. Fallback `/api/storybook-workshop/vectorize` endpoint covers low-end devices behind explicit consent. Spec §4.4 makes the privacy claim verifiable in the network tab; this goal makes it true in code.

---

## Scope (files to create)

```
src/routes/dashboard/services/storybook-workshop/
├── PillarVectorizerService.ts        # WASM CLIP forward pass, photo → 512-dim vector
├── PillarMatcherService.ts            # cosine sim vs pre-fetched manifest, top-K + age-band rerank
├── PillarManifestClient.ts            # one-shot fetch of WB pillar manifest, cached for session
├── types.ts                           # Pillar, PillarMatch, PillarVectorizerOpts shapes
└── index.ts                           # barrel
src/routes/api/storybook-workshop/
└── vectorize/+server.ts                # fallback POST endpoint, stateless, rate-limited
tests/storybook-workshop/
├── pillar-vectorizer.test.ts          # vector shape + photo-discarded-after-call
├── pillar-matcher.test.ts             # cosine match correctness + age-band rerank
└── pillar-manifest-client.test.ts     # cache behavior, manifest validation
```

## Out of scope

- ❌ No pillar library generation — that's goal #10 `pillar-library-assets`.
- ❌ No World Builder API extension — that's goal #12 `worldbuilder-upstream-changes`.
- ❌ No workshop UI integration — that's goal #6 `ui-shell`.
- ❌ No kernel manifest registration in AppOrchestrator — Wave 1 services declare manifests but Wave 2's UI wiring registers them. Add `// TODO Wave 2: register in AppOrchestrator` comments where appropriate.

---

## Build sequence

### Phase 1 — Types
1. Read spec §3.2-§3.4, ADR-0043 in full.
2. Create `services/storybook-workshop/types.ts`:
   - `PillarAxes = { hair, skinTone, eyeColor, ageBand: 'toddler'|'preschool'|'grade-school', clothingVibe, extras: string[] }`
   - `Pillar = { pillarId: number, axes: PillarAxes, embedding: Float32Array (512-dim) }`
   - `PillarMatch = { pillarId: number, similarity: number, axes: PillarAxes }`
   - `PillarVectorizerOpts = { ageBandHint?: AgeBand, fallback: 'consent-required' | 'manual-grid' }`

### Phase 2 — WASM CLIP service
3. Create `PillarVectorizerService.ts`:
   - Load `@xenova/transformers` 2.17.2 via CDN (cannot use Vite optimizer — see project gotchas).
   - `Xenova/clip-vit-base-patch32`, WASM CPU backend.
   - Method `vectorize(photoBlob: Blob): Promise<Float32Array>` — single forward pass, returns 512-dim vector.
   - After forward pass: photo blob deleted from local refs, gc-eligible. Document this in code comments.
   - Method `isReady(): boolean`, `activeBackend(): 'webgpu' | 'wasm' | 'fallback'`.
   - Warmup probe order: webgpu (only if available) → wasm → mark fallback-needed if both fail.

### Phase 3 — Pillar manifest client
4. Create `PillarManifestClient.ts`:
   - `fetchManifest(): Promise<Pillar[]>` — one GET to `/api/world/pillar-library/manifest` (proxied to World Builder upstream).
   - Cache in module-scoped variable for session lifetime. Re-fetch on explicit `invalidate()` call.
   - Validate manifest shape; throw on schema mismatch.
   - Fall back gracefully if WB unreachable: return empty array + log warning; downstream `PillarMatcherService.match()` returns empty result, UI handles "WB pillar library unavailable, please try again later."

### Phase 4 — Pillar matcher (local cosine)
5. Create `PillarMatcherService.ts`:
   - `match(kidVector: Float32Array, opts: { ageBandHint, topK }): PillarMatch[]` — cosine sim vs every pillar in manifest, top-K sorted.
   - **Age-band rerank:** pillars matching `ageBandHint` get +0.1 sim boost. (Tunable constant.)
   - **`refineNear(pillarId, topK)`:** k-NN from a specific pillar's neighborhood (parent says "more like this").
   - **`refineExcluding(prevPillarIds, topK)`:** re-rank with previously-shown excluded ("different vibe").

### Phase 5 — Fallback endpoint
6. Create `src/routes/api/storybook-workshop/vectorize/+server.ts`:
   - `POST /api/storybook-workshop/vectorize` — accepts multipart form with photo blob.
   - No auth, no logging beyond aggregate counter.
   - Rate-limit: 10 req/min per IP (in-memory leaky-bucket).
   - Process: receive blob → load CLIP server-side (warm) → forward pass → return `{ embedding: number[] }`.
   - **Photo discarded synchronously** post-CLIP. No persistence. No streaming.
   - TLS-only enforcement check.
   - Return 503 + `{ error: 'rate_limited' }` on overflow.

### Phase 6 — Tests
7. `tests/storybook-workshop/pillar-vectorizer.test.ts` (vitest):
   - Stubbed CLIP returns deterministic vector for a given input blob.
   - Vector is `Float32Array` of length 512.
   - After `vectorize()` returns, photo blob ref is null.
   - `isReady()` returns true after warmup probe completes.
   - Throws clean error if both webgpu + wasm fail.
8. `pillar-matcher.test.ts`:
   - 10 synthetic pillars + a kid vector → `match(topK=3)` returns 3 nearest by cosine.
   - Age-band boost is applied.
   - `refineNear` returns neighborhood of seed pillar.
   - `refineExcluding` excludes previously shown.
9. `pillar-manifest-client.test.ts`:
   - Cache: 2 consecutive calls = 1 network fetch.
   - `invalidate()` triggers refetch.
   - Empty array on WB unreachable.
10. ≥18 total new vitest tests across the three files.

### Phase 7 — Verification
11. From the worktree:
    ```bash
    cd src/routes/dashboard
    npx vitest run ../../../../../tests/storybook-workshop/
    ```
    All new tests green.
12. `pnpm check` clean.
13. `node scripts/invariants/check-no-raw-setintervals.mjs` clean.
14. **Manual smoke**: open dev server, run in console:
    ```js
    const { pillarVectorizerService } = await import('/src/routes/dashboard/services/storybook-workshop/index.ts');
    await pillarVectorizerService.warmup();
    const blob = await fetch('/sample-photo.jpg').then(r => r.blob());
    const v = await pillarVectorizerService.vectorize(blob);
    console.log(v.length, v.slice(0, 8));
    ```
    Expected: 512 + 8 floats.

---

## Done criteria
- ✅ Services + endpoint + tests as listed.
- ✅ ≥18 new tests green.
- ✅ `pnpm check` clean.
- ✅ Manual browser smoke proves WASM CLIP runs + returns 512-dim vector.
- ✅ Fallback endpoint smoke (curl) verifies stateless behaviour + photo not persisted.
- ✅ Rate-limit verified by spamming endpoint.
- ✅ `implementation-notes.md` maintained per CLAUDE.md Rule 14.
- ✅ PR opened + king-review label + king merges per CLAUDE.md §6b.

## Codex review hooks
- `/codex:review --base main` after every commit
- `/codex:adversarial-review` after Phase 5 (endpoint hardening — codex tries to leak photos)
- `/codex:adversarial-review` after Phase 6 (codex tries to break matcher with degenerate vectors)
- `/codex:rescue <description>` if stuck > 20 min

## Implementation-notes.md must document
- Why @xenova/transformers via CDN (Vite optimizer gotcha)
- Why CLIP-ViT-Base over Tiny (accuracy vs perf tradeoff)
- Age-band boost weight chosen + reasoning
- Fallback endpoint rate-limit threshold + reasoning
- Manifest cache TTL decision

## Branch + worktree setup
```bash
cd ~/devbox/pachinko-app
git fetch origin
git worktree add ~/devbox/pachinko-app-sw-pillar-vectorizer -b feat/storybook-workshop-pillar-vectorizer origin/feat/storybook-workshop-product-branch
ln -sfn ~/devbox/pachinko-app/node_modules ~/devbox/pachinko-app-sw-pillar-vectorizer/node_modules
cd ~/devbox/pachinko-app-sw-pillar-vectorizer
```

## Merge-back per CLAUDE.md §6b
Standard temp-main-worktree pattern, target `main`.
