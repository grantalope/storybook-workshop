# Goal: Storybook Workshop — BookAssembler (PDF + ePub + Read-Along)

**Wave:** 1 (parallel)
**Branch:** `feat/storybook-workshop-book-assembler`
**Worktree:** `~/devbox/pachinko-app-sw-book-assembler/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §3.9
**Executor preference:** claude

---

## Why

The privacy keystone. **This is the ONLY service that touches the kid's name.** It assembles 9+ World-Builder-rendered PNGs + PreText composite frames into a print-ready PDF (CMYK 300dpi bleed-marked, validated against Lulu print spec) + ePub3 with dedication audio + a web read-along bundle. Name + dedication composited locally; kid's identity never crosses any API boundary except the final Lulu print POST.

---

## Scope (files to create)

```
src/routes/dashboard/services/storybook-workshop/assemble/
├── BookAssembler.ts                   # main: composite PNGs + name + ePub + read-along
├── PdfBuilder.ts                      # pdf-lib wrapper, CMYK + 300dpi + bleed + spine width calc
├── EpubBuilder.ts                     # ePub3 + media-overlay for dedication audio
├── ReadAlongBundleBuilder.ts          # web bundle: animated canvas + voice clip + page-turn
├── LuluPdfSpecValidator.ts            # validate PDF against Lulu print spec (page count, bleed, trim, CMYK, embedded fonts)
├── NameOverlayCompositor.ts           # overlays kid name + dedication onto WB-rendered PNGs
├── CoverComposer.ts                   # cover + spine + back-cover assembly
├── types.ts                           # AssembledBook, BookAssetBundle shapes
└── index.ts
src/routes/api/storybook-workshop/
└── book/[shortcode]/+server.ts        # serves read-along bundle to public shareable URL
tests/storybook-workshop/assemble/
├── book-assembler.test.ts
├── pdf-builder.test.ts
├── epub-builder.test.ts
├── read-along-bundle-builder.test.ts
├── lulu-pdf-spec-validator.test.ts
├── name-overlay-compositor.test.ts
└── cover-composer.test.ts
```

## Out of scope

- ❌ No Lulu API integration — that's goal #8 `fulfillment`.
- ❌ No Stripe — goal #8.
- ❌ No World Builder API calls — Wave 1 assumes WB PNGs are inputs (mocked in tests).
- ❌ No PreText animation — that's goal #4; assembler consumes already-composited frames + animation manifests.

---

## Build sequence

### Phase 1 — Types
1. Read spec §3.9 + Lulu print spec docs (https://developers.lulu.com/) in full.
2. `types.ts`:
   - `BookAssetBundle = { wbPngsByScene: Map<sceneId, Blob[]>, pretextStaticFrames: Map<spreadIndex, Blob>, animationManifests: Map<spreadIndex, AnimationManifest>, dedicationAudio?: Blob, voiceOver?: Blob, kidName, dedication, sidekickSettlerInfo, title, backCoverBlurb, format: 'hardcover-8x8' | 'softcover-8x8' | 'saddlestitch-8x8', pages: number, coverBadge?, endpaper?, authorByline }`
   - `AssembledBook = { pdfBlob: Blob, epubBlob: Blob, readAlongBundleUrl?: string, shortcode: string, audit: AssemblyAudit }`
   - `AssemblyAudit = { pdfHash: string, pageCount, ts, fontEmbedSummary, bleedValidated, cmykValidated }`

### Phase 2 — NameOverlayCompositor (the privacy keystone)
3. `NameOverlayCompositor.ts`:
   - Inputs: WB-rendered PNG + spread text containing `{HERO_NAME}` placeholder + kid name.
   - Output: composited PNG with name baked into image text via canvas. Replaces `{HERO_NAME}` in spread text.
   - Document loudly in code comments: this is the only step that touches kid's name. Do not move name handling outside this service.
   - Multi-spread variant: also composites name into dedication page + cover.

### Phase 3 — CoverComposer
4. `CoverComposer.ts`:
   - Cover front + back + spine assembly.
   - Title typography via PretextCompositor (handed off from goal #4).
   - Cover badge if specified ("Birthday Edition" etc).
   - Back-cover blurb.
   - Author byline.
   - Spine width formula: `pageCount * pageThickness + bleed`. PageThickness varies by paper stock (Lulu default ~0.10mm uncoated, ~0.13mm coated; read from format config).

### Phase 4 — PdfBuilder
5. `PdfBuilder.ts`:
   - Use `pdf-lib` (already in tree per check) or `@react-pdf/renderer`.
   - CMYK color space, 300dpi raster compose.
   - Per-format bleed marks (Lulu hardcover casewrap = 0.125" bleed all sides).
   - Embed fonts (subsetted to spread text only — minimizes PDF size).
   - Page order: cover (front) → endpaper → title page → dedication page → 7-beat spread sequence → back-cover blurb → endpaper → cover (back).
   - Output blob.
6. PdfBuilder is the ONLY consumer of NameOverlayCompositor's output for PDF interior. Cover uses CoverComposer for the typography overlay.

### Phase 5 — LuluPdfSpecValidator
7. `LuluPdfSpecValidator.ts`:
   - Pre-checkout validator. Reject early before charging.
   - Checks: page count in valid range per format (hardcover ≥24, softcover ≥32, saddle 4-48), page count is multiple of 2 (or 4 for saddle), bleed marks present, CMYK color space, all fonts embedded, spine width correct, trim size matches Lulu SKU expected dimensions.
   - Returns `{ valid: boolean, errors: ValidationError[] }`. Each error has parent-readable message.

### Phase 6 — EpubBuilder
8. `EpubBuilder.ts`:
   - ePub3 schema with media-overlay for dedication audio (if `dedicationAudio` present).
   - Each spread = 1 ePub `<section>` with the spread PNG + spread text + media-overlay sync to voice clip if `voiceOver` present.
   - Returns blob.

### Phase 7 — ReadAlongBundleBuilder
9. `ReadAlongBundleBuilder.ts`:
   - Builds a web-serveable bundle for `/storybook-workshop/preview/{shortcode}`.
   - Spreads + animation manifests + voice-over blob.
   - Shortcode is 8-char base32 generated client-side; collision check via backend.
   - Email-gate gates display past spread index 4 (handled in `+server.ts`, not bundle).

### Phase 8 — Shareable URL handler
10. `src/routes/api/storybook-workshop/book/[shortcode]/+server.ts`:
    - GET → fetch bundle from CDN / IDB / temp storage.
    - Past spread 4: check email session cookie. If missing, return 401-equivalent + email-gate signal for client.
    - Email submission endpoint: `POST /api/storybook-workshop/book/[shortcode]/email-gate` records email in CRM (Resend or Postmark), unlocks via session cookie. (Marketing-funnel integration in goal #11.)

### Phase 9 — BookAssembler orchestrator
11. `BookAssembler.ts`:
    - `assemble(bundle: BookAssetBundle): Promise<AssembledBook>`.
    - Sequence:
      a. NameOverlayCompositor: overlay name into each spread PNG.
      b. CoverComposer: build cover + back-cover + spine.
      c. PdfBuilder: assemble PDF blob.
      d. LuluPdfSpecValidator: validate. Throw on fail (caller handles UI error).
      e. EpubBuilder: assemble ePub blob.
      f. ReadAlongBundleBuilder: assemble web bundle + register shortcode.
      g. Compute `pdfHash` (sha-256 of PDF blob — used for Stripe-dispute defense).
      h. Return AssembledBook.

### Phase 10 — Tests
12. `book-assembler.test.ts`: end-to-end with mocked WB PNGs, mocked PretextCompositor frames. Verify PDF blob non-empty, ePub blob non-empty, audit hash deterministic for same inputs.
13. `pdf-builder.test.ts`: CMYK assertion, bleed marks, font embedding, spine width formula correctness.
14. `epub-builder.test.ts`: ePub schema validation (unzip + check), media-overlay when audio present.
15. `read-along-bundle-builder.test.ts`: shortcode uniqueness, bundle shape.
16. `lulu-pdf-spec-validator.test.ts`: 10+ cases (valid passes, each rejection reason fires).
17. `name-overlay-compositor.test.ts`: placeholder replacement correct, name overlay position respects focal point.
18. `cover-composer.test.ts`: spine width per format, badge placement, back-cover blurb layout.
19. ≥45 new tests.

### Phase 11 — Verification
20. `npx vitest run tests/storybook-workshop/assemble/` → green.
21. `pnpm check` clean.
22. Manual smoke: in dev console, drive `bookAssembler.assemble(mockBundle)` → write PDF blob to `download.pdf` → open in PDF viewer → eyeball cover + spreads + name overlays.

---

## Done criteria
- ✅ All files created.
- ✅ ≥45 vitest tests green.
- ✅ Manual PDF inspection: cover renders, spreads render, name baked in, no PII in metadata.
- ✅ Lulu spec validator catches 10+ rejection cases.
- ✅ `BookAssembler` documents itself as the ONLY name-touching service.
- ✅ implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 5 — codex hand-crafts edge-case PDFs to trip the validator
- `/codex:adversarial-review` after Phase 9 — codex pretends to be Lulu, rejects our PDF, we fix
- `/codex:rescue` on > 20min stuck

## Implementation-notes.md must document
- Why `pdf-lib` vs alternatives
- CMYK conversion strategy (canvas always renders RGB — how we convert at PDF generation)
- Bleed mark placement formula
- Spine width formula tuning per format (Lulu actual page-thickness measurements)
- ePub3 schema choices
- Shortcode generation + collision handling

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-book-assembler -b feat/storybook-workshop-book-assembler origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
