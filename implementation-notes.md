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


# Marketing-funnel phase (feat/marketing-funnel, 2026-06-03)

## Goal

Implement docs/goals/2026-05-24-marketing-funnel.md end-to-end:
email-gated digital preview (HMAC cookie), 7-stop lifecycle scheduler
per spec §8.2, abandoned-cart recovery chain with escalating promos,
grandparent-referral viral loop with $5 credit, weekly educational
drip with 24 research-cited entries covering 10 evidence knobs, per-bucket
GDPR-clean unsubscribe, promo codes (first-time / abandoned-cart /
birthday / series-discount), CrmClient interface with Resend default +
Postmark drop-in + Mock for tests, public read-along route gated past
spread 4, marketing pages (landing + research + privacy).

## Design decisions

### CRM provider choice
Resend selected as the default production provider. Reasons: (1) lighter
HTTP API than Postmark, (2) modern dev ergonomics, (3) Vercel-native.
PostmarkCrmProvider ships as a drop-in alternative behind the same
CrmClient interface. Selection at runtime: RESEND_API_KEY env present ->
Resend; POSTMARK_SERVER_TOKEN -> Postmark; neither -> MockCrmClient
(tests + dev). No SDK dependency added — raw fetch keeps the
boundary mockable.

### CrmClient interface shape
Single `send({ template, to, vars, tags })` method. Provider-agnostic;
the marketing services (LifecycleEmailService etc.) never see vendor-
specific shapes. Tests inject MockCrmClient which captures every call
to an in-memory ring buffer.

### Lifecycle scheduler implementation
In-app pull-based (not cron-side timing) because:
1. CRM providers' scheduling features are vendor-specific and lock-in.
2. We need to terminate on user state changes (paid_print, unsubscribed)
   which the CRM doesn't know about.
3. The same tick() can be called from a Vercel cron (HTTP POST), a
   GitHub Actions cron, or a manual ops trigger — uniform interface.

Idempotency is enforced via per-template last-send sentinel on the
CrmContact. The sentinel is a TIMESTAMP not a boolean — but the
check uses `!== undefined` so that a T=0 timestamp doesn't read as
"not yet sent". (Caught by the lifecycle test suite during initial
implementation.)

### Cookie signing scheme
HMAC-SHA256 over `{email.toLowerCase()}:{shortcode}`, hex-encoded then
truncated to 32 chars (128 bits — plenty against guessing). Secret
comes from STORYBOOK_EMAIL_GATE_SECRET env; if missing in dev/test we
fall back to a deterministic constant (loud warn in production paths
should be added when ops wires this in).

Cookie name is per-shortcode: `swEmailGate_<shortcode>`. This binds
the cookie to the unlocked shortcode so a single email can't unlock
arbitrary other shortcodes. Cookie is HttpOnly + SameSite=Lax with
30-day Max-Age.

### Abandoned cart key
`{parentEmail.lowerCase()}::{kidId}` — different kids have independent
recovery chains. Re-tracking the same key within 5 minutes is treated
as the same browser session (preserves the original abandonedAt so the
T+1h email doesn't restart).

### Promo code accounting
NOT Stripe coupons — we own the validation surface so the same code
works at PaymentIntent-time AND for in-flight checkout previews.
Stripe-coupon-mirror could be added later via a webhook subscriber if
we want native Stripe receipts to show the discount, but the v1 ledger
is in-process (matches the InMemoryOrderStore pattern from fulfillment).

Single-promo-per-order enforced via a Map<orderId, codeApplied>. Re-
applying the same code to the same orderId is a no-op. Applying a
different code rejects with `already_used_in_order`. The first-time
code BEDTIME10 is a SHARED code across all parents (anyone can type it)
but limited to ONE redemption per parent (tracked via a separate
`_firstTimeRedeemed` set keyed on email).

### Promo code generation
CSPRNG-derived (`secureRandomString` from `$lib/services/subscription/secureRandom`)
over alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (30 chars, no
ambiguous 0/O/1/l/I). 10 chars = ~49 bits entropy. Collision-loop
caps at 100 attempts.

### Educational drip rotation logic
Per-parent cursor stored in PerParentCursor. `nextIndex` mod
catalogSize. On send, cursor.nextIndex = (cursor.nextIndex + 1) % size.
This deterministically rotates through all 24 entries before any
repeats. cadenceMs default 7 days; `lastSentAt` gate prevents same-week
double-sends.

The catalog covers all 10 evidence knobs from spec §7.1, with multiple
entries per knob (some knobs have 3 entries — e.g. personalized_hero
gets Symons 1997, Rogers 1977, Bandura 1986 — for variety across the
rotation).

### Referral attribution split
We have TWO referral services in the codebase now:
- `services/subscription/ReferralAttribution` — owns the gift-flow
  conversion path (grandparent buys a subscription via a referral link).
- `services/marketing/ReferralLinkService` — owns the marketing-side
  share-link surface (every read-along link is a referral source;
  conversion to a print purchase awards $5).

They use the same $5 credit constant (REFERRAL_CREDIT_CENTS=500) but
different storage. A production unification could collapse them, but
the split mirrors the goal split (#9 subscription vs #11 marketing) and
keeps the test surface focused.

### Marketing pages path
Spec calls for `<product>.com/` to be the marketing landing. But `/`
in the standalone repo is the workshop entry. To avoid the conflict,
landing lives at `/marketing` with sub-routes at `/marketing/research`
and `/marketing/privacy`. The standalone repo can later either alias
`/` to `/marketing` via vercel.json, or split the marketing site into
its own SvelteKit app (planned Phase B per goal doc).

The public read-along is at `/r/[shortcode]/+page.svelte` (not under
`(marketing)` — it's the social-share surface and needs the cleanest URL).

### API endpoint conventions
All marketing endpoints under `/api/marketing/` for clean isolation:
- POST /api/marketing/email-gate -> set HMAC cookie + fire welcome
- POST /api/marketing/lifecycle-tick -> cron-triggered; CRON_SECRET auth
- POST /api/marketing/abandoned-cart-tick -> cron-triggered; CRON_SECRET auth
- GET  /api/marketing/referral/[shortcode] -> 302 with click recorded
- GET/POST /api/marketing/unsubscribe -> per-bucket opt-out
- POST /api/marketing/promo/[code] -> validate + apply (cross-called
  from /api/order POST in fulfillment)

Cron auth: optional `Bearer $CRON_SECRET` header. If env unset, open
(dev/test mode). Constant-time string compare on the secret.

Unknown-email on unsubscribe returns 200 + ok:false (NOT 404) to
prevent email-enumeration via the unsubscribe endpoint.

### Cross-deps
- `/api/order` POST (fulfillment) can cross-call
  `promoCodeService.validate()` / `.apply()` / `.redeem()` to enforce
  single-promo-per-order. The wiring point is intentionally NOT
  hard-coded into /api/order — that endpoint stays unchanged for this
  PR. Production wiring picks up promo codes via the order POST body
  carrying a `promoCode` field; that wiring can land in a follow-up
  without re-opening this PR.
- `birthdayCron` (subscription) can mint birthday promos by calling
  `promoCodeService.mintBirthdayPromo(parentEmail)`. Same pattern:
  the cross-call is available; the wiring is a follow-up.

## Deviations

- Marketing landing path moved from `/` to `/marketing` to avoid
  collision with the workshop root route (see above).
- Real Resend / Postmark SMTP credentials NOT exercised by the test
  suite — would require live keys. The fetch boundary is mocked.
- Playwright e2e (e2e/storybook-workshop-marketing-funnel.spec.ts) is
  out of scope for this commit cycle; the goal doc lists it as Phase 10
  but the standalone repo's e2e harness needs the Lulu/Stripe mock
  stack which is a separate goal. Vitest endpoint tests cover the
  HTTP surface.
- Birthday cron auto-fire wiring deferred — `mintBirthdayPromo` is
  exposed; cron-side trigger is a 1-line addition in
  `services/subscription/BirthdayCronService` and tracked as a
  follow-up.

## Tradeoffs

- In-memory stores everywhere (CrmContact map, abandoned-cart map,
  promo-code map, referral-shortcode map). Survives a single process
  lifetime; a server restart wipes state. Same tradeoff as fulfillment
  Phase. Production swap-in (Postgres / Redis) is a follow-up ops
  goal alongside subscription/fulfillment persistence.
- 24-entry educational catalog is a fixed in-app constant, not a
  CMS-loaded resource. Easier to ship today; harder for non-engineer
  ops to add new entries. Acceptable for v1; revisit once we have an
  advisory council suggesting entries (spec §8.6 Phase B).

## Open questions

- [?] Should the unsubscribe endpoint also one-click for
  `type=all`? Right now it requires three separate clicks (one per
  bucket). UX vs explicit consent tension.
- [?] Hardening: should the email-gate POST rate-limit by IP? Today
  any visitor can hammer the endpoint with arbitrary emails to seed
  contacts. Acceptable risk for the v1 launch; revisit if abuse seen.

## Surprises

- The book-assembler endpoint (/api/book/[shortcode]) already implements
  its own email-gate cookie scheme (separate from the marketing-funnel
  HMAC cookie). The read-along page now sets both: it POSTs to the
  marketing-funnel email-gate AND to the book-assembler email-gate, so
  the legacy session-token flow keeps working alongside the new HMAC
  flow. This is intentional belt-and-suspenders.
- 'lifecycle_T0' subject test caught a falsy-zero bug in the lifecycle
  scheduler's idempotency check — `if (contact.templateLastSentAt[t])`
  treats T=0 as "not sent" because 0 is falsy. Fixed to
  `!== undefined`. Caught by the second-tick test before commit.

## Verification

```
pnpm test          # 800/800 (683 baseline + 117 new marketing)
pnpm exec svelte-check  # 96 errors (== baseline; 0 NEW)
```
