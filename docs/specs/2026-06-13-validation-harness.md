# Validation Harness — Actionable Defect Capture (orchestrator infra)

Beyond PASS/FAIL gates: intelligently confirm code + capture ERRORS and LOGIC GAPS in a
worker-feedable form. This is the feedback loop's mechanical-truth layer and the enforcement
arm of the orchestrator's standards mandate — no work is "done" until this confirms it.

## Output contract (the worker-feedable artifact)
`scripts/validation/capture-defects.mjs` runs everything + emits `tasks/defects/latest.json`:

    [{ id, category, severity: "P0"|"P1"|"P2"|"P3", file, line|null,
       evidence,        // raw error / probe output — NEVER paraphrased
       logicGap,        // 1-line human description of the gap
       suggestedFix,    // concrete change
       workerHint,      // exact instruction a worker can execute
       suggestedLane,   // "free-cloud" | "gpu-4090" (P2) | "sonnet-review"
       confidence }]    // 0..1

Plus `tasks/defects/latest.md` (operator-readable). This JSON IS a worker task list — each item
is directly dispatchable to a lane. Orchestrator triages, lanes fix, re-run, defects clear.

## Sources aggregated
1. vitest JSON reporter to failing tests {file, test, assertion, expected, actual}.
2. svelte-check to TS errors {file, line, code, msg}.
3. gate suite (run-all.mjs) to {gate, detail}.
4. PROBES below — the intelligent layer that catches what tests DO NOT.

## Probes (scripts/validation/probes/*.mjs — pure, AST/regex/graph)
- webhook-completeness: every Stripe/Lulu event type in a handler switch has (a) a handler,
  (b) dedup via applyStripeWebhookEventOnce, (c) an ack-matrix branch (200/4xx/5xx). Flag
  handled-but-undeduped.
- money-invariants: price ALWAYS server-computed; no client costCents reaches PaymentIntent;
  refund path carries an Idempotency-Key. Flag any client-trusted money value.
- privacy-egress: every outbound fetch/XHR with a body goes to an allowlisted internal
  endpoint OR is provably scrubbed. Flag kid-name/photo/PII egress and any mic API.
- state-machine-integrity: order/subscription FSM has no unreachable states, no absorbing
  non-terminal states, and every state has at least one defined outbound transition.
- interface-completeness: any class typed as OrderStore/WebhookOrderStore/TtsProvider/etc
  implements ALL interface methods (no partial stubs that only compile via any).
- wiring-orphans: every service under src/lib/services is imported + called somewhere (no
  dead code); inverse: every referenced service file exists.
- evidence-honesty: THE ANTI-LIE PROBE. Scan docs/HANDOFF.md + docs/goals/*/state.md for
  claims of "merged|sha <hex>" and verify each sha exists on origin (git cat-file -e); flag
  fabricated shas. Cross-check any claimed "N tests pass" vs the live vitest count. Directly
  catches the loop-3 book3-vapor + g2 baseline-gaming failure class.

## Integration
- New gate G11-logic-gaps in run-all.mjs: runs probes; FAIL on any P0/P1 logic gap;
  report-only for P2/P3.
- `pnpm validate` to capture-defects.mjs (full non-failing report — for the orchestrator).
- Orchestrator loop: each pass runs `pnpm validate`, reads latest.json, dispatches P0/P1
  defects to lanes (suggestedLane routes them), re-runs to confirm clear.

## Build (delegate typing to lanes; orchestrator reviews)
Each probe = one focused file with unit tests (good + bad fixtures). Implement via free-cloud
lanes (P1 — tooling, no secrets). Orchestrator REVIEWS each probe against a known-defect corpus
before wiring G11. The corpus (each MUST be caught):
  C1. a fabricated merge sha in a state.md (evidence-honesty)
  C2. baselines.json svelteCheckMaxErrors raised vs prior (a ratchet-gaming guard — evidence-honesty/gate)
  C3. a class implementing OrderStore but missing getByLuluJob (interface-completeness)
  C4. a fetch POSTing kidFirstName to a non-allowlisted host (privacy-egress)
  C5. a Stripe event handled with no applyStripeWebhookEventOnce call (webhook-completeness)
A probe that misses its corpus case = reject + re-spec. The corpus lives at
tests/validation/known-defect-corpus/ as fixtures.
