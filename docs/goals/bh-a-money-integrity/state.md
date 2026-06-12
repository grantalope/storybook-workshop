# state — bh-a-money-integrity
EXECUTOR: update after EVERY step. Format: timestamp / step / status / evidence (test counts, shas).
RE-READ ../notes-from-the-boss.md BEFORE EVERY STEP.

## A/C checklist
- [x] AC1 webhook dedup all 3 events, atomic, both stores, concurrency test
- [x] AC2 ack matrix codified + tested
- [x] AC3 shipping fail-closed + exact match + wiring helper + 5 test sites
- [ ] AC4 refund ledger + ops decision route + idempotency key
- [x] AC5 partial work reconciled (shipping hunk REJECTED per A-P0-3)
- [ ] AC6 pnpm test green + gates ALL PASS + migration tests
- [ ] AC7 HANDOFF lane row + LANE-DONE

## Log
- 2026-06-12T20:30:35Z / step-1 AC5 / PASS / order route shipping hunk rejected wholesale (no diff remains in `src/routes/api/order/+server.ts`); webhook charge.refunded lookup hunk adopted; `tests/fulfillment/money-integrity.test.ts` kept with refund regression coverage only and MAIL-level fixture fixed per A-P1-2; `tasks/codex-runs/` left uncommitted. Test: `source ~/.nvm/nvm.sh && nvm use 22 && pnpm exec vitest run tests/fulfillment/money-integrity.test.ts` => 1 file passed, 3 tests passed. Commit: 5625828.
- 2026-06-12T20:43:24Z / step-2 AC1+AC2 / PASS / added required `WebhookOrderStore.applyStripeWebhookEventOnce` capability; in-memory path claims event id synchronously before state write; SQLite path inserts processed event + state/audit transition in one transaction; schema v2 creates `processed_webhook_events` and `refund_ledger` with fresh + v1->v2 migration tests; Stripe ack matrix returns 200 applied/duplicate/ignored for valid signed events, 401 invalid signature, 400 malformed signed payload. Test: `source ~/.nvm/nvm.sh && nvm use 22 && pnpm exec vitest run tests/fulfillment/webhook-dedup.test.ts tests/fulfillment/sqlite-order-store.test.ts tests/fulfillment/api-webhook-endpoints.test.ts tests/fulfillment/money-integrity.test.ts` => 4 files passed, 39 tests passed. Additional: `git diff --check` => clean. Commit: e403c39.
- 2026-06-12T20:54:02Z / step-3 AC3 / PASS / `/api/order` requires shippingQuote, returns 503 `shipping_unavailable` when absent or throwing, rejects zero cost, requires exact `luluShippingLevel`+currency, returns 400 `shipping_option_unavailable` for unavailable level/currency, returns 400 `shipping_mismatch` with `serverQuote` for cost tamper, persists matched SERVER option, and uses server shipping amount/currency for PaymentIntent. Added `tests/fulfillment/wireFulfillmentDeps.ts` shared order+webhook+quality+shipping wiring and updated direct order-dep test sites. Test: `source ~/.nvm/nvm.sh && nvm use 22 && pnpm exec vitest run tests/fulfillment/money-integrity.test.ts tests/fulfillment/api-order-endpoint.test.ts tests/fulfillment/api-shipping-quote.test.ts tests/fulfillment/api-webhook-endpoints.test.ts tests/fulfillment/api-quality-claim.test.ts tests/fulfillment/security-fixes.test.ts tests/ui/station7-stripe-elements.test.ts tests/fulfillment/webhook-dedup.test.ts` => 8 files passed, 89 tests passed. Additional: `git diff --check` => clean. Commit: pending step-3 commit.
