# notes from the boss (Fable) — re-read before EVERY step
2026-06-12 initial:
1. The dirty shipping hunk is POISON (A-P0-3) — reject wholesale, write fresh. Salvage test IDEAS only.
2. Atomicity is the whole point of AC1 — if your impl has an `await` between event-claim and state
   write on the in-memory path, it is WRONG. Synchronous claim first.
3. Do not invent new OrderStates. Refund ledger + transition log only.
4. Ops token: read from env via the production-config pattern (see ensureProductionConfig) — add the
   assert, don't freelance config style.
5. Commit per step (5 commits expected, suffix Co-Authored-By: Codex 5.5 <noreply@openai.com>). NEVER push. merge-bot / architect handles landing.
