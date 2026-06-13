# Loop-3 Goals — Storybook Workshop
**Authored:** 2026-06-12
**Base SHA:** 3bc4e09 (origin/main after loop-2 harvest)
**Nearly-perfect ETA:** Gates all green + narrator WAVs generated + harmonization applied to illustrations + prop bank clean → operator only needs: voice pick (human ear), Stripe/Lulu sandbox smoke (creds), final eyeball.

---

## Loop-2 Retro

### What landed
- 150 portrait JPGs + thumbs merged (visual 8/10)
- 8 book covers merged
- /demo page live (CLIP matcher, privacy hero, FAQ, 17 tests)
- G7 Math.random fix shipped (allowFail entry removed)
- Narrator server up (5 candidates at D:/devbox/storybook-narrator/)
- Harmonization in-flight (score 7.5/10, 2 spreads done)
- Book-3 generated PDF (9/10 quality frame, but LLM/narrator/harmonization stubs)
- 1372 tests present

### What broke / is broken right now
1. **All vitest-gated gates FAIL** (G1/G4/G5/G6/G8/G9): Node 18.20.4 on lilaiputia, `@sveltejs/vite-plugin-svelte@6.2.4` requires Node ≥20 (`util.styleText`). Fix: `nvm use 22` before `pnpm gates`. Node 22 is installed at `~/.nvm/versions/node/v22.22.3`.
2. **G2 ratchet regression**: 140 errors vs 106 baseline (+34). Bulk in `src/lib/kernel-contracts/` (kernel mirror helpers, kv-cache, inference adapters) + `tests/assemble/pdf-jpeg-compression.test.ts` (`pageImageFormat`/`encodePageRaster` not on `PdfBuildInput` type). Must fix before merge.
3. **Narrator WAVs not generated**: Chatterbox blocked behind ComfyUI holding 21.8/24GB VRAM. Will unblock when ComfyUI finishes.
4. **Prop bank**: 16 green-bg props fixed by matting, compass+fishing-rod wrong content (regen queued).
5. **Harmonization**: in-flight, not yet applied to book illustrations.
6. **Book-3 real quality**: LLM story used template fallback (llama3.1:8b not installed), no real narrator audio, harmonized illustrations not applied.

---

## Goal 1 — Fix Gates (All Green on Node 22) [P0 — BLOCKER]

### Why
7 of 10 gates FAIL. No merge is credible while gates are broken. Root cause is Node version + 34 TS type regressions, not logic bugs. Fix is mechanical.

### Approach
1. On lilaiputia: add `nvm use 22` to project `.nvmrc` (or `engines.node = ">=22"`) + update CI / gate runner shebang to use nvm22. Gate script `scripts/gates/run-all.mjs` must invoke vitest under Node 22.
2. Fix G2 ratchet (+34 errors):
   - `pdf-jpeg-compression.test.ts`: add `pageImageFormat` + `encodePageRaster` to `PdfBuildInput` type in `src/lib/services/assemble/PdfBuilder.ts` (or stub them as optional `unknown` if they are test-only fields). 6 errors.
   - `src/lib/kernel-contracts/` cluster: type-fix the 52+ errors in kv-cache-os, define-kernel-mirror, inference/contracts, llm-generate, llr-fallback, etc. These are mostly missing generic params or `any`-typed stubs introduced when kernel-contracts were scaffolded. Haiku subagent sweep (mechanical).
3. Re-run `node scripts/gates/run-all.mjs` under Node 22; verify ≤106 svelte-check errors and all tests pass.
4. Update `baselines.json.svelteCheckMaxErrors` to reflect new baseline if lower.

### Done definition
`nvm exec 22 node scripts/gates/run-all.mjs` exits 0 on origin/main. G1 ✓ G2 ✓ G4 ✓ G5 ✓ G6 ✓ G8 ✓ G9 ✓ G10 ✓ (G3/G7 remain allow-listed). Commit + push. No new TS errors.

---

## Goal 2 — Narrator WAVs + Voice-Pick Handoff [P1 — customer-experience]

### Why
Read-along audio is a primary differentiator. 5 narrator candidates exist at `D:/devbox/storybook-narrator/` but spread narrations were blocked by VRAM contention (ComfyUI holding 21.8GB). Operator needs human-ear pick from 5 voices. This goal generates the WAVs so the operator CAN pick, then wires the chosen voice into book assembly.

### Approach
1. Wait for ComfyUI queue to drain (or POST `/api/comfyui/free` and confirm GPU free). `Chatterbox` needs ~3GB VRAM.
2. For each of the 5 narrator candidates, synthesize a 30-second sample from Book-3 page 1 narration script. Store at `D:/devbox/storybook-narrator/<candidate-id>/sample-p1.wav`.
3. Synthesize full page-by-page WAVs for book-3 using candidate 1 (arbitrary default until human picks). Store at `D:/devbox/storybook-real-book-3/audio/<candidate-id>/p<N>.wav`.
4. Re-roll candidate 5 (word_accuracy 0.904, garbled 'Juniper tiptoed') with seed 1056 per GPU retro note.
5. Write `D:/devbox/storybook-narrator/VOICE-PICK.md` listing 5 candidates with sample paths + word_accuracy scores. **Flag for operator human-ear pick** — agent cannot pick voice.
6. Wire chosen voice into `BundleService` (or leave a `VOICE_PICK_PENDING` constant that fails gate until set).

### Done definition
`D:/devbox/storybook-narrator/VOICE-PICK.md` exists with 5 sample paths + scores. Full WAVs exist for default candidate. `VOICE-PICK.md` committed. Human pick flag raised in retro. Candidate 5 re-rolled.

---

## Goal 3 — Harmonization Applied to Book-3 Illustrations + Prop Bank Cleanup [P1 — visual quality]

### Why
Harmonization score 7.5/10 for 2 spreads — good but not yet applied to actual book PDF. Prop bank has 2 wrong-content props (compass/fishing-rod) blocked in regen queue. These are the remaining visual-quality gaps between "demo polish" and "ship-ready."

### Approach
1. Confirm ComfyUI harmonization queue finishes for resolution spread (87s remaining from retro snapshot). Pull harmonized PNGs from output dir.
2. Re-score harmonized spreads (target: ≥8/10 from current 7.5).
3. Apply harmonized images to book-3 PDF assembly: re-run `book-3-assembler` with harmonized illustration paths. Output new PDF at `D:/devbox/storybook-real-book-3/book-3-why-do-stars-blink-harmonized.pdf`.
4. For prop bank: confirm compass+fishing-rod regen lane completes on ComfyUI. Run `matting.mjs` on output. Verify `.bank/propC/<id>/flat-painted.matted.png` is correct content. Visual spot-check those 2 props.
5. Update `propQcBad` count to 0 in retro metrics.

### Done definition
Book-3 PDF re-assembled with harmonized illustrations. Harmonization score ≥8/10 verified by re-run of scoring script. `propQcBad` = 0. Both PDFs committed (original + harmonized). Prop bank visual spot-check logged.

---

## Goal 4 — Book-3 Real LLM Story + Full Quality Run [P1 — product completeness]

### Why
Book-3 used template fallback (Pixar skeleton deterministic) because `llama3.1:8b` was not installed and `qwen2.5-coder:32b` exceeded 180s budget. A real LLM-generated story is a core product requirement and the only way to hit a consistent ≥8/10 quality score across all dimensions.

### Approach
1. Install `llama3.1:8b` on local Ollama (`OLLAMA_HOST=127.0.0.1:11434`): `ollama pull llama3.1:8b`.
2. Re-run book-3 story generation with the 180s budget and `llama3.1:8b`. Confirm story exits template path.
3. Re-run full book-3 assembly pipeline: story → illustrations (bank-compose) → harmonization → PDF → LuluPdfSpec validation.
4. Score final PDF: target ≥8/10. Record in retro.
5. Run `pnpm gates` (Node 22) — all green before committing.

### Done definition
`D:/devbox/storybook-real-book-3/book-3-why-do-stars-blink-v2.pdf` generated with real LLM story (not template), ≥8/10 quality score, LuluPdfSpec valid, all gates green. Committed.

---

## Goal 5 — G2 TS Errors Deep-Fix + Kernel-Contracts Type Audit [P2 — code health]

### Why
52+ errors in `src/lib/kernel-contracts/` are scaffolding debt introduced when kernel-mirror contracts were stubbed. Leaving them means the ratchet baseline is permanently inflated above real quality, masking future regressions. This goal takes the baseline from 140 → sub-50 (targeting ≤40).

### Approach
1. Haiku subagent sweep: for each file in `src/lib/kernel-contracts/`, identify missing type params / `any` stubs / interface mismatches. Mechanical fixes only — do not redesign kernel contracts.
2. Fix `PdfBuildInput` type to include optional `pageImageFormat` and `encodePageRaster` fields (matching what the pdf-jpeg-compression tests exercise).
3. After fixes, run `npx svelte-check` under Node 22. Target ≤40 errors.
4. Update `baselines.json.svelteCheckMaxErrors` to new count. Commit.
5. Run full gate suite — all gates green.

### Done definition
`node scripts/gates/run-all.mjs` (Node 22) passes G2 with ≤40 errors. `baselines.json` updated. No new errors introduced. Committed to main.

---

## Goal 6 — iPhone / M1 Tier Smoke Test + Stripe/Lulu Sandbox Smoke [P2 — launch readiness]

### Why
The demo loads on desktop but has not been verified on mobile (iPhone/Safari) or Apple Silicon. These are the primary customer device tiers. Stripe+Lulu sandbox smokes confirm the fulfillment path is connected — currently blocked on operator providing creds.

### Approach
**iPhone/M1 (agent-executable):**
1. Playwright test with viewport 390×844 (iPhone 14) + `userAgent: iPhone`. Verify /demo loads, CLIP matcher responds, book preview renders, no layout overflow.
2. Playwright test with viewport 1440×900 (MacBook, deviceScaleFactor: 2). Verify retina rendering, canvas elements correct.
3. Add these as `e2e/mobile-smoke.spec.ts`. Wire into G1 or as standalone G11.

**Stripe/Lulu sandbox (operator-blocked):**
1. Document exact env vars needed: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LULU_API_KEY`, `LULU_API_SECRET`. Write `tasks/sandbox-smoke-checklist.md` with step-by-step.
2. **Flag for operator:** cannot run without creds. Leave as `// TODO: operator-creds-needed` in test scaffold.

### Done definition
`e2e/mobile-smoke.spec.ts` passes (iPhone 390px + M1 1440px viewports). `tasks/sandbox-smoke-checklist.md` written. Stripe/Lulu env var list documented. Committed. Operator flag raised for creds.
