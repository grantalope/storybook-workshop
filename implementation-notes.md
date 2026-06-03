# Implementation Notes — UI Shell (feat/ui-shell)

## Goal
Implement `docs/goals/2026-05-24-ui-shell.md` end-to-end in the standalone
`storybook-workshop` repo. MVP: all 7 stations functional, draft persistence,
kid roster, consent gate, mocked WB scene render, free-digital PDF download.

## Design decisions

### Orchestrator state machine vs free-form
Linear forward-only state machine (`kid-picker | s1..s7 | library`) with
back-arrow navigation. Forbidding forward skips guarantees draft invariants
before each station receives its inputs (e.g. Station 6 generation requires
theme + pillarId + cast all populated). Back-arrow is allowed because the
shape pattern matches Build-a-Bear "rethink the heart" affordance — UX
quality.

### IDB schema versioning
Two stores via `IdbKeyValueStore` (reuses Advanced-Mode infra):
- `storybook-workshop-drafts-v1` (workshop drafts, TTL 30 days)
- `storybook-workshop-kids-v1`  (parent kid roster, no TTL)
Versioned in the DB name suffix; a future schema break ships `-v2` and a
one-shot migration helper. No bump needed for MVP.

### Path lift vs goal spec
Original goal calls for `src/routes/dashboard/storybook-workshop/...`. In the
extracted repo the dashboard subroute lift was already applied — actual route
files live in `src/routes/` (workshop root) and `src/routes/library/`. Building-block
services live in `src/lib/workshop/services/` and components in
`src/lib/workshop/components/` + `src/lib/workshop/stations/`.

### LLM path
`storyAuthorService.author` will hit `inferenceClient` → kernel.connect →
LLR fallback. No kernel here, no LLR backend wired → 2 retries fail →
deterministic `templateFallback.ts` synthesizes a Pixar-7-beat skeleton.
That's the MVP path. Tests pass `forceTemplate: true`.

### Pillar library
No real CLIP / pillar grid yet. Station 2 ships:
- Photo capture button (placeholder; pillarVectorizerService not wired since
  WASM/CDN fetch isn't suitable for headless tests).
- Manual "pick from grid" with 8 hardcoded placeholder pillars (deterministic
  gradient colors via CSS conic-gradient).

### Mocked scene render
Station 6 doesn't call real WB API. `mockSceneRenderService.renderScene()`
returns a 1×1 placeholder PNG Blob per scene. Real HD-2D adapter is goal #12.

### Free-Digital vs Order-Print at Station 7
Free-Digital: triggers `URL.createObjectURL` + anchor click on the PDF blob.
Order-Print: opens modal explaining fulfillment service is in flight.

### Cascade-delete
KidProfileStore.deleteKid(kidId) iterates drafts, removes any with that
kidId, then removes the kid record. One transaction per record (IDB KV
helper doesn't expose batch atomicity; acceptable for parent-side ops).

## Deviations from goal
- E2E Playwright: stubbed with test.skip() — needs more infra (real browser,
  WB upstream stack). Documented in commit msg.
- Settler banter / WorkshopBackdrop / WalkTransition / SealAnimation: shipped
  as plain Svelte components, no PreText effect/animation polish (MVP — real
  animations land with HD-2D adapter goal).
- Ehri assessment: simple radiogroup, not modal (MVP UX).
- Pillar match ceremony: skipped (always manual grid).
- Library `/storybook-workshop/preview/{shortcode}` public route: deferred
  (covered by marketing-funnel goal #11).

## Tradeoffs
- Tests focus on stores + orchestrator + station-flow integration (state-only
  contract), not Svelte rendering. Faster iteration; Playwright fills the
  visual-render gap once it ships.
- Single ConsentGate component rather than spec's split-modal. Less code,
  same legal coverage.

## Open questions
- [?] Lulu-spec validator currently runs in `BookAssembler.assemble` —
  Station 6 mock skipValidation: true to avoid CMYK assertion failure on
  the 1×1 placeholder PNG. Confirms with goal #8 wiring later.
- [?] KidProfileStore stores `birthday` ISO string; age computed at read
  time. OK for MVP, will need DOB-edit affordance in Phase B.

## Surprises
- IdbKeyValueStore already lives in `workshop/advanced/services/` — reused
  directly. No new infra needed.
- Existing `kidsContentSafetyService` reachable via direct import (no
  kernel needed), and exposes `.scan(text)` synchronously fallback-stub-friendly.

---

# Fulfillment phase (feat/fulfillment, 2026-06-03)

## Design decisions

- **Path adjustment**: standalone-repo paths used — services under
  `src/lib/services/fulfillment/`, API routes under
  `src/routes/api/{order,lulu-webhook,stripe-webhook,shipping-quote,quality-claim}/`,
  tests under `tests/fulfillment/`. Goal-doc paths (which assumed pachinko monorepo)
  re-mapped accordingly. No `storybook-workshop/` prefix on API routes.
- **No new runtime deps.** Stripe + Lulu access via injectable HTTP client
  interface, default impl is `fetch`. HMAC verification uses node:crypto
  (Web Crypto API in browser).
- **Injectable boundaries**: every external integration sits behind a typed
  interface; tests use in-memory mocks. Production wiring picks default
  fetch-based impls reading env (`LULU_CLIENT_ID`, `LULU_CLIENT_SECRET`,
  `LULU_API_BASE`, `LULU_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`). Documented in `fulfillment/types.ts`.
- **OAuth2 token cache**: module-scoped variable in default Lulu HTTP impl.
  Refresh on `expires_at - 60s`. Survives across requests in same process.
- **Order persistence**: injectable `OrderStore` interface; default impl is
  in-memory `Map` for browser+test parity. Server-side production swap to
  Postgres/SQLite is a follow-up (out of MVP scope per goal). Tests inject
  the same in-memory store.
- **Stripe Tax**: PaymentIntent carries `automatic_tax: { enabled: true }`
  + `customer_details.address` from shipping address. Stripe handles US
  sales-tax + EU VAT.
- **Webhook signature verification**:
  - Lulu: HMAC-SHA256 over raw body, header `Lulu-Signature: sha256=<hex>`,
    constant-time compare.
  - Stripe: simplified `t=...,v1=...` parse + HMAC-SHA256 over `${t}.${body}`
    (matches `stripe.webhooks.constructEvent` algorithm without pulling in
    the `stripe` package).
- **Cancel window**: 75 min default; configurable per env. Window measured
  from `submitted_to_lulu` transition timestamp.
- **Reprint reserve**: tracked in audit log only; ops dashboard accounting
  is out of MVP scope.
- **Transactional email**: `TransactionalEmailProvider` interface; default
  is `NoopEmailProvider` (test mode). `ResendEmailProvider` and
  `PostmarkEmailProvider` are sketched as constructor-only stubs;
  real wire-up is goal #11 marketing-funnel territory.

## Deviations

- Goal-doc paths re-mapped to standalone repo (see Design decisions).
- Real Stripe Elements lazy-load deferred — v1 Station 7 UI uses a
  test-mode card form that posts `{cardLast4: '4242'}` and the server
  StripeCheckoutService creates a mock PaymentIntent via the injected
  provider. Real Elements integration is v2 (one Svelte component swap;
  documented in PR body).
- Real Resend/Postmark email provider deferred (no-op default).
- Reprint cost-vs-reserve accounting: tracked-only (no ops dashboard).
- Ops dashboard for pending QualityClaims: deferred (claims persist in
  order store, surfaced via /api/quality-claim GET — TODO).
- Real Lulu sandbox E2E: not run from agent session (no sandbox creds
  available). Documented in PR body for manual smoke pre-launch.

## Open questions
- [?] Production OrderStore choice (SQLite vs Postgres) — defer to ops
  goal alongside subscription persistence.
- [?] Reissue API endpoint shape on Lulu Direct — used `POST /print-jobs/{id}/reissue/`
  per docs; if it changes during sandbox testing, swap in LuluHttpClient.

## Surprises
- Subscription service already shipped a clean PaymentProvider interface +
  mock pattern; fulfillment Stripe service mirrors that pattern exactly.
- LuluPdfSpecValidator already exists from book-assembler and returns a
  rich ValidationReport — `/api/order` POST reuses it directly.


---

# Production-hardening phase (feat/production-hardening, 2026-06-03)

## Design decisions

- **Module placement**: `src/lib/env/production-config.ts`. New `env/`
  directory under `src/lib/` because the contract is a runtime-env concern,
  not service logic. CLAUDE.md layout updated to reflect.
- **Three-tier finding model**: `fatal` (throws — server refuses to start) vs
  `warn` (logs + continues) vs silent-pass. Codes are stable
  machine-readable strings (`dev_bypass_in_production`, `missing_stripe_secret`,
  etc.) so ops dashboards can pattern-match. The discriminant lives on
  the finding itself (`level: "fatal" | "warn"`) so future migration to
  pure-record (no-throw) APIs is straightforward.
- **Boot-time, not request-time**: called from `hooks.server.ts handle`
  guarded by a module-scope `_validatedOnce` latch — runs exactly once
  per process, on the first request. Idempotent + cheap if called again
  (no IO, just object reads).
- **Webhook secrets are WARN, not FATAL**: some deploys terminate webhook
  verification at an upstream reverse proxy or webhook relay, so refusing
  to start would be over-restrictive. Warned + documented in
  `production-deploy.md` operational notes.
- **Whitespace-only secrets are treated as unset**: `nonEmpty()` does a
  `.trim().length > 0` check so a deploy that accidentally sets
  `STRIPE_SECRET_KEY=" "` (e.g. from a YAML quoting accident) gets
  caught.
- **Empty/undefined NODE_ENV is treated as non-production** (skip all
  gates) — protects local `vite dev` / `vitest` from spurious throws.
  Production deploys must explicitly set `NODE_ENV=production`.
- **Injectable warn sink**: `EnsureProductionConfigOpts.warn` lets tests
  capture warns deterministically rather than spying on `console.warn`.
  Default is `console.warn`.
- **Test-only escape hatches** (`_markValidated`, `_resetValidationLatch`)
  are exported with underscore prefix per the existing repo convention
  (see `__setOrderApiDeps` in fulfillment).

## Deviations

- ADR-0044 was referenced in the SETUP but the file doesn't exist on
  origin/main (the latest committed adrs are 0042 + 0043). No ADR file
  was created — the design is captured in `production-deploy.md` +
  CLAUDE.md production-deploy-contract section instead.
- `RESEND_API_KEY` warn only (not fatal) per the goal scope — the spec
  treats email delivery as degraded-mode acceptable for v1 launch.

## Tradeoffs

- Aggregating multiple fatal findings into one `ProductionConfigError`
  rather than throwing on the first — gives the operator a full list to
  fix in one pass. Cost: slightly longer error message.
- Module-scope latch state rather than per-`Kernel` / per-Locals binding.
  Acceptable for a singleton-style boot gate; trivially mockable via
  `_resetValidationLatch()` in tests.

## Open questions
- [?] Should `STRIPE_WEBHOOK_SECRET` / `LULU_WEBHOOK_SECRET` be promoted
  to fatal once the marketing-funnel goal lands real Resend wiring?
  Probably yes — once webhooks are real, missing-secret means real
  customer impact. Deferred — track in the next deploy-contract review.
- [?] Production session-auth wiring (cookie JWT vs Auth0 vs Clerk vs
  Supabase) — recipes shipped in `docs/production-deploy.md` §4; pick
  one before flipping to real production traffic.

## Surprises
- The existing `hooks.server.ts` already had a clean `resolveParentEmail`
  helper documenting the bypass story end-to-end. Wiring
  `ensureProductionConfig` on top of it was one import + one if-block.
- `svelte-check` baseline on origin/main shows 96 errors / 22 warnings
  pre-existing (most in `kernel-contracts/helpers/` + `routes/series/`)
  — production-hardening adds 0 new errors. Verified.
