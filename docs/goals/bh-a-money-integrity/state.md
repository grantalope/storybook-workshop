# state — bh-a-money-integrity
EXECUTOR: update after EVERY step. Format: timestamp / step / status / evidence (test counts, shas).
RE-READ ../notes-from-the-boss.md BEFORE EVERY STEP.

## A/C checklist
- [ ] AC1 webhook dedup all 3 events, atomic, both stores, concurrency test
- [ ] AC2 ack matrix codified + tested
- [ ] AC3 shipping fail-closed + exact match + wiring helper + 5 test sites
- [ ] AC4 refund ledger + ops decision route + idempotency key
- [x] AC5 partial work reconciled (shipping hunk REJECTED per A-P0-3)
- [ ] AC6 pnpm test green + gates ALL PASS + migration tests
- [ ] AC7 HANDOFF lane row + LANE-DONE

## Log
- 2026-06-12T20:30:35Z / step-1 AC5 / PASS / order route shipping hunk rejected wholesale (no diff remains in `src/routes/api/order/+server.ts`); webhook charge.refunded lookup hunk adopted; `tests/fulfillment/money-integrity.test.ts` kept with refund regression coverage only and MAIL-level fixture fixed per A-P1-2; `tasks/codex-runs/` left uncommitted. Test: `source ~/.nvm/nvm.sh && nvm use 22 && pnpm exec vitest run tests/fulfillment/money-integrity.test.ts` => 1 file passed, 3 tests passed. Commit: pending step-1 commit.
