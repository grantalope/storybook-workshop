# Goal: Storybook Workshop — Fulfillment (Lulu Direct + Stripe + Webhooks)

**Wave:** 2 (depends on Wave 1 book-assembler)
**Branch:** `feat/storybook-workshop-fulfillment`
**Worktree:** `~/devbox/pachinko-app-sw-fulfillment/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §5
**Executor preference:** claude

---

## Why

The print + mail end-to-end pipeline. Backend proxies to Lulu Direct API (no client-side key exposure), Stripe charges parent, Lulu webhook updates status, parent gets email at each lifecycle event, quality-guarantee handler routes defect refunds. This is the SKU.

---

## Scope (files to create)

```
src/routes/dashboard/services/storybook-workshop/fulfillment/
├── LuluFulfillmentService.ts                # Lulu Direct API client (OAuth2, print-job, webhook signature)
├── StripeCheckoutService.ts                 # Stripe PaymentIntent + tax + refund
├── OrderLifecycleService.ts                 # state machine: pending_payment → paid → submitted → in_production → shipped → delivered
├── ShippingQuoteService.ts                  # Lulu live shipping quote
├── QualityGuaranteeHandler.ts               # defect claim processing
├── ReprintCoordinator.ts                    # Lulu re-issue + auto-refund flows
├── OrderAuditService.ts                     # transition log + parent-visible status
├── types.ts                                 # Order, OrderState, ShippingOption, QualityClaim
└── index.ts
src/routes/api/storybook-workshop/
├── order/+server.ts                          # POST: validate PDF, get shipping quote, create Stripe PaymentIntent
├── order/[id]/+server.ts                     # GET status, POST cancel
├── lulu-webhook/+server.ts                   # Lulu status webhook (sig-verified)
├── stripe-webhook/+server.ts                 # Stripe payment_intent.succeeded
├── shipping-quote/+server.ts                 # live Lulu shipping cost query
└── quality-claim/+server.ts                  # parent-side defect claim submission
tests/storybook-workshop/fulfillment/
├── lulu-fulfillment-service.test.ts
├── stripe-checkout-service.test.ts
├── order-lifecycle.test.ts
├── shipping-quote.test.ts
├── quality-guarantee-handler.test.ts
├── reprint-coordinator.test.ts
└── api-order-endpoint.test.ts
```

## Out of scope

- ❌ No board-book provider (Pint Size Productions) — v2.
- ❌ No subscription model — goal #9.
- ❌ No marketing emails (transactional emails sent here — marketing nurture is goal #11).
- ❌ No PDF assembly — goal #5.

---

## Build sequence

### Phase 1 — Types + Lulu API client
1. Read spec §5 + Lulu Direct API docs (https://developers.lulu.com/) in full.
2. `types.ts`:
   - `OrderState = 'pending_payment' | 'paid' | 'submitted_to_lulu' | 'in_production' | 'shipped' | 'delivered' | 'cancelled_pre_production' | 'failed_validation' | 'lulu_error_recoverable' | 'lulu_error_terminal' | 'lost_in_transit'`
   - `Order = { id, kidId, bookId, parentEmail, format, pages, pdfHash, shippingAddress, stripePaymentIntentId, luluJobId, state, transitions: TransitionLogEntry[], consentLog: ConsentLogEntry, ts }`
   - `ShippingAddress = { name, line1, line2?, city, region, postcode, country: ISO2 }`
   - `ShippingOption = { name, ship_speed: 'mail'|'priority'|'express', cost: number, currency, eta_days }`
   - `QualityClaim = { orderId, category: 'defect'|'wrong_content'|'lost_transit'|'color_off', photoUrls: string[], parentText, claim_ts, decision: 'pending'|'approved_reprint'|'approved_refund'|'rejected' }`

3. `LuluFulfillmentService.ts`:
   - OAuth2 client-credentials → JWT cached (~24h TTL) in server module-scoped variable.
   - Methods: `getShippingQuote(address, format, pages)`, `createPrintJob(order, pdfBlob, coverPdfBlob)`, `getOrderStatus(luluJobId)`, `cancelPrintJob(luluJobId)`, `reissuePrintJob(orderId, reason)`.
   - Webhook signature verification (HMAC).

### Phase 2 — Stripe integration
4. `StripeCheckoutService.ts`:
   - `createPaymentIntent({ orderId, amountCents, currency, parentEmail, metadata })` returns client-secret for client-side confirm.
   - `refund(paymentIntentId, amountCents?)` for quality-claim refunds.
   - Stripe Tax enabled (US + EU VAT auto).
   - Idempotency keys: `order:{orderId}:create-payment`.

### Phase 3 — Order lifecycle state machine
5. `OrderLifecycleService.ts`:
   - State machine: only allowed transitions per spec §5.3.
   - Persist orders + transitions to backend DB (use existing pachinko backend DB or a new sqlite store for v1 — document choice in implementation-notes).
   - Audit log every transition with timestamp + actor (system | parent | ops | lulu).
   - Per-state side-effects:
     - `paid` → `submitTo Lulu`
     - `submitted_to_lulu` → schedule poll at +1h for status (idle scheduler, not setInterval — use kernel cognition.schedulePeriodic if available)
     - `shipped` → send tracking email
     - `delivered` → send post-delivery survey + Make-Another CTA
     - `cancelled_pre_production` → trigger Stripe refund
     - `lulu_error_terminal` → trigger Stripe refund + ops alert

### Phase 4 — Order endpoint
6. `src/routes/api/storybook-workshop/order/+server.ts`:
   - `POST { orderId, pdfBlob (multipart), coverPdfBlob, shippingAddress, format, pages, parentEmail, consentLog }`
   - Steps:
     a. Validate PDF via `LuluPdfSpecValidator` (already shipped from goal #5).
     b. Get live shipping quote → present to client.
     c. Create Stripe PaymentIntent → return client-secret.
     d. Persist Order in `pending_payment` state.
   - Returns 400 + parent-readable error on validation fail (pre-charge).

7. `src/routes/api/storybook-workshop/order/[id]/+server.ts`:
   - `GET` → status + transitions + tracking link if shipped.
   - `POST { action: 'cancel' }` → if state == `submitted_to_lulu` within 60-90 min window, call Lulu cancel + Stripe refund + transition to `cancelled_pre_production`. Else 422 with `{ error: 'past_cancel_window' }`.

### Phase 5 — Webhooks
8. `lulu-webhook/+server.ts`:
   - Verify signature.
   - Map Lulu status events to order transitions: `IN_PRODUCTION → in_production`, `PRINTED → in_production`, `SHIPPED → shipped`, `DELIVERED → delivered`, `CANCELLED → cancelled_pre_production`, `FAILED → lulu_error_terminal`.
   - Trigger emails per transition.
9. `stripe-webhook/+server.ts`:
   - On `payment_intent.succeeded` → transition order to `paid` → call `LuluFulfillmentService.createPrintJob`.
   - On `charge.refunded` → audit-log refund.

### Phase 6 — Shipping quote endpoint
10. `shipping-quote/+server.ts`:
    - `POST { format, pages, address }` → returns `ShippingOption[]` from Lulu.
    - Cached per `(format, pages, country, region)` 15 min.

### Phase 7 — Quality Guarantee Handler
11. `quality-claim/+server.ts`:
    - `POST { orderId, category, photoUrls, parentText }` → creates `QualityClaim` in `pending` state.
    - Ops dashboard surfaces pending claims (out of v1 scope — surfaces as DB entries for now).
    - For obvious defect cases (e.g., lost-transit with delivery never confirmed), auto-approve reprint.
    - For "wrong_content", auto-pull consent log + PDF hash → match against claim → reject if PDF hash matches what parent approved.
12. `QualityGuaranteeHandler.ts`:
    - `processClaim(claim): Promise<Decision>` — logic per §5.5.
13. `ReprintCoordinator.ts`:
    - `reprint(orderId, reason): Promise<NewLuluJobId>` — calls Lulu reissue API, persists relation original → reissue, original Stripe charge stays (cost absorbed by reprint reserve).

### Phase 8 — Transactional email hooks
14. Add hooks for transactional emails (use Resend or Postmark — document choice). Send at: `paid`, `printed`, `shipped`, `delivered`, `failed`. **No marketing here — that's goal #11.**

### Phase 9 — Tests
15. `lulu-fulfillment-service.test.ts`: mocked Lulu API, OAuth refresh, print-job creation, webhook sig verification.
16. `stripe-checkout-service.test.ts`: PaymentIntent shape, refund flow, idempotency.
17. `order-lifecycle.test.ts`: state machine transitions allowed/blocked, audit log, side-effects.
18. `shipping-quote.test.ts`: cache hit/miss, address validation.
19. `quality-guarantee-handler.test.ts`: each category decision logic, consent-log defense for wrong_content.
20. `reprint-coordinator.test.ts`: reissue flow, original-to-reissue relation.
21. `api-order-endpoint.test.ts`: PDF validation pre-Stripe, error responses, happy path.
22. ≥60 new vitest tests.

### Phase 10 — Verification
23. `pnpm check` clean.
24. Manual smoke against Lulu sandbox: drive a test order end-to-end — PDF upload → Stripe test charge → Lulu print-job creation → Lulu webhook fires → state transitions visible → email triggers fire (against a transactional-email test endpoint).

---

## Done criteria
- ✅ All files created.
- ✅ ≥60 vitest tests green.
- ✅ Lulu sandbox order placed + delivered (test mode, not real production).
- ✅ Stripe test charge + refund cycle clean.
- ✅ Quality-guarantee handler processes all 4 claim categories correctly.
- ✅ Webhook signature verification covered by tests.
- ✅ implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 5 (webhook handlers — codex sends malformed events, race conditions, replay attacks)
- `/codex:adversarial-review` after Phase 7 (quality-guarantee handler — codex hand-crafts disputes)
- `/codex:rescue` on > 20min stuck

## Implementation-notes.md must document
- Lulu OAuth2 token caching choice
- Backend DB choice (existing pachinko backend vs new sqlite)
- Resend vs Postmark email provider choice
- Stripe Tax enablement details
- Cancel-window timing measurement (when does Lulu actually batch-print)
- Reprint reserve % calibration

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-fulfillment -b feat/storybook-workshop-fulfillment origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
