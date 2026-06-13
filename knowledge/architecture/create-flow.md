---
type: Flow
title: Workshop Create Flow (7-Station UX)
description: The "New Hero" wizard — KidPicker then 7 ordered stations that collect all inputs needed to generate a personalised picture book.
tags: [workshop, stations, orchestrator, ux-flow]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/workshop/
status: production
---

# Overview

The workshop is a **forward-only state machine** gated by `WorkshopOrchestrator`. A parent selects or creates a `KidProfile`, then walks seven stations. Each station writes to `draft.outputs.sN`. `advance()` is blocked until `isStationSatisfied(station, outputs)` returns `true`.

Stores: `currentOrchestrator` (Writable), `draftStore` (derived), `currentStation` (derived) — all in `src/lib/workshop/stores.ts`. Draft persisted to IndexedDB via [WorkshopDraftStore](/architecture/services/WorkshopDraftStore.md); kid persisted via [KidProfileStore](/architecture/services/KidProfileStore.md). TTL 30 days (`DRAFT_TTL_MS`).

---

# Station Order

```
STATION_ORDER = [
  'kid-picker', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 'library'
]
```

## KidPicker — `src/lib/workshop/stations/KidPicker.svelte`

Create or select a `KidProfile`. Required fields: `name`, `birthdayIso` (YYYY-MM-DD → derives `ageBand`), `oneLineAbout`. Profile written via `KidProfileStore`. Satisfied by construction (selecting a kid unlocks `s1`).

## Station 1 — ChooseStory `src/lib/workshop/stations/Station1ChooseStory.svelte`

Collects `Station1Output`:

| Field | Options |
|---|---|
| `theme` | 12 themes: `bedtime` `first-day` `lost-and-found` `overcoming-fear` `new-baby-arrives` `kindness` `adventure` `curiosity` `friendship` `sibling-rivalry` `saying-goodbye` `silly-quest` |
| `occasion` | `birthday` \| `holiday` \| `gift` \| `just-because` |
| `lengthTier` | `bedtime`=8sp \| `standard`=12sp \| `adventure`=16sp \| `saga`=24sp (via `LENGTH_TIER_SPREADS`) |
| `targetSpreads` | derived from `lengthTier` |
| `ehriPhase` | `pre-alphabetic` \| `partial-alphabetic` \| `full-alphabetic` \| `consolidated-alphabetic` |

Satisfied when `outputs.s1.targetSpreads > 0`.

## Station 2 — ForgeHero `src/lib/workshop/stations/Station2ForgeHero.svelte`

Collects `Station2Output`: `pillarId` (opaque string). Displays a grid of **150 CLIP archetypes** fetched from `PillarManifestClient` (`fetchManifest()`). Falls back to 8 gradient swatches when both primary and placeholder manifests are unavailable.

Satisfied when `outputs.s2.pillarId` truthy.

See [Pillar Library](/architecture/pillar-library.md) for manifest format and CLIP archetype details.

## Station 3 — WishMoment `src/lib/workshop/stations/Station3WishMoment.svelte`

Collects `Station3Output`: `dedicationText` (required), optional `voiceClipBlobUrl` (local only, never uploaded), optional `templateId`. Satisfied when `dedicationText.trim().length > 0`.

## Station 4 — NameCast `src/lib/workshop/stations/Station4NameCast.svelte`

Collects `Station4Output`:

- `heroName` — the protagonist name (overrides kid's real name in story text)
- `sidekickSettlerId` — selects a settler archetype (`ada` / `rumi` / `jules` / `nico` etc.) mapped to fictional name at pipeline time by `fictionalSidekickName()`
- `supportingCast` — array of `SupportingCastEntry`
- `localeBiome` — story setting biome

Satisfied when `heroName` non-empty AND `sidekickSettlerId` non-empty.

## Station 5 — DressStory `src/lib/workshop/stations/Station5DressStory.svelte`

Collects `Station5Output`:

| Field | Options |
|---|---|
| `artStyle` (as `StyleSelectionId`) | `octopath-hd2d` \| `flat-painted` \| `pixel-pure` |
| `authorByline` | optional string |
| `dialogicPromptsEnabled` | bool (default true) |
| `easierReadingMode` | bool (default false) |

Style packs loaded via `listStylePacks()` from `$lib/services/stylepacks`. See [Style Packs](/architecture/style-packs.md) for pack definitions and render implications.

Satisfied when `outputs.s5.artStyle` truthy.

## Station 6 — Seal `src/lib/workshop/stations/Station6Seal.svelte`

Runs the full generation pipeline: calls `runWorkshopPipeline(draft, opts)`. Progress emitted via `onProgress` callback. On success writes `Station6Output`: `{ bookShortcode, pdfBlobSize, pdfHash, consent }`. The `ConsentRecord` requires `reviewedSpreads: true` AND `understandsNonRefundable: true` before advance is allowed.

See [Book Pipeline](/architecture/book-pipeline.md) for pipeline internals.

## Station 7 — TakeHome `src/lib/workshop/stations/Station7TakeHome.svelte`

Terminal UX. Two paths:

1. **Free digital** — `pdfBlob` downloaded + `epubBlob` downloadable. No payment.
2. **Print order** — Stripe payment intent → Lulu POD fulfillment. Phases: `choose → address → quote → pay → paying → success | error`. Uses `StripeElementsLoader` + `stripeElementsGate.ts` (`decideStripePath`, `handlePaymentIntentResult`, `pollAfter3DS`).

Always terminal (`isStationSatisfied('s7') === true` unconditionally). After success, orchestrator can navigate to `library`.

See [Fulfillment Order](/architecture/fulfillment-order.md) for the Lulu+Stripe pipeline.

---

# Orchestration

`WorkshopOrchestrator` (src/lib/workshop/services/WorkshopOrchestrator.ts):

- `advance()` — increments station index; throws `WorkshopAdvanceError` if not satisfied or already at terminal
- `back()` — decrements; throws `WorkshopNavError` at index 0
- `jumpBackTo(target)` — back-jumps only; forward jumps throw
- `saveOutput(key, value)` — persists partial station output to IDB via `WorkshopDraftStore.update()`

Advanced mode (`AdvancedModeOrchestrator`, `src/lib/workshop/advanced/`) adds interstitial stations 1.5, 3.5, 5.5 for pedagogy overrides, wish engineering, and render direction — gated behind `AdvancedModeToggle`.

---

# Related Concepts

- [Book Pipeline](/architecture/book-pipeline.md) — what Station 6 triggers
- [Fulfillment Order](/architecture/fulfillment-order.md) — Station 7 print path
- [Pillar Library](/architecture/pillar-library.md) — Station 2 archetype source
- [Style Packs](/architecture/style-packs.md) — Station 5 art style definitions
