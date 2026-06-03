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

# Stripe Elements phase (feat/stripe-elements-real, 2026-06-03)

## Design decisions

- **Lazy-load from canonical CDN.** `StripeElementsLoader.loadStripe()` injects
  `<script src="https://js.stripe.com/v3/">` on demand the first time a
  caller asks for a Stripe instance. Stripe's TOS + PCI posture forbids
  bundling/self-hosting the SDK; SRI is also explicitly disallowed because
  Stripe updates the hosted script in-place for live fraud + 3DS layers.
  We set `crossOrigin='anonymous'` and rely on HTTPS + Stripe-controlled
  delivery for trust — documented inline in the loader with a SECURITY NOTE.
- **Test seam: `__setStripeFactory()`.** Tests inject a synthetic factory
  that returns a fake `StripeInstance`; the loader short-circuits the DOM
  script-injection path. `__resetStripeLoader()` clears the module
  singletons + override between tests. Production code never calls these.
- **Caching.** Per-publishable-key cache for the `StripeInstance` so
  re-mounting Station 7 (back-arrow, HMR, retries) doesn't allocate a
  second Stripe instance. Script-injection promise is module-scoped and
  re-used across all keys.
- **Activation gate.** Station 7 reads `readPublishableKey()` (which in
  production is wired to `/static/public.PUBLIC_STRIPE_PUBLISHABLE_KEY`).
  Empty key OR `devMode=true` prop → fall through to the legacy test-mode
  "type 4242 4242 4242 4242" form. This keeps the dev/test path frictionless
  while the production build flips to real Elements automatically when the
  env var is set.
- **`confirmCardPayment` is client-only by Stripe design.** The secret key
  never leaves the server; the publishable key + clientSecret + card-iframe
  stay in the browser. We never see the raw card number — Stripe Elements
  owns the iframe.
- **Server-side verification on `{action:'confirm'}`.** The new POST
  `/api/order/[id]` action does NOT trust the client claim that the
  PaymentIntent succeeded — it re-fetches the PI from Stripe and only
  transitions `pending_payment → paid` when Stripe itself reports
  `succeeded`. This makes the client confirmation a UX accelerator (parent
  sees "paid" immediately rather than waiting for the webhook), not an
  authority. The webhook handler is unchanged and still the canonical
  long-term source of truth.
- **Idempotency with the webhook.** If the webhook lands first and flips
  the order to `paid` before the client confirm POST arrives, `{action:
  'confirm'}` returns `200 { state:'paid', idempotent:true }` rather than
  re-transitioning (lifecycle would throw `paid → paid` as illegal). Both
  paths converge on the same terminal state.
- **No `@stripe/stripe-js` runtime dep added.** Loader carries minimal
  inline TypeScript types for the v3 surface we use (Stripe, Elements,
  CardElement, PaymentIntent result). Adding the npm package would
  duplicate the CDN script for no value.

## Deviations
- E2E test of the full Stripe Elements mount + iframe interaction is
  deferred (requires Playwright with network access to `js.stripe.com` +
  Stripe test-mode account). Tests cover the loader contract (override +
  caching + null fallback) and the server-side confirm endpoint — the two
  surfaces that aren't owned by Stripe.
- `readPublishableKey()` reads `globalThis.__PUBLIC_STRIPE_PUBLISHABLE_KEY__`
  rather than `import.meta.env.PUBLIC_STRIPE_PUBLISHABLE_KEY` directly so
  the loader stays importable from vitest (where the `` alias is not
  resolvable). Production wiring sets the global in `hooks.client.ts` or
  the app shell before any Station 7 instance is constructed; tracked as a
  v2 ergonomic-only follow-up to plug straight into `$env/static/public`.

## Open questions
- [?] Wallet methods (Apple Pay / Google Pay): Stripe Elements supports
  PaymentRequestButton via the same SDK; should ship in a follow-up once
  domain verification is set up.
- [?] 3DS challenge flow: `confirmCardPayment` can return
  `requires_action` and Stripe.js handles the redirect/challenge inline.
  Our handler treats `paymentIntent.status !== 'succeeded'` as an error
  for now; `requires_action` should be surfaced as "complete bank
  verification" rather than a generic error in v2.

## Surprises
- The existing `createMockStripe()` mock already returns a deterministic
  `getPaymentIntent` shape; tests for the confirm endpoint only need to
  override `status` on top of it.
- The existing Stripe webhook handler already implements the
  `payment_intent.succeeded → paid` transition with the SAME guard
  (`order.state !== 'pending_payment'` → ignored) — the new confirm
  action piggybacks on that guard, so both paths are race-safe by
  construction without any additional locking.
