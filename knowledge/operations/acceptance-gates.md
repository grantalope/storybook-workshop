---
type: Runbook
title: Acceptance Gates
description: 11-gate CI suite run via node scripts/gates/run-all.mjs; must pass before any demo deploy.
tags: [ci, gates, quality, testing]
timestamp: 2026-06-13T00:00:00Z
script: scripts/gates/run-all.mjs
gate_count: 11
---

# Acceptance Gates

```bash
cd ~/devbox/storybook-workshop-probe-regression
node scripts/gates/run-all.mjs
```

All 11 gates must pass (or meet gate-specific WARN threshold) before deploying to demo. See [run the demo](/operations/run-the-demo.md).

## Gate Roster

| ID | Name | Pass Criteria |
|----|------|---------------|
| G1 | Tests | 1416 tests pass across 140 files |
| G2 | svelte-check ratchet | Error count ≤ baseline in `scripts/gates/baselines.json` (currently 70); auto-tightens on improvement — never game it |
| G3 | Privacy | No PII leaks in generated output |
| G4 | Print | Print layout renders correctly |
| G5 | Story quality | Narrative output meets quality floor |
| G6 | Money | Financial calculation correctness |
| G7 | Security | `Math.random()` in id/token/key context = **FAIL** unless marked as crypto-fallback (-> WARN); `crypto.getRandomValues` + `crypto.randomUUID` recognized as crypto-grade = PASS |
| G8 | Determinism | Same inputs -> same outputs across runs |
| G9 | Content safety | Output passes content safety checks |
| G10 | a11y | Accessibility violations below threshold |
| G11 | Logic gaps | No detected logic gaps in flow |

## G2 Ratchet Rule

Baseline stored in `scripts/gates/baselines.json`. Gate fails if current count exceeds baseline. On improvement (count decreases), baseline auto-tightens to new count. **Never manually edit baselines.json to hide errors** — that defeats the ratchet.

## G7 Security Detail

- `Math.random()` near string `id`, `token`, `key`, `secret`, `nonce` -> **FAIL**
- `Math.random()` with comment `// crypto-fallback` -> **WARN** (tolerated)
- `crypto.getRandomValues(...)` -> PASS
- `crypto.randomUUID()` -> PASS (secure-context only — see [plain HTTP constraints](/operations/plain-http-constraints.md))

## Related

- [Run the Demo](/operations/run-the-demo.md)
- [Plain HTTP Constraints](/operations/plain-http-constraints.md)
