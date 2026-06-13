# Loop-4 Goals — Storybook Workshop
**Authored:** 2026-06-13
**Base SHA:** 9889cc7 (origin/main after loop-3 harvest)
**Loop objective:** Merge Windows-side artifacts (book-3 pipeline, narrator WAVs, VOICE-PICK.md) to main → close done-definition → declare done or scope loop-5.

---

## Loop-3 Retro Summary

### What landed
- G1 gates ALL PASS (10/10) on Node 22 — confirmed 2026-06-13
- /demo merged + mobile smoke passing (feat/mobile-smoke → 9889cc7)
- G7 clean (no unsafe Math.random in id-gen)
- assets merged (150 portraits + book covers)
- G2 baseline tightened 140→97

### What is built but NOT merged
1. **book-3 real pipeline**: `feat/book3-real-pipeline` exists locally on Windows at `D:/devbox/storybook-workshop` SHA 64c84e543 — real LLM story (gemma4:12b-it-qat), real ComfyUI renders, harmonization applied (score 8/10), narrator audio bundled, LuluPdfSpec valid, qualityScore=8.9. PDF at `D:/devbox/storybook-real-book-3/book3-real.pdf`. NEVER pushed to remote → king merge pending.
2. **Narrator WAVs + VOICE-PICK.md**: 30 WAVs generated (5 candidates × 6 spreads), VOICE-PICK.md written at `D:/devbox/storybook-narrator/VOICE-PICK.md` per loop-3 retro. Not committed to any branch.
3. **G2 sweep**: `fix/g2-ts-sweep` branch exists on origin (errors_before=45, errors_after=31) but NOT merged.

### Human-only remaining (cannot auto-execute)
- Narrator voice ear-pick: listen samples in VOICE-PICK.md → pick voice ID → unblocks C4 (BundleService wiring)
- Stripe + Lulu sandbox credentials → C2/C6
- Final book eyeball + quality sign-off
- Production host + domain decisions

---

## Goal 1 — Push + Merge feat/book3-real-pipeline to origin/main [P0 — done-definition blocker]

### Why
Done-definition requires book-3 ≥8/10 with real story+renders. All evidence exists (qualityScore=8.9, realLlmStory=true, realRenders=true, harmonizationApplied=true, narratorAudioBundled=true, luluValid=true) but the branch never reached origin. Without a merge SHA this criterion is unverified by any independent agent.

### Approach
1. On Windows (`d:/devbox/storybook-workshop`): `git log feat/book3-real-pipeline --oneline -5` — confirm SHA 64c84e543 exists and has the expected commits.
2. Push branch: `git push origin feat/book3-real-pipeline`.
3. Verify origin has it: `git ls-remote origin | grep book3`.
4. On lilaiputia: `git fetch origin feat/book3-real-pipeline`.
5. Detached-merge to main:
   ```bash
   git worktree add /tmp/sw-merge-book3 --detach origin/main
   git -C /tmp/sw-merge-book3 merge --no-ff origin/feat/book3-real-pipeline -m "Merge feat/book3-real-pipeline — book-3 real story+renders+harmonize+audio (8.9/10)"
   # Run gates first
   source ~/.nvm/nvm.sh && nvm use 22 && node scripts/gates/run-all.mjs
   git -C /tmp/sw-merge-book3 push origin HEAD:main
   git worktree remove /tmp/sw-merge-book3
   ```
6. Verify: `git log origin/main --oneline -3 | grep book3`.

### Verification commands
```bash
# On Windows first:
git -C D:/devbox/storybook-workshop log feat/book3-real-pipeline --oneline -5
git -C D:/devbox/storybook-workshop push origin feat/book3-real-pipeline
# On lilaiputia:
ssh grantalope@100.104.9.90 "cd ~/devbox/storybook-workshop && source ~/.nvm/nvm.sh && nvm use 22 && git fetch origin feat/book3-real-pipeline && git log origin/feat/book3-real-pipeline --oneline -3"
ssh grantalope@100.104.9.90 "cd ~/devbox/storybook-workshop && source ~/.nvm/nvm.sh && nvm use 22 && node scripts/gates/run-all.mjs 2>&1 | tail -5"
```

### Done definition
`git log origin/main --oneline -5 | grep book3` exits 0 with a merge commit. `node scripts/gates/run-all.mjs` ALL PASS post-merge. Merge SHA recorded.

---

## Goal 2 — Commit VOICE-PICK.md + Narrator Manifest to main [P1 — handoff completeness]

### Why
VOICE-PICK.md is the operator handoff artifact for the voice ear-pick (human-only task D1). Without it on main, the operator has no discoverable path to the samples. Narrator WAVs are large binaries — commit the manifest (paths + word_accuracy scores) not the raw WAVs.

### Approach
1. On Windows: read `D:/devbox/storybook-narrator/VOICE-PICK.md`.
2. Copy VOICE-PICK.md into `docs/VOICE-PICK.md` in a new branch `feat/voice-pick-handoff`.
3. If a narrator manifest JSON exists (`narrator-manifest.json` with candidate paths + scores), include it at `static/narrator-manifest.json`.
4. Commit: `feat(narrator): VOICE-PICK.md + narrator manifest — 5 candidates, word_accuracy scores, ear-pick instructions`
5. Push to origin. Merge via detached worktree (gates must pass — no WAVs in repo, so G1 unaffected).
6. Verify: `git show origin/main:docs/VOICE-PICK.md | head -20`.

### Verification commands
```bash
ssh grantalope@100.104.9.90 "cd ~/devbox/storybook-workshop && git show origin/main:docs/VOICE-PICK.md | head -20"
ssh grantalope@100.104.9.90 "cd ~/devbox/storybook-workshop && source ~/.nvm/nvm.sh && nvm use 22 && node scripts/gates/run-all.mjs 2>&1 | tail -5"
```

### Done definition
`git show origin/main:docs/VOICE-PICK.md` returns content with ≥5 candidate entries. Gates ALL PASS post-merge. Operator notified (D1 human flag raised).

---

## Goal 3 — Merge fix/g2-ts-sweep + Update Baseline [P1 — code health]

### Why
`fix/g2-ts-sweep` is already on origin (errors 45→31) but unmerged. Tightening the ratchet baseline reduces future noise. Not a blocker but improves G2 health.

### Approach
1. Fetch + review: `git log origin/fix/g2-ts-sweep --oneline -5`.
2. Detached merge: same worktree pattern as Goal 1.
3. Update `scripts/gates/baselines.json` `svelteCheckMaxErrors` to 31 (or current actual after merge).
4. Run gates — verify G2 PASS with new baseline.
5. Commit baseline update if not already in branch. Merge + push.

### Verification commands
```bash
ssh grantalope@100.104.9.90 "cd ~/devbox/storybook-workshop && source ~/.nvm/nvm.sh && nvm use 22 && node scripts/gates/g2-check-ratchet.mjs 2>&1"
ssh grantalope@100.104.9.90 "cd ~/devbox/storybook-workshop && cat scripts/gates/baselines.json | grep svelteCheck"
```

### Done definition
`node scripts/gates/run-all.mjs` ALL PASS. G2 baseline ≤31. Merge SHA on origin/main.

---

## Loop-4 Done Definition (ALL required)
1. `feat/book3-real-pipeline` merged to origin/main with gates passing — evidence: merge SHA
2. `docs/VOICE-PICK.md` on origin/main — evidence: `git show` output
3. `fix/g2-ts-sweep` merged, baseline ≤31 — evidence: G2 gate output
4. All 10 gates PASS post all merges — evidence: `run-all.mjs` output
5. `docs/goals/loop-final-summary.md` committed if ALL done-definition items met; else `loop-5-goals.md`

Human-only remaining (surface to operator, do not block loop exit):
- D1: narrator voice ear-pick (samples in docs/VOICE-PICK.md)
- D2: Stripe + Lulu sandbox creds
- D3: book-3 + /demo eyeball
- D4: production host + domain
- D5: first real print order
