# bh-a-money-integrity Step-1 Recon Context

Date: 2026-06-12
Branch: `fix/bh-a-money-integrity`
Scope: Cluster A, Stripe + order payment integrity.

## 1. Cluster A Findings Verbatim + Code-Level Confirmation

From `docs/BUG-BACKLOG.md`, Cluster A has two blocking items:

> **Title:** Stripe charge.refunded webhook uses Charge ID as PaymentIntent lookup -- refunds never audited  
> **File:** src/routes/api/stripe-webhook/+server.ts  
> **Severity:** P1  
> **Lens:** money  
> **Cluster:** A  
> **Status:** OPEN  
> **Customer Impact:** Line 127: const piId = event.data.object.id fetches the Charge ID (ch_...) not the PaymentIntent ID. getByStripePaymentIntent(piId) always returns null. All refund events are silently swallowed with ok:true audited:refund -- the order record is never updated. Refund audit trail is permanently broken.  
> **Fix:** Use event.data.object.payment_intent instead of .id.

Current code confirmation:
- Trigger path: Stripe sends `POST /api/stripe-webhook` with `type: "charge.refunded"` and a Charge payload where `data.object.id` is `ch_...` and `data.object.payment_intent` is `pi_...`.
- Current tree appears to have an attempted fix: `src/routes/api/stripe-webhook/+server.ts:126-133` comments the original bug and sets `const piId = (event.data.object.payment_intent ?? event.data.object.id) as string;`, then looks up `orderDeps.store.getByStripePaymentIntent(piId)`.
- Audit write path today: if the order exists, `src/routes/api/stripe-webhook/+server.ts:134-150` appends a same-state transition with `reason: "stripe_charge_refunded"` and `meta: { paymentIntentId: piId }`, then `store.put(updated)`.
- Type surface mismatch: `src/lib/services/fulfillment/types.ts:247-255` defines `StripeWebhookEvent.data.object` as `{ id: string; metadata?: ... }` and does not include `payment_intent`, so the current fix relies on a property not represented in the canonical type.
- Replay behavior today: each replay of the same `charge.refunded` event appends another same-state refund transition because there is no event-ID dedup table or processed-event state.

> **Title:** Shipping option cost accepted from client without server re-validation -- price tampering possible  
> **File:** src/routes/api/order/+server.ts  
> **Severity:** P0  
> **Lens:** money  
> **Cluster:** A  
> **Status:** OPEN  
> **Customer Impact:** Line 263: totalCents = serverBookCostCents + body.shippingOption.costCents. Book cost IS server-derived (priceForBook) but shippingOption.costCents comes directly from client with no cross-check against a Lulu quote. An attacker can submit {costCents: 0} or {costCents: -5000} to manipulate the PaymentIntent amount. The /api/shipping-quote endpoint is never called server-side during order creation.  
> **Fix:** Call ShippingQuoteService.getQuote(address, format, pages) server-side and compare costCents against body.shippingOption.costCents within +/-5% tolerance; reject or re-price on mismatch.

Current code confirmation:
- Trigger path: parent/client sends `POST /api/order` with `shippingOption.costCents` chosen by the client.
- Current tree appears to have an attempted partial fix: `src/routes/api/order/+server.ts:261-264` rejects non-number, non-finite, and negative shipping costs.
- Server quote validation is optional today: `src/routes/api/order/+server.ts:265-297` only calls `deps.shippingQuote.getQuote(...)` when `deps.shippingQuote` exists.
- Default dependency wiring does not inject a `ShippingQuoteService`: `src/routes/api/order/+server.ts:70-90` creates stores, lifecycle, Stripe mock, ids, and clock, but no `shippingQuote`.
- Quote failures are fail-open: `src/routes/api/order/+server.ts:273-277` catches quote errors, logs a warning, sets `serverShippingOptions = []`, and continues.
- Final charge still uses the client value after optional validation: `src/routes/api/order/+server.ts:314-320` computes `totalCents = serverBookCostCents + clientShippingCents` and passes that amount to Stripe.
- Potential compile/type gotcha in the current attempted fix: `src/routes/api/order/+server.ts:266` uses `import('/services/fulfillment').ShippingOption[]`, which does not match the repo's `$lib/services/fulfillment` alias.

## 2. Webhook Event-Flow Map

Stripe webhook: `src/routes/api/stripe-webhook/+server.ts`
- Common entry: reads raw body, verifies `Stripe-Signature`, parses JSON via `StripeCheckoutService.parseWebhookEvent` (`+server.ts:64-80`; service parse at `StripeCheckoutService.ts:96-108`).
- `payment_intent.succeeded`: uses `event.data.object.id` as PaymentIntent id, finds order via `getByStripePaymentIntent`, ignores unknown PI, ignores non-`pending_payment`, transitions `pending_payment -> paid` via lifecycle (`+server.ts:82-103`).
- `payment_intent.payment_failed`: uses `event.data.object.id`, finds order, ignores unknown/non-pending, transitions `pending_payment -> failed_validation` (`+server.ts:105-124`).
- `charge.refunded`: current tree uses `event.data.object.payment_intent ?? event.data.object.id`, finds order by PI, appends same-state audit transition `stripe_charge_refunded`, then returns `{ ok: true, audited: "refund" }` whether or not the order was found (`+server.ts:126-152`).
- Unhandled Stripe event types: acknowledged with `{ ok: true, ignored: "unhandled_event_type", type }` (`+server.ts:155`).
- Dedup state today: none. Event ID (`event.id`) is parsed but not persisted or checked. `payment_intent.succeeded` has only a non-atomic state guard (`order.state !== "pending_payment"`) at `+server.ts:88-90`. Refunds append duplicate audit entries on every replay.

Lulu webhook: `src/routes/api/lulu-webhook/+server.ts`
- Common entry: verifies `Lulu-Signature`, parses event via `LuluFulfillmentService`, then looks up order by `printJobId` (`+server.ts:53-72`).
- Unknown Lulu job: returns 200 with `ignored: "unknown_lulu_job"` to stop retries (`+server.ts:71-75`).
- Status mapping: `luluStatusToOrderState(event.data.status)` chooses target state; unmapped status is ignored (`+server.ts:77-80`).
- No-op replay: if target state equals current state, returns `ignored: "no_state_change"` (`+server.ts:81-83`).
- State transition: applies optional `trackingUrl` patch and calls lifecycle transition with actor `lulu`, reason `lulu_webhook:${event.topic}`, and raw status metadata (`+server.ts:85-93`).
- Dedup state today: no event-ID store. Replays are handled only by same-state no-op or lifecycle transition rejection.

## 3. Order State Machine + Refund Touchpoints

Canonical states are in `src/lib/services/fulfillment/types.ts:18-30`:
`pending_payment`, `paid`, `submitted_to_lulu`, `in_production`, `shipped`, `delivered`, `cancelled_pre_production`, `failed_validation`, `lulu_error_recoverable`, `lulu_error_terminal`, `lost_in_transit`.

Allowed transitions are enforced in `OrderLifecycleService.ts:41-76`:
- `pending_payment -> paid | failed_validation | cancelled_pre_production`
- `paid -> submitted_to_lulu | lulu_error_recoverable | lulu_error_terminal | cancelled_pre_production`
- `submitted_to_lulu -> in_production | shipped | cancelled_pre_production | lulu_error_recoverable | lulu_error_terminal`
- `in_production -> shipped | lulu_error_recoverable | lulu_error_terminal`
- `shipped -> delivered | lost_in_transit`
- terminal: `delivered`, `cancelled_pre_production`, `failed_validation`, `lulu_error_terminal`, `lost_in_transit`
- `lulu_error_recoverable -> submitted_to_lulu | lulu_error_terminal | cancelled_pre_production`

Creation and transitions:
- `POST /api/order` creates `pending_payment` with initial `order_created` transition (`OrderLifecycleService.ts:126-156`, route call at `order/+server.ts:300-312`).
- `POST /api/order/[id] { action: "confirm" }` verifies Stripe PI server-side and transitions to `paid` only if current state is `pending_payment` (`order/[id]/+server.ts:55-100`).
- Parent cancel path calls `cancelByParent`: pending payment cancels immediately; submitted-to-Lulu cancels only inside the 75-minute default window (`order/[id]/+server.ts:44-53`, `OrderLifecycleService.ts:205-225`, default at `types.ts:306`).

Refund touchpoints:
- `StripeCheckoutService.refund(paymentIntentId, amountCents?)` exists and validates a non-empty PI id and positive amount when provided (`StripeCheckoutService.ts:63-70`).
- Fetch-backed refund posts to `/refunds` with `payment_intent` and optional `amount` (`StripeCheckoutService.ts:241-262`).
- No route found in explored surfaces currently initiates a refund. Quality claims can return `shouldRefund`, but `QualityGuaranteeHandler` explicitly does not execute refunds (`QualityGuaranteeHandler.ts:18-20`, decision shape at `QualityGuaranteeHandler.ts:41-46`).
- `QualityClaimDecision` includes `approved_refund` (`types.ts:89-94`), but current decision logic never returns `approved_refund`; defect/color paths remain pending for ops (`QualityGuaranteeHandler.ts:181-190`).
- Refund webhook audit is same-state transition only; there is no `refunded` order state by design comment (`stripe-webhook/+server.ts:3-6`).

## 4. API / Dependency Shapes

Order API:
- `OrderApiDeps` shape is in `src/routes/api/order/+server.ts:41-50`: `{ lifecycle, stripe, store, qualityClaimStore?, shippingQuote?, idGen, nowSource }`.
- Tests set it with `__setOrderApiDeps(deps)` (`order/+server.ts:66-68`).
- Default `__getOrderApiDeps()` builds stores via `createDefaultFulfillmentStores()`, uses a mock Stripe HTTP client, and does not wire real Stripe, real Lulu, or shipping quote (`order/+server.ts:70-90`).

Stripe webhook API:
- `StripeWebhookApiDeps` only contains `{ stripe: StripeCheckoutService }` (`stripe-webhook/+server.ts:16-24`).
- It imports order deps from `../order/+server`, so webhook tests must wire both `__setStripeWebhookApiDeps` and `__setOrderApiDeps`.

Lulu webhook API:
- `LuluWebhookApiDeps` contains `{ lulu: LuluFulfillmentService }` (`lulu-webhook/+server.ts:15-23`).
- It also depends on `__getOrderApiDeps()` for order lookup and lifecycle transition (`lulu-webhook/+server.ts:56-58`).

Quality claim API:
- `QualityApiDeps` shape is `{ handler, claimStore, idGen }` (`quality-claim/+server.ts:18-22`).
- Default quality deps reuse `orderDeps.store` and `orderDeps.qualityClaimStore`, falling back to a new default fulfillment store only for claims (`quality-claim/+server.ts:35-48`).

Shipping quote API:
- `__setShippingApiDeps` exists in `src/routes/api/shipping-quote/+server.ts` and is tested from `tests/fulfillment/api-shipping-quote.test.ts`.
- Important gap: the order-create default deps do not consume shipping API deps; order creation needs its own `shippingQuote` injection.

## 5. Test Patterns To Mimic

Useful fulfillment test helpers:
- `tests/fulfillment/api-helpers.ts` wraps SvelteKit handlers with `callPost` and `callGet`.
- `tests/fulfillment/fixtures.ts` provides `makeAddress`, `makeShippingOption`, `makeConsent`, `makeClock`, `makeIdGen`, `hmacHex`, `createMockStripe`, and `createMockLulu`.
- `createMockStripe` records calls and idempotency keys, returns deterministic `pi_for_${orderId}`, and exposes refund calls (`fixtures.ts:178-233`).
- `createMockLulu` records `getShippingCost`, supports custom shipping responses, and can fail one method (`fixtures.ts:68-166`).

Existing tests directly relevant to Cluster A:
- `tests/fulfillment/money-integrity.test.ts` has adversarial refund cases with `object.id = ch_...` and `object.payment_intent = pi_...` (`money-integrity.test.ts:91-181`).
- It also has shipping tamper tests for negative, zero vs server quote, inflated cost, and happy path (`money-integrity.test.ts:188-237`).
- `tests/fulfillment/api-webhook-endpoints.test.ts` covers Stripe signature handling, `payment_intent.succeeded`, `charge.refunded`, and `payment_intent.payment_failed` (`api-webhook-endpoints.test.ts:144-217`), but the older refund test uses `data.object.id = piId` and does not simulate real `ch_...` payload (`api-webhook-endpoints.test.ts:180-200`).
- `tests/fulfillment/api-order-endpoint.test.ts` wires order deps without `shippingQuote` (`api-order-endpoint.test.ts:24-32`), so it exercises the fail-open path unless specifically updated.
- `tests/fulfillment/store-factory.test.ts` should be checked before changing default persistence behavior.
- Gift persistence patterns live in `tests/subscription/gift-flow-double-redeem-persistence.test.ts`; it verifies a shared store across service instances.

## 6. Gotchas

- Dirty worktree observed during recon: `src/routes/api/order/+server.ts`, `src/routes/api/stripe-webhook/+server.ts`, untracked `tests/fulfillment/money-integrity.test.ts`, and untracked `tasks/codex-runs/` existed before this context file was written. Do not overwrite or revert them without owner approval.
- SQLite vs memory: `createDefaultFulfillmentStores()` returns in-memory stores for vitest/test/browser and tries SQLite only for `node-prod` (`storeFactory.ts:46-60`). If `better-sqlite3` is unavailable in node-prod, it warns and falls back to in-memory, meaning orders are not durable (`storeFactory.ts:29-30`, `storeFactory.ts:58-60`).
- SQLite writes whole order JSON plus transition rows; there is no processed webhook event table today (`SqliteOrderStore.ts:50-85`, `SqliteOrderStore.ts:189-210`).
- In-memory `OrderStore.put` is a simple Map set (`OrderLifecycleService.ts:286-307`); lifecycle transition is read-then-write and not atomic.
- Env gates: `hooks.server.ts` validates production config on every request (`hooks.server.ts:86-92`) and rejects `STORYBOOK_DEV_BYPASS_AUTH` in production through `resolveParentEmail` (`hooks.server.ts:129-144`).
- Dev bypass: with `STORYBOOK_DEV_BYPASS_AUTH` enabled outside production, `/api/order` accepts `body.parentEmail` and logs a warning (`hooks.server.ts:151-163`; route call at `order/+server.ts:213-228`).
- Production wiring risk: `configureOrderApi(env)` is a placeholder only (`order/+server.ts:343-347`), and default order deps use mock Stripe HTTP (`order/+server.ts:76-81`). Confirm host wiring before treating any money path as production-ready.

## 7. Other Fragile Money Spots

1. Stripe webhook idempotency is still read-then-write only.
   Evidence: backlog Finding 9 is open; code checks `order.state !== "pending_payment"` before transition (`stripe-webhook/+server.ts:88-90`, `+server.ts:109-111`) but stores no `event.id`. Concurrent duplicate deliveries can both read pending before either put completes.

2. Shipping validation can still fail open.
   Evidence: order creation only validates against Lulu when `deps.shippingQuote` is injected (`order/+server.ts:265`), default deps do not inject it (`order/+server.ts:70-90`), and quote service errors are caught with a warning and continuation (`order/+server.ts:273-277`). This weakens the intended P0 fix in real wiring unless production injects and fails closed.

3. Quality refund decisions have no execution path.
   Evidence: `QualityClaimDecision` includes `approved_refund` (`types.ts:89-94`) and `StripeCheckoutService.refund` exists (`StripeCheckoutService.ts:63-70`), but `QualityGuaranteeHandler` says caller must compose Stripe refund (`QualityGuaranteeHandler.ts:18-20`) and current route only returns claim decision/reason (`quality-claim/+server.ts:70-82`). No explored route executes a refund or records an ops-approved refund decision.
