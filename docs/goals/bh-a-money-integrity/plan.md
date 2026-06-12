# Plan: bh-a-money-integrity — Stripe + Order Payment Integrity (P0/P1)

Author: Fable (architect). Anchored on context.md (recon 2026-06-12). IMMUTABLE once execution starts — course corrections go in notes-from-the-boss.md.

## Mission
Close Cluster A: no double-applied webhooks, no fail-open shipping charges, refunds that actually execute, exactly once. Customer promise: you are charged exactly what the server computed, once; refunds approved = refunds delivered.

## Acceptance criteria (ALL mechanical)
- AC1 webhook-dedup: replaying the SAME Stripe event.id (payment_intent.succeeded) twice → second returns 200 `{deduped:true}` and order state/transitions unchanged (assert transition count). Works in BOTH stores: sqlite (new `processed_webhook_events` table, PK event_id) AND in-memory (Set on the store object). Concurrent-dupe guard: state transition + event-record happen in one sqlite transaction; in-memory path re-checks state inside the same microtask before put.
- AC2 unknown-event: unhandled event types → 200 `{ignored:true}` + log, never 500 (Stripe retries 500s forever).
- AC3 shipping-fail-closed: `/api/order` with NO shippingQuote service injected → 503 `shipping_unavailable` (NOT silent accept). Quote-service throw → 503. Client shippingOption.costCents ≠ server quote → 400 `shipping_mismatch` with serverQuote in body. Default prod deps INJECT the real ShippingQuoteService; vitest helpers inject a mock (update tests/fulfillment/api-helpers.ts so existing tests keep passing — they currently exercise the fail-open path).
- AC4 refund-execution: POST quality-claim decision `approved_refund` → StripeCheckoutService.refund called once with the order's paymentIntent + amount; order transitions to `refunded` with TransitionLogEntry; REPLAYED approval → no second refund call (idempotent via order state). Refund failure → claim stays `approved_refund_pending` + 502 surfaced (no silent swallow).
- AC5 partial-work-reconciled: the dirty worktree edits (order/+server.ts, stripe-webhook/+server.ts, untracked tests/fulfillment/money-integrity.test.ts) are explicitly adopted or reverted PER HUNK with one commit `chore(bh-a): reconcile prior partial fix` documenting the decision in its body. No hunk silently kept.
- AC6 suites: full `pnpm test` green (baseline 1325 + new); `node scripts/gates/run-all.mjs` ALL PASS (G6-money + G7 unchanged-or-better).
- AC7 raw results appended to docs/HANDOFF.md lane log + state.md all-green + LANE-DONE sentinel printed.

## Sketched diffs (shape, not verbatim)
- `SqliteOrderStore.ts`: + `processed_webhook_events(event_id TEXT PRIMARY KEY, order_id, type, processed_at)`; method `recordWebhookEventOnce(eventId, orderId, type): boolean` (INSERT OR IGNORE inside the put-transaction; returns inserted?).
- `OrderLifecycleService.ts` (InMemoryOrderStore): + `processedEvents: Set<string>` + same-shaped method.
- `types.ts`: + optional `recordWebhookEventOnce` on OrderStore interface (or a WebhookDedupStore sub-interface — keep interface change minimal, default-impl for custom stores).
- `stripe-webhook/+server.ts`: lookup → `recordWebhookEventOnce` gate → transition. Unknown types: early 200.
- `order/+server.ts`: deps.shippingQuote REQUIRED at request time → 503 when absent; mismatch → 400; remove catch-warn-continue.
- `quality-claim/+server.ts` + `QualityGuaranteeHandler.ts`: decision==approved_refund → refund exec path w/ idempotency on order.state; new transition `refunded`.
- Tests: extend/adopt money-integrity.test.ts: replay, concurrent-ish dupe, unknown-event, no-quote-503, quote-throw-503, mismatch-400, refund-once, refund-replay-noop, refund-failure-pending. ~12 new.

## Kill conditions (STOP + write state.md BLOCKED + reason; NO push)
- Any existing fulfillment test must be DELETED to pass → stop (means AC3 breaks a real contract; renegotiate via notes).
- 2 fix rounds can't green the suite or gates.
- Scope creep beyond: fulfillment service files above, the 3 routes, their tests, HANDOFF/state docs.
- order state machine needs NEW states beyond `refunded` → stop (design review needed).

## Out of scope
Lulu webhook dedup (separate finding, backlog), subscription billing, gift flows (cluster D shipped), persistence of in-memory dedup across restarts (sqlite is the durable path; in-memory is dev/test).

## Step order
1. Reconcile partial work (AC5) → commit.
2. Webhook dedup both stores + tests (AC1, AC2) → commit.
3. Shipping fail-closed + helper updates (AC3) → commit.
4. Refund execution path (AC4) → commit.
5. Suites + gates + HANDOFF + state.md green + LANE-DONE (AC6, AC7).
Re-read notes-from-the-boss.md BEFORE EVERY step.

## AMENDMENTS v2 (red-team folded — these OVERRIDE conflicting v1 text)

- A-P0-1 REFUNDS: no order-state idempotency. New refund LEDGER keyed (orderId, claimId, refundKind):
  persist status=pending BEFORE the Stripe call; send deterministic `Idempotency-Key:
  order:{orderId}:claim:{claimId}:refund:{amountCents}` header from StripeCheckoutService.refund;
  ledger status updated from response. NO new OrderState (refunds live in transition log + ledger).
- A-P0-2 DEDUP: one atomic store op `applyStripeWebhookEventOnce(event, expectedState, transitionPatch)
  -> 'applied'|'duplicate'|'ignored'`. SQLite: INSERT OR IGNORE + state predicate + order update +
  transition rows in ONE transaction. In-memory: synchronous claim (Set.add before ANY await) + sync
  CAS update. Tests: Promise.all concurrent same-event delivery against BOTH stores.
- A-P0-3 RECONCILE: REJECT the dirty shipping hunk wholesale (preserves 0-cost tampering: optional
  quote, catch->empty options, clientShippingCents in PaymentIntent, <0-only guard). Salvage TEST
  ideas from money-integrity.test.ts only after fixing its GROUND/MAIL level bug (P1-2). Leave
  tasks/codex-runs/ uncommitted (P2-3).
- A-P1-1: dedup + replay tests for ALL handled events: payment_intent.succeeded,
  payment_intent.payment_failed, charge.refunded. Plus success/failure ordering test on one PI.
- A-P1-2 SHIPPING MATCH: exact luluShippingLevel + currency match against server quote; unknown level
  -> 400 shipping_option_unavailable; persist the matched SERVER option object, never the client's.
  costCents==0 rejected.
- A-P1-3 WIRING: new shared helper tests/fulfillment/wireFulfillmentDeps.ts (order+webhook+quality+
  shipping deps together, mock quote source shared with /api/shipping-quote). Update ALL
  __setOrderApiDeps call sites: api-order-endpoint, api-webhook-endpoints, station7-stripe-elements,
  security-fixes, api-quality-claim tests. Default non-prod deps get the same mock quote source.
- A-P1-4 SCHEMA: SqliteOrderStore schema v2 migration (create processed_webhook_events + refund_ledger,
  bump schema_meta to 2, idempotent; tests: fresh-create AND v1->v2 upgrade).
- A-P1-5 CAPABILITY: required `WebhookOrderStore` interface for the webhook route deps; adapters on
  both stores; prod startup fails closed if store lacks capability. Never optional-skip dedup.
- A-P1-6 OPS AUTH: refunds execute ONLY via new POST /api/quality-claim/[id]/decision gated by
  `OPS_API_TOKEN` bearer (env; 401 absent/mismatch; production-config asserts it set in prod).
  Parent submit NEVER carries a decision.
- A-P1-7 + A-P2-1 ACK MATRIX (codified in AC2): 200 = handled | duplicate | unknown-PI | ignored |
  permanent lifecycle conflict (body says which); 401 = missing/invalid/stale signature; 400 =
  malformed signed payload; 5xx = transient infra ONLY (Stripe retries those).
- A-P2-2: do not copy the bad `import('/services/...')` type expr or the stale comment; fresh code uses
  the existing ShippingOption import.

## AC DELTAS
- AC1 covers all 3 event types + concurrency (Promise.all) on both stores; outcome body
  {received, outcome:'applied'|'duplicate'|'ignored'}.
- AC3 adds: exact-level+currency match, 0-cost reject, shared wiring helper, all 5 test sites updated.
- AC4 becomes: ops-authed decision route executes refund once (ledger+idempotency-key), replayed
  decision -> 200 {alreadyExecuted:true}, refund failure -> ledger status=failed + 502, parent route
  unchanged.
- AC6 adds: fresh + v1->v2 sqlite migration tests green.
