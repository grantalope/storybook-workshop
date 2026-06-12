# Acceptance Gates — storybook-workshop

> **No merge to main without `pnpm gates` green.**
>
> Every gate is independently runnable (`node scripts/gates/g1-tests.mjs`).
> Each exits 0 / 1 with a single result line: `GATE <id> PASS|FAIL <detail>`.
> The root runner `pnpm gates` prints a full table and exits 1 on any blocking failure.
> Allow-listed failures (known pre-existing issues) are reported as WARN — they block
> nothing today but each entry carries a TODO date for resolution.

---

## Gate Registry

| ID | Customer promise protected | Pass criteria (mechanical) | Runner command | Owner surface |
|----|---------------------------|---------------------------|---------------|---------------|
| **G1-tests** | Workshop flow (stations 1-7), story quality, illustration pipeline, book assembly, payments, subscriptions, read-along — all correct | `pnpm test` exits 0; 0 failed tests | `node scripts/gates/g1-tests.mjs` | All |
| **G2-check-ratchet** | TypeScript / Svelte types stay consistent; no new type regressions | `svelte-check` error count ≤ `svelteCheckMaxErrors` in baselines.json; improvements auto-tighten the baseline | `node scripts/gates/g2-check-ratchet.mjs` | All |
| **G3-privacy** | Kid's photo/name/address never leave device without consent; no accidental mic access | No FormData uploads outside `/api/vectorize` allowlist; no kidName in server API payloads; mic APIs only in comment-allowlisted files; `tests/privacy/` green | `node scripts/gates/g3-privacy.mjs` | Demo/photo-match, workshop stations 1-2 |
| **G4-print** | PDF meets Lulu Direct spec; file size < 60 MB; page count is a valid multiple | `tests/assemble/` green (covers LuluPdfSpecValidator + PdfBuilder golden fixtures) | `node scripts/gates/g4-print.mjs` | Book assembly / print |
| **G5-story-quality** | Story quality floor is maintained; template fallback stories score ≥ 70/100 on all rubric dimensions | 3 golden SceneTrees (gentle-glow / brave-step / giggle-quest) score: total ≥ 70, hookCoverage ≥ 0.8, refrainScore > 0, sentenceLengthFit ≥ 0.9 | `node scripts/gates/g5-story-quality.mjs` | Story quality / author pipeline |
| **G6-money** | Parents pay correct price; webhooks are idempotent; refund path exists and works | Required test files present; `tests/fulfillment/ + tests/marketing/promo*` green | `node scripts/gates/g6-money.mjs` | Payments / orders, subscriptions / gifts |
| **G7-security** | No live secrets in codebase; IDs are CSPRNG-backed; rate limiting and auth fail-closed | No `sk_live_` / `re_[key]` / `AKIA` / `ghp_` / PEM keys in `src/` + `static/`; no `Math.random()` in id-generation context without allowlist comment; security+auth+rate-limit tests green | `node scripts/gates/g7-security.mjs` | Security, payments |
| **G8-determinism** | Same inputs always produce same book; reproducible regression testing | No `Date.now()` / `new Date()` / `Math.random()` / `performance.now()` in collapse engine dirs; `tests/scenegrammar/ + tests/storygrammar/` green | `node scripts/gates/g8-determinism.mjs` | Scene grammar, story grammar |
| **G9-content-safety** | No violent/sexual/scary content reaches kids | `NEGATIVE_PROMPT` in ScenePromptComposer contains `scary` + `gore`; workflow templates have negative-prompt slot; KidsContentSafety + production-hardening suites green | `node scripts/gates/g9-content-safety.mjs` | Illustration pipeline, story quality |
| **G10-a11y** | Read-along and demo pages are accessible | No `<img>` without `alt`; no `<div on:click>` without `role` (static heuristic); TODO: playwright-axe for dynamic checks | `node scripts/gates/g10-a11y.mjs` | Read-along + phonics, demo flow |

---

## Running gates

```bash
# Run all gates (table output + overall exit code):
pnpm gates

# Run a single gate:
node scripts/gates/g1-tests.mjs
node scripts/gates/g3-privacy.mjs
# ... etc.
```

## Baseline management

`scripts/gates/baselines.json` stores two things:

1. **`svelteCheckMaxErrors`** — the ratchet value for G2. Starts at the measured baseline (143 at time of gate introduction). Automatically tightened when `pnpm gates` detects fewer errors. Never auto-loosened. To loosen manually: update the value + commit with a rationale comment.

2. **`allowFail`** — gates that are known to produce findings on existing code at time of introduction. These report as WARN (non-blocking) until resolved. Each entry requires a `reason` and `todo` field. Remove the entry once the underlying issue is fixed.

```json
{
  "svelteCheckMaxErrors": 143,
  "allowFail": [
    {
      "gate": "G3-privacy",
      "reason": "getUserMedia used in ExifStripper for camera capture (not mic); comment present",
      "todo": "Verify allowlist comment covers all camera-API usage by 2026-07-01"
    }
  ]
}
```

## Adding a gate

1. Create `scripts/gates/gN-my-gate.mjs` — must exit 0/1 and print `GATE GN-my-gate PASS|FAIL <detail>` on stdout.
2. Add an entry to the `gates` array in `scripts/gates/run-all.mjs`.
3. Add a row to the registry table above.
4. If the gate catches a pre-existing finding, add it to `allowFail` in baselines.json with reason + todo.
5. Run `pnpm gates` locally — verify the new gate appears in the table.

---

## Surface-to-gate mapping

| Product surface | Gates |
|----------------|-------|
| Workshop flow — stations 1-7 | G1, G2, G3, G7 |
| Story quality / narrative | G1, G5, G9 |
| Illustration pipeline | G1, G9 |
| Book assembly / print | G1, G4 |
| Payments / orders | G1, G6, G7 |
| Subscriptions / gifts | G1, G6 |
| Marketing funnel / email | G1, G6 |
| Read-along + phonics | G1, G10 |
| Demo / photo-match privacy | G1, G3, G7 |
| Security | G7 |
| A11y | G10 |
| Determinism | G8 |

---

## Post-mortem notes

- **G2 baseline 143**: introduced 2026-06-11; pre-existing errors include `encodePageRaster` type mismatch in pdf-jpeg-compression test, `bookCostCents` type in security-fixes test, and `better-sqlite3` types missing in sqlite-order-store test. These are test-file type errors, not production regressions — tracked separately.
- **G3 allowFail**: `getUserMedia` in `ExifStripper.ts` is the camera-capture EXIF strip path, not a microphone. The comment in the source explains this. The gate warns rather than fails while the allowlist logic matures.
