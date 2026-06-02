# ADR-0043 — Storybook Workshop Privacy Posture: On-Device CLIP + Opaque Pillar IDs

**Date:** 2026-05-24
**Status:** Accepted

## Situation
Personalized children's-book competitors (Magic Story, Lullaby, Wonderbly post-PRH) all upload the child's photo to their cloud + run server-side diffusion to generate a likeness. This is the dominant industry approach. We want a defensible privacy moat: kid's photo, name, and address never enter our content-generation pipeline.

## Decision
1. **Pre-rendered pillar library** — 5,000 archetypal kid avatars × 12 styles ≈ 60,000 images, hosted upstream at World Builder CDN. Generic, public, no PII attached. Pre-launch deliverable.
2. **On-device WASM CLIP vectorizer** — `Xenova/clip-vit-base-patch32` via `@xenova/transformers` 2.17.2 CDN load (per Vite gotcha). 512-dim embedding computed locally. Photo deleted from memory + IDB after single forward pass.
3. **Local pillar matching** — cosine similarity computed client-side against the pre-fetched pillar manifest (~5 MB JSON). Only the opaque integer `pillarId` ever leaves the device.
4. **Fallback path** (low-end devices where WASM fails) — explicit one-shot consent → POST photo to `/api/storybook-workshop/vectorize` → server-side CLIP → vector returned → photo discarded synchronously. Endpoint: stateless, rate-limited, no logging beyond aggregate counter, TLS only. Fully disclosed pre-consent.
5. **Name composited locally at PDF-assembly time** — kid's name overlays the World-Builder-rendered PNGs in `BookAssembler`. Name never crosses any API boundary except into the final Lulu print job (purpose: `book_fulfillment`).
6. **Address only at Lulu checkout** — `book_fulfillment` purpose is the only one authorized to carry name+address; ephemeral, server-side, never persisted beyond order lifecycle.

## Why
Three layered benefits:
- **Defensible marketing moat:** "Your kid's photo, name, and address never leave your device" — verifiable in the network tab. Magic Story's privacy promise is "we delete after render"; ours is "it never gets sent in the first place."
- **Scalable economics:** no per-user GPU inference cost for likeness generation. Pillar library is generated once offline, rendered as 60k cacheable assets. Cost scales with content, not users.
- **COPPA-K + GDPR-K safe by construction:** photo doesn't enter our data-processing scope on the happy path, eliminating the largest single area of regulatory risk in this category.

## Consequences
- Kid's avatar in the book is "archetype matched," not "photorealistic." Disclosed pre-purchase; preview shows the matched pillar before charging.
- Pillar library must be richly diverse (hair / skin / eye / age / clothing-vibe / extras axes) to feel personal. 5,000 archetypes is the v1 target — extensible.
- The fallback `/api/storybook-workshop/vectorize` endpoint is a regulated surface. Hardening: stateless, rate-limited, no logging beyond aggregate counters, synchronous photo discard post-CLIP, TLS, no auth headers (anonymous). Tested as part of goal `storybook-workshop-pillar-vectorizer`.
- Every workshop service touching kid metadata must respect the purpose taxonomy: photo = `kid_photo_local` / `kid_photo_vectorize_fallback`, name + address = `book_fulfillment`, embedding = `kid_embedding_local`, scene brief = `scene_render`. Enforced via kernel `purpose.check` allowlist (extended in goal `storybook-workshop-kids-content-safety`).

## See also
- Spec: `docs/superpowers/specs/2026-05-24-storybook-workshop-design.md` §4
- ADR-0042 — product-branch architecture
- Existing PrivacyFilterService — pattern reuse
