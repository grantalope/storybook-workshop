# Red-Team Review: bh-a-money-integrity Step 3

Date: 2026-06-12

Scope checked: `context.md`, `plan.md`, `git status --short`, `git diff`, the modified route hunks, untracked `tests/fulfillment/money-integrity.test.ts`, and the live fulfillment/subscription call paths.

## P0

### P0-1: Refund idempotency by `order.state` is race-prone and cannot represent partial refunds

Evidence:
- `docs/goals/bh-a-money-integrity/plan.md:12` makes `order.state === refunded` the replay guard after calling `StripeCheckoutService.refund`.
- `src/lib/services/fulfillment/StripeCheckoutService.ts:63-70` awaits the refund call with no idempotency key.
- `src/lib/services/fulfillment/StripeCheckoutService.ts:241-248` posts to `/refunds` without an `Idempotency-Key` header.
- `src/lib/services/fulfillment/types.ts:18-30` has no `refunded` state, and `src/routes/api/stripe-webhook/+server.ts:3-6` explicitly says refunds live in the transition log, not the state machine.
- `src/lib/services/fulfillment/types.ts:234-239` models refund status and amount, but no store persists refund attempts, pending state, partial refund totals, or refund IDs.

Attack:
Two ops approvals for the same claim can both read a non-`refunded` order, both call Stripe before either state transition lands, and create two refunds. A binary `refunded` state also blocks legitimate partial refunds, shipping-only refunds, and multiple distinct quality adjustments. Marking the order `refunded` immediately also conflates Stripe `pending` with settled refund success.

Concrete fix:
Do not use `OrderState` as the refund idempotency ledger. Add a refund ledger keyed by `(orderId, claimId, refundKind)` or a deterministic refund intent ID, persist `pending` before the external Stripe call, send a deterministic Stripe idempotency key such as `order:{orderId}:claim:{claimId}:refund:{amountCents}`, and update ledger status from the Stripe response/webhook. Keep the order lifecycle state unchanged unless the product explicitly designs `partially_refunded`/`fully_refunded`.

### P0-2: The proposed webhook dedup API does not provide an atomic state transition

Evidence:
- `docs/goals/bh-a-money-integrity/plan.md:9` says SQLite will record the event and state transition in one transaction, while in-memory will "re-check state inside the same microtask before put."
- `src/routes/api/stripe-webhook/+server.ts:82-96` does lookup, state check, and `lifecycle.transition` as separate awaits for `payment_intent.succeeded`.
- `src/lib/services/fulfillment/OrderLifecycleService.ts:173-196` does read-then-write transition; there is no compare-and-swap or event transaction hook.
- `src/lib/services/fulfillment/SqliteOrderStore.ts:189-210` wraps only `put(order)` persistence, not "insert webhook event if absent + verify current state + append transition" as one operation.
- `src/lib/services/fulfillment/OrderLifecycleService.ts:286-307` in-memory `put` is a simple `Map.set`; `docs/goals/bh-a-money-integrity/context.md:132-133` correctly flags no processed-event table and non-atomic in-memory writes.

Attack:
Adding `recordWebhookEventOnce(eventId, ...)` as a separate store method either records before transition, which can permanently dedupe an event whose transition failed, or records after transition, which leaves a duplicate window. The in-memory "microtask re-check" is hand-waving: any `await` between checking/adding the event and writing the order allows interleaving, and custom async stores make that worse.

Concrete fix:
Replace the sketched method with one atomic store operation for webhook effects, for example `applyStripeWebhookEventOnce(event, expectedState, transitionPatch): { applied | duplicate | ignored }`. SQLite should do `INSERT OR IGNORE processed_webhook_events`, current-state predicate, order update, transition rows, and outcome metadata in one transaction. In-memory should synchronously claim the event before any await and use a per-order/event lock or a synchronous CAS-style update. Tests must force concurrent `Promise.all` delivery against both stores.

### P0-3: Blindly adopting the partial shipping hunk preserves the P0 price-tampering path

Evidence:
- The dirty hunk makes `shippingQuote` optional at `src/routes/api/order/+server.ts:46-47`.
- Default order deps still do not inject it at `src/routes/api/order/+server.ts:82-89`.
- The new validation only runs inside `if (deps.shippingQuote)` at `src/routes/api/order/+server.ts:265`.
- Quote failures are caught and converted into `serverShippingOptions = []` at `src/routes/api/order/+server.ts:273-277`.
- The PaymentIntent amount still uses `clientShippingCents` at `src/routes/api/order/+server.ts:314-321`.
- The guard rejects `< 0`, not zero, at `src/routes/api/order/+server.ts:261-263`, despite the comment claiming zero is always rejected at `src/routes/api/order/+server.ts:255`.

Attack:
With the current dirty hunk, `/api/order` still accepts `{ shippingOption: { costCents: 0 } }` whenever order deps lack a quote service or Lulu quote throws. That is exactly the Cluster A P0 fail-open class.

Concrete fix:
For Step 1 reconciliation, do not adopt this hunk as-is. Make `shippingQuote` required for order creation, return `503 shipping_unavailable` when absent or throwing, and compute/persist shipping from the matched server option rather than from the client object.

## P1

### P1-1: AC1 only names `payment_intent.succeeded`; every handled Stripe event needs dedup semantics

Evidence:
- `docs/goals/bh-a-money-integrity/plan.md:9` tests duplicate replay only for `payment_intent.succeeded`.
- The route has side effects for `payment_intent.succeeded` at `src/routes/api/stripe-webhook/+server.ts:82-96`, `payment_intent.payment_failed` at `src/routes/api/stripe-webhook/+server.ts:105-117`, and `charge.refunded` at `src/routes/api/stripe-webhook/+server.ts:126-152`.
- `docs/goals/bh-a-money-integrity/context.md:140-147` lists webhook idempotency, shipping fail-open, and quality refund execution as remaining fragile money spots.

Attack:
The plan can pass AC1 while duplicate `payment_intent.payment_failed` or `charge.refunded` events still append duplicate transitions or race with success handling.

Concrete fix:
Update AC1/tests to require same-`event.id` idempotency for all handled event types: `payment_intent.succeeded`, `payment_intent.payment_failed`, and `charge.refunded`. Also test success/failure ordering on the same PaymentIntent and assert permanent no-op cases return 200.

### P1-2: Shipping option validation must match identity and currency, not just cost

Evidence:
- The partial hunk falls back to the first server option when no `luluShippingLevel` matches at `src/routes/api/order/+server.ts:280-283`.
- It persists the client-provided `shippingOption` into the order at `src/routes/api/order/+server.ts:300-310`.
- Lulu print job creation later uses `order.shippingOption.luluShippingLevel` directly at `src/lib/services/fulfillment/LuluFulfillmentService.ts:75-100`.
- The untracked money test uses `makeShippingOption({ costCents: 499 })` with default `luluShippingLevel: 'GROUND'` at `tests/fulfillment/money-integrity.test.ts:69-78`, while the mock Lulu server returns only `MAIL` at `tests/fulfillment/fixtures.ts:78-89`.

Attack:
A client can send an unavailable or mismatched shipping level whose cost happens to equal the cheapest server option; the current fallback passes validation and persists the untrusted level for Lulu submission. The untracked happy-path test accidentally blesses this bug.

Concrete fix:
Require an exact server option match on `luluShippingLevel` and currency. Reject missing/unknown levels with `400 shipping_option_unavailable`. Persist the normalized matched server option, not the client-supplied object. Fix `money-integrity.test.ts` so the happy path uses a server-returned level.

### P1-3: AC3 breaks existing tests/dev checkout unless the dependency wiring is broader than planned

Evidence:
- Product caller: Station 7 first fetches `/api/shipping-quote` at `src/lib/workshop/stations/Station7TakeHome.svelte:180-197`, then posts the selected option to `/api/order` at `src/lib/workshop/stations/Station7TakeHome.svelte:205-236`.
- Existing tests wire order deps without `shippingQuote` in `tests/fulfillment/api-order-endpoint.test.ts:24-32`, `tests/fulfillment/api-webhook-endpoints.test.ts:38-56`, `tests/ui/station7-stripe-elements.test.ts:308-323`, `tests/fulfillment/security-fixes.test.ts:45-56`, and `tests/fulfillment/api-quality-claim.test.ts:37-43`.
- `tests/fulfillment/api-helpers.ts:16-42` only builds request events; it does not centralize dependency wiring, so updating only this helper will not keep the suite passing.
- Subscription/gift are not current `/api/order` callers: `/api/autopilot-approve` returns a stateless 202 at `src/routes/api/autopilot-approve/+server.ts:19-45`, `GiftFlowService.redeem` creates subscriptions/bundles at `src/lib/services/subscription/GiftFlowService.ts:233-277`, and `/api/gift` uses subscription services at `src/routes/api/gift/+server.ts:68-114`.

Attack:
AC3 is correct to fail closed, but the execution plan underestimates blast radius. Local/dev checkout and many existing tests will 503 unless default order deps and every test wiring path get a quote service.

Concrete fix:
Add a shared fulfillment test wiring helper that creates order, webhook, quality, and shipping deps together. Update all direct `__setOrderApiDeps` users, not just `api-helpers.ts`. Ensure default non-prod order deps use the same mock quote source as `/api/shipping-quote`, and production wiring constructs real Stripe + Lulu + ShippingQuote deps before order creation is enabled.

### P1-4: SQLite migration plan misses existing v1 databases

Evidence:
- The plan sketches adding `processed_webhook_events` to `SqliteOrderStore.ts` at `docs/goals/bh-a-money-integrity/plan.md:18`.
- Current migration returns immediately when `schema_meta.version === 1` at `src/lib/services/fulfillment/SqliteOrderStore.ts:308-318`.
- Current v1 DDL has no processed-event table at `src/lib/services/fulfillment/SqliteOrderStore.ts:50-85`.

Attack:
Adding the table only to the v1 DDL leaves existing databases without it. Dedup either fails at runtime or silently falls back if the code treats the missing method/table as optional.

Concrete fix:
Bump schema version to v2 and add an idempotent migration path: create `processed_webhook_events`, backfill nothing, update `schema_meta.version` to `2`, and keep fresh DB creation and v1 upgrade tests.

### P1-5: Optional `OrderStore` dedup methods can silently degrade money safety

Evidence:
- `OrderStore` currently has only `get`, `put`, `listByParent`, `getByStripePaymentIntent`, and `getByLuluJob` at `src/lib/services/fulfillment/types.ts:261-267`.
- The plan allows an optional `recordWebhookEventOnce` or sub-interface at `docs/goals/bh-a-money-integrity/plan.md:20`.
- Multiple services accept a generic `OrderStore`, including lifecycle at `src/lib/services/fulfillment/OrderLifecycleService.ts:106-120`, quality claims at `src/lib/services/fulfillment/QualityGuaranteeHandler.ts:33-58`, audit at `src/lib/services/fulfillment/OrderAuditService.ts:27-31`, and reprints at `src/lib/services/fulfillment/ReprintCoordinator.ts:28-58`.

Attack:
If the webhook route treats the dedup method as optional, custom stores compile but run fail-open. If it is mandatory, every custom test/store implementation breaks. Either way the plan needs an explicit compatibility strategy.

Concrete fix:
Define a separate required capability for webhook processing, e.g. `WebhookOrderStore`, and make webhook deps require it. Provide adapters for `InMemoryOrderStore` and `SqliteOrderStore`; in production, fail closed on startup if the configured store lacks the capability. Do not silently skip dedup.

### P1-6: Quality refund execution needs an authenticated ops approval surface, not parent submit

Evidence:
- Parent-facing claim POST accepts only `orderId`, `category`, `photoUrls`, and `parentText` at `src/routes/api/quality-claim/+server.ts:51-82`.
- `QualityGuaranteeHandler.submit` always creates a new claim and runs local decision logic at `src/lib/services/fulfillment/QualityGuaranteeHandler.ts:61-90`.
- Defect and color claims intentionally remain `pending` for ops review at `src/lib/services/fulfillment/QualityGuaranteeHandler.ts:181-190`.
- The plan says "POST quality-claim decision `approved_refund`" at `docs/goals/bh-a-money-integrity/plan.md:12`, but does not name an authenticated ops endpoint or authorization gate.

Attack:
If execution adds `approved_refund` to the existing parent POST body, parents can self-approve refunds. If it only keeps current submit semantics, AC4 has no route to execute.

Concrete fix:
Add a separate authenticated ops route or service method such as `POST /api/quality-claim/[id]/decision` with `decision`, `amountCents`, `refundKind`, and authorization. Parent submit must never accept a final refund decision.

### P1-7: Valid signed webhook conflicts currently return retry-causing 409s

Evidence:
- `payment_intent.succeeded` catches `OrderLifecycleError` and returns 409 at `src/routes/api/stripe-webhook/+server.ts:97-100`.
- `payment_intent.payment_failed` does the same at `src/routes/api/stripe-webhook/+server.ts:118-121`.
- Unhandled signed events already return 200 at `src/routes/api/stripe-webhook/+server.ts:155`.

Attack:
Stripe will retry non-2xx responses. A permanent lifecycle conflict after a valid signed event can turn into repeated deliveries and duplicated pressure on the same order.

Concrete fix:
Classify valid signed event outcomes: duplicates, unknown PaymentIntent, already-terminal state, and permanent lifecycle conflicts should be 200 with `ignored`/`deduped` plus logs. Reserve 5xx for transient infrastructure failures. Keep 4xx for invalid signatures or malformed signed payloads.

## P2

### P2-1: Stripe signature verification exists, but the plan should codify the ack matrix

Evidence:
- The route reads raw body text, verifies `Stripe-Signature`, and only then parses JSON at `src/routes/api/stripe-webhook/+server.ts:64-80`.
- `StripeCheckoutService.verifyWebhookSignature` implements `t=<ts>,v1=<hex>` HMAC with a 300-second tolerance at `src/lib/services/fulfillment/StripeCheckoutService.ts:72-94`.
- Missing/invalid signature currently returns 401 at `src/routes/api/stripe-webhook/+server.ts:70-72`; malformed signed payload returns 400 at `src/routes/api/stripe-webhook/+server.ts:75-80`.

Concrete fix:
Document this in AC2: 200 for all valid signed events that are handled, duplicate, unknown locally, or intentionally ignored; 401 for missing/invalid/stale signatures; 400 for malformed signed JSON/payload; 5xx only for retry-worthy infrastructure failures.

### P2-2: Dirty partial hunk has a compile-risk import type expression and misleading comments

Evidence:
- `src/routes/api/order/+server.ts:266` uses `import('/services/fulfillment').ShippingOption[]`, but the configured app alias is only `$lib` at `svelte.config.js:7-11`.
- The same file already imports `type ShippingOption` at `src/routes/api/order/+server.ts:20-23`.
- The comment at `src/routes/api/order/+server.ts:253-259` says zero cost is always rejected and contains the stray `/usr/bin/bash` text.

Concrete fix:
If any of the hunk is adopted, use the existing `ShippingOption[]` type import and rewrite the comment to match behavior. Prefer deleting the comment once fail-closed tests document the invariant.

### P2-3: Reconcile step should explicitly ignore generated run logs

Evidence:
- `git status --short` shows untracked `tasks/codex-runs/`.
- `docs/goals/bh-a-money-integrity/context.md:130` says those logs pre-existed and should not be overwritten or reverted.
- The plan's AC5 names only the modified route files and untracked money test at `docs/goals/bh-a-money-integrity/plan.md:13`.

Concrete fix:
During AC5, document that `tasks/codex-runs/` is intentionally left uncommitted unless the owner asks for it. Do not include it in the reconcile commit.
