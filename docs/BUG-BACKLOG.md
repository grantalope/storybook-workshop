# Bug Backlog -- storybook-workshop

> Generated 2026-06-12. Recovered from bughunt workflow wf_7ed0f7d5-9ce (prior triage agent
> falsely reported sha bb58c3a40 which does not exist; this file re-created from ground truth).
> Architect-log: triage self-report failure noted.

---

## Cluster Summary

| Cluster | Theme | Severity | Status |
|---------|-------|----------|--------|
| A | Money: Stripe + Order Payment Integrity | P0/P1 | **OPEN** |
| B | Safety: Kids Content Safety Gate Never Wired | P0 | **FIXED** -- a0a6fea |
| C | Subscription State Machine: AutopilotDrafter Cadence Halt | P1 | **FIXED** -- 7c7e73f |
| D | Gift + Privacy: In-Memory Redemption + Child Name Leak | P1 | **FIXED** -- 64dd270 |
| E | Reliability + Error Handling (backlog, ship before GA) | P1/P2 | **OPEN** |

---

## All 12 Confirmed Findings

### Finding 1

**Title:** Kids content safety gate never wired -- all LLM story text passes permissive stub
**File:** src/lib/services/author/StoryAuthorService.ts
**Severity:** P0
**Lens:** kid-safety
**Cluster:** B
**Status:** FIXED -- a0a6fea (2026-06-12)
**Customer Impact:** Every LLM-generated story (beats, scenes, spreads, title, blurb) bypassed safety checks. globalThis.__kidsContentSafetyService was read at line 106 but never written anywhere. permissiveSafetyStub (passed: true, categories: []) was always used. Children books with violent, sexual, or hateful LLM-generated content could be minted.
**Root Cause:** Goal #3 (story-author wiring) was never executed. KidsContentSafetyService singleton exists at src/lib/kids-content-safety/KidsContentSafetyService.ts but was never assigned to globalThis.__kidsContentSafetyService at app boot.

---

### Finding 2

**Title:** Stripe charge.refunded webhook uses Charge ID as PaymentIntent lookup -- refunds never audited
**File:** src/routes/api/stripe-webhook/+server.ts
**Severity:** P1
**Lens:** money
**Cluster:** A
**Status:** OPEN
**Customer Impact:** Line 127: const piId = event.data.object.id fetches the Charge ID (ch_...) not the PaymentIntent ID. getByStripePaymentIntent(piId) always returns null. All refund events are silently swallowed with ok:true audited:refund -- the order record is never updated. Refund audit trail is permanently broken.
**Fix:** Use event.data.object.payment_intent instead of .id.

---

### Finding 3

**Title:** Shipping option cost accepted from client without server re-validation -- price tampering possible
**File:** src/routes/api/order/+server.ts
**Severity:** P0
**Lens:** money
**Cluster:** A
**Status:** OPEN
**Customer Impact:** Line 263: totalCents = serverBookCostCents + body.shippingOption.costCents. Book cost IS server-derived (priceForBook) but shippingOption.costCents comes directly from client with no cross-check against a Lulu quote. An attacker can submit {costCents: 0} or {costCents: -5000} to manipulate the PaymentIntent amount. The /api/shipping-quote endpoint is never called server-side during order creation.
**Fix:** Call ShippingQuoteService.getQuote(address, format, pages) server-side and compare costCents against body.shippingOption.costCents within +/-5% tolerance; reject or re-price on mismatch.

---

### Finding 4

**Title:** GiftFlowService.redeem() mutates in-memory Map with no persistence -- service re-instantiated per request
**File:** src/lib/services/subscription/GiftFlowService.ts
**Severity:** P1
**Lens:** money
**Cluster:** D
**Status:** FIXED -- 64dd270 (2026-06-12)
**Customer Impact:** The gift API handler created a new GiftFlowService per request with a fresh Map. The redeem code check was in-memory only. On any server restart or second request, the same gift code could be redeemed again, creating duplicate subscriptions.
**Fix Applied:** Added GiftStore interface + InMemoryGiftStore class; API route uses a module-level singleton so redeem-code status survives across requests.

---

### Finding 5

**Title:** AutopilotDrafter.tick() comment promises nextBookAt advancement on default but code omits it
**File:** src/lib/services/subscription/AutopilotDrafter.ts
**Severity:** P1
**Lens:** state-machines
**Cluster:** C
**Status:** FIXED -- 7c7e73f (2026-06-12)
**Customer Impact:** Lines 123-130: comment says "Credit toward next book: advance nextBookAt forward one cadence interval" but no sub.nextBookAt = nextCadenceAt(...) assignment followed. After a draft defaults, the subscription stayed on the same delivery date. Weekly/monthly subscription cadence halted permanently after first missed book.
**Fix Applied:** Added sub.nextBookAt = nextCadenceAt(sub.nextBookAt, sub.cadence) after the mailer send in the tick() default branch.

---

### Finding 6

**Title:** AutopilotDrafter.respond() approve action does not remove draft from sub.activeDraftIds
**File:** src/lib/services/subscription/AutopilotDrafter.ts
**Severity:** P1
**Lens:** state-machines
**Cluster:** C
**Status:** FIXED -- 7c7e73f (2026-06-12)
**Customer Impact:** Lines 229-231: on opts.action === approve, draft.status was set to approved but sub.activeDraftIds was never filtered. The stale draftId persisted, blocking creation of the next draft in subsequent ticks.
**Fix Applied:** Added sub.activeDraftIds = sub.activeDraftIds.filter((id) => id !== opts.draftId) in the approve branch.

---

### Finding 7

**Title:** Kid first name stored in CRM tags and sent to external email provider
**File:** src/lib/services/marketing/EmailGateService.ts
**Severity:** P1
**Lens:** privacy
**Cluster:** D
**Status:** FIXED -- 64dd270 (2026-06-12)
**Customer Impact:** EmailGateService.record() stored opts.kidFirstName in contact.tags.kidFirstName (line 147). LifecycleEmailService._buildVars() copied it to vars.kid_name. crm.send() shipped it to Resend/Postmark API. A child first name left the device and was processed by external vendors. Violates COPPA/GDPR-K requirements.
**Fix Applied:** EmailGateService no longer writes kidFirstName to contact.tags; stores it in private _kidNames Map only. crm.send() payload never includes child first name.

---

### Finding 8

**Title:** Station 6 generation pipeline has no timeout -- UI hangs indefinitely if LLM or scene render stalls
**File:** src/lib/workshop/stations/Station6Seal.svelte
**Severity:** P1
**Lens:** ux-deadends
**Cluster:** E
**Status:** OPEN
**Customer Impact:** runWorkshopPipeline() has no AbortController, no Promise.race with a timeout, no abort signal. If the LLM provider hangs, running=true stays indefinitely. UI has a forward-only state machine; users cannot navigate back without force-reloading.
**Fix:** Wrap in Promise.race([runWorkshopPipeline(...), timeout(120_000)]). Surface a retry CTA on timeout.

---

### Finding 9

**Title:** Stripe webhook idempotency relies on order state check only -- no event ID deduplication
**File:** src/routes/api/stripe-webhook/+server.ts
**Severity:** P2
**Lens:** money
**Cluster:** E
**Status:** OPEN
**Customer Impact:** The payment_intent.succeeded handler checks order.state !== pending_payment as its idempotency guard. Does not handle concurrent webhook deliveries. State check is a read-then-write that is not atomic; under concurrent delivery two handlers can both read pending_payment before either commits.
**Fix:** Store processed Stripe event IDs (event.id) in a deduplicated set; check before processing.

---

### Finding 10

**Title:** CrmClient.send silently returns ok:true with no providerMessageId on JSON parse error
**File:** src/lib/services/marketing/CrmClient.ts
**Severity:** P2
**Lens:** error-handling
**Cluster:** E
**Status:** OPEN
**Customer Impact:** Line 118: res.json().catch(() => ({})) returns empty object on parse failure. body.id is undefined. Function returns { ok: true, providerMessageId: undefined }. Email delivery audit logs are incomplete; cannot investigate delivery failures without the provider message ID.
**Fix:** Log the parse warning but return { ok: true, providerMessageId: body.id }.

---

### Finding 11

**Title:** Email gate fire-and-forget: user gets 200 OK when CRM quota/auth failure means email is never delivered
**File:** src/routes/api/marketing/email-gate/+server.ts
**Severity:** P2
**Lens:** error-handling
**Cluster:** E
**Status:** OPEN
**Customer Impact:** Lines 108-116: void deps.lifecycle.sendNow(...).catch(console.error). User submits email gate form, gets 200 OK and sees the unlocked experience, but the welcome email never arrives if CRM quota is exhausted or API key is wrong. Error is logged server-side only.
**Fix:** Add a resend mechanism or surface delivery status via a polling endpoint.

---

### Finding 12

**Title:** AnthropicProvider and OllamaProvider swallow upstream error body text on non-OK responses
**File:** src/lib/services/storyllm/AnthropicProvider.ts
**Severity:** P2
**Lens:** error-handling
**Cluster:** E
**Status:** OPEN
**Customer Impact:** Line 174: const text = await resp.text().catch(() => ''). When Anthropic/Ollama return a 5xx with an HTML error page or binary body, the catch returns empty string. Thrown error contains only the HTTP status code. Ops cannot distinguish quota exhaustion from model unavailability from rate limiting.
**Fix:** Use resp.text().catch(parseErr => body-parse-failed). Include Content-Type in the error for non-text 5xx bodies.

---

## Cluster E -- Pre-GA Checklist

All 5 items below must be fixed before general availability:

- [ ] E1: Station 6 timeout + retry CTA (Station6Seal.svelte) -- P1
- [ ] E2: Stripe webhook event-ID deduplication (stripe-webhook/+server.ts) -- P2
- [ ] E3: CrmClient preserve providerMessageId on JSON parse error (CrmClient.ts) -- P2
- [ ] E4: Email gate delivery failure surfaced to user or ops (email-gate/+server.ts) -- P2
- [ ] E5: AnthropicProvider/OllamaProvider include upstream error body text (AnthropicProvider.ts) -- P2

---

## Cluster A -- Pre-GA Checklist (BLOCKING -- P0 present)

Both items below must be fixed before any payment processing goes live:

- [ ] A1: Server-side shipping cost re-validation (order/+server.ts) -- P0
- [ ] A2: Stripe refund webhook PaymentIntent lookup fix (stripe-webhook/+server.ts) -- P1

---

Bughunt workflow: wf_7ed0f7d5-9ce. Batch-verify agent: ada4e1bdea438daaf. Triage agent: ad6029d6ff3e106c5.
Fix agents: B=a3c666eccd4c6f8d5 (a0a6fea), C=a76d7c448ae2e2524 (7c7e73f), D=a0a9501adc866342f (64dd270).
Gate-verify agent: a23fb2c1f1797f657 (1325 tests green, all 10 gates pass).
