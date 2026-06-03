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

# CRM-Resend phase (feat/crm-resend-provider, 2026-06-03)

## Design decisions

- **New dedicated file `src/lib/services/fulfillment/resend-provider.ts`**
  instead of growing the existing `TransactionalEmailProvider.ts` sketch.
  Resend is now the production primary transactional provider; it deserves
  its own module with retry, audit, body templating, and CAN-SPAM unsubscribe
  rendering. The legacy `TransactionalEmailProvider.ts` keeps the Noop +
  Logging + Postmark sketch implementations; the old Resend constructor-only
  sketch is REMOVED to avoid two divergent Resend classes coexisting (per
  Rule 10: no v2 / parallel modules).
- **`buildEmailHandlersFromProvider(provider)`** factory builds a
  `LifecycleHandlers` object wiring `onPaid` / `onInProduction` / `onShipped`
  / `onDelivered` / `onFailed` / `onTerminalError`. Spec §5.7 names the 5
  customer-facing emails (paid / printed / shipped / delivered / failed);
  `onTerminalError` reuses the `failed` template (terminal Lulu failure is
  customer-facing in the same way). `onSubmitted` is NOT wired — internal
  state transition, not user-relevant. Per-handler send errors are caught +
  logged so a flaky vendor never blocks a state transition (the audit log
  has the receipt; ops follows up).
- **Injectable boundaries**: `fetchImpl`, `auditSink`, `nowSource`, `sleep`,
  `maxAttempts`, `baseBackoffMs`. Same shape the rest of fulfillment uses
  (StripeHttpClient / LuluHttpClient pattern). Tests pass mocks; production
  defaults to `globalThis.fetch` + console-logging audit sink.
- **Retry on 5xx ≤ 3 attempts** with exponential backoff
  (`base × 2^(attempt-1)`, default base 250ms). 4xx is audit-and-bail
  immediately — server has rejected; spinning trips rate limits.
- **Audit sink** records every call outcome (`sent` / `rejected_4xx` /
  `failed_5xx` / `network_error`) so OrderAuditService can capture the
  receipt without coupling the provider to that service directly. Audit
  sink failures are swallowed (must NOT crash the send pipeline).
- **`ResendSendError`** named error with `kind` (`rejected_4xx` /
  `failed_5xx` / `network_error`), `attempts`, `httpStatus`, `cause`. Lets
  callers branch on failure category instead of regex-parsing the message.
- **CAN-SPAM compliance**: unsubscribe footer rendered in BOTH plain-text
  and HTML bodies; `List-Unsubscribe` + `List-Unsubscribe-Post:
  List-Unsubscribe=One-Click` headers per RFC 8058. `unsubscribeBaseUrl`
  is REQUIRED at construction — refuses to build a provider that can ship
  non-compliant email.
- **Body templating**: HTML uses inline styles (max-width 560 px, system
  font stack, line-height 1.45) so it renders reasonably in every major
  mail client without external CSS. Subjects are short, ≤ 60 chars,
  free of marketing punctuation. `htmlBodyFor` / `textBodyFor` are exported
  for direct visual regression testing.
- **Boot warning in `hooks.server.ts`**: `assertResendKeyOrBootWarn` runs
  at module init (not per-request) so the warning lands once at server
  startup. Skip-logic respects `VITEST`/`NODE_ENV=test` so unit tests don't
  spam the console, and `STORYBOOK_SKIP_RESEND_BOOT_CHECK=1` is a documented
  opt-out for ops who already know. Returns a typed `ResendBootCheck` so
  tests can assert without intercepting console.

## Deviations

- **Did NOT modify `OrderApiDeps` in `/api/order/+server.ts`** to pre-wire
  `buildEmailHandlersFromProvider` into the default `OrderLifecycleService`.
  Reason: the default deps factory uses `InMemoryOrderStore` + mock Stripe
  for tests; adding a Resend client to that default would either fail
  silently (no API key in test env) or invent a no-op stub that defeats the
  goal. Production wiring is documented via `buildEmailHandlersFromProvider`
  + `__setOrderApiDeps`; tests cover the end-to-end lifecycle path through
  a constructed lifecycle service. Bigger CRM marketing-funnel goal (#11)
  will own the production `__setOrderApiDeps` call site.
- Real Resend sandbox E2E not run from this session (no sandbox account
  configured for the worker). Documented in PR body for manual smoke
  pre-launch.

## Tradeoffs

- Body templates are static strings, not Handlebars / mjml — keeps the
  dep footprint at zero, but means richer styling (header image, brand
  colors beyond `#222`) is a follow-up. The unsubscribe footer + tracking
  link are the load-bearing bits and they're there.
- Audit sink is a plain callback, not an EventEmitter or kernel-purpose
  hook. Matches the rest of fulfillment's "inject a function" boundary
  style; OrderAuditService can wrap it from the production wiring layer.

## Open questions

- [?] `from` address format — spec doesn't fix one. Tests use
  `Storybook Workshop <hello@storybook.example>` (RFC-5322 display name).
  Production should swap to the verified domain.
- [?] Whether to surface `ResendSendError` to the parent in any UI path.
  Currently the OrderLifecycle handlers swallow + log; ops sees the audit
  trail. Marketing-funnel goal can revisit if customer-visible "we tried
  to email you" status proves valuable.

## Surprises

- The existing `TransactionalEmailProvider.ts` had a constructor-only
  Resend sketch and a Postmark sketch side-by-side. Deleted the Resend
  sketch and kept Postmark (still spec-named as the secondary provider in
  §8.7). The `index.ts` barrel re-exports the new `ResendEmailProvider`
  from `./resend-provider`, so consumer import paths stay stable.
- `LifecycleHandlers` was not exported from the fulfillment barrel —
  added a `export type { LifecycleHandlers }` line so the factory's
  return type is consumable downstream without reaching into the file.

## Tests

- `tests/fulfillment/resend-email-provider.test.ts` — 23 tests, all green:
  - Construction guards (apiKey / from / unsubscribeBaseUrl required)
  - POST shape (URL, Bearer auth, JSON body, all 6 event subjects, headers,
    tags, reply-to default + override, unsubscribeBaseUrl trailing slash trim)
  - Plain-text + HTML body templates include unsubscribe footer for every
    event name
  - 5xx retry: succeed on attempt 2; cap at maxAttempts; exponential
    backoff sleep delays
  - Network error retry: capped at maxAttempts, audits `network_error`
  - `ResendSendError` exposes `kind`/`attempts`/`httpStatus`
  - 4xx no-retry: single attempt, audit `rejected_4xx`, no backoff sleep
  - Audit-sink failure does NOT crash the send pipeline
  - Empty `msg.to` rejects fast
  - `buildEmailHandlersFromProvider` wires lifecycle transitions
    (paid/in_production/shipped/delivered, NOT submitted_to_lulu) and
    end-to-end through a real ResendEmailProvider hits fetch with
    `X-Email-Event: paid`
  - Per-handler send errors don't block lifecycle transitions; logger sees
    the failure
  - `assertResendKeyOrBootWarn` covers test-env skip, explicit skip,
    key-present, missing-in-prod (loud), missing-in-dev (hint)

Full suite: 706/706 green (683 baseline + 23 new). svelte-check: 96/96
baseline errors, 0 NEW.
