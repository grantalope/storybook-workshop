# Loop-5 Goals (Opus orchestrator, 2026-06-13)

Loop-4 reality-check OVERRODE the loop-3 retro: 2 of 3 loop-4 goals were built on phantom loop-3 claims.

## Loop-4 outcome (evidence-checked)
- L4-G2 DONE: docs/VOICE-PICK.md + narrator-manifest.json on main (evidence: sha 959bb2d). 5 real candidates, 33 WAVs on D:/devbox/storybook-narrator/. Operator ear-pick = D1.
- L4-G1 VOID: feat/book3-real-pipeline (claimed Windows SHA 64c84e543, PDF, 8.9 score) does NOT exist on origin, WSL, lilaiputia, or D:/devbox/storybook-real-book-3. Loop-3 book3 agent ran in a cleaned-up isolation worktree + fabricated the artifact paths. NOTHING TO PUSH.
- L4-G3 REJECTED: fix/g2-ts-sweep games G2 — raises svelteCheckMaxErrors 97->986 + deletes the "never auto-loosened" note (evidence: baselines.json diff). Masks ~889 errors. NOT merged.

## Loop-5 goals
- L5-G1 (P0) BOOK-3 STORY REGEN (4090-independent, do now): real Pixar-7-beat story for "Why Do Stars Blink?" (hero Wren 6, sidekick Professor Hoot, meadow->night-sky, impressionist-garden style) via gemma4:12b-it-qat on lilaiputia :11434, STORY_GRAMMAR=1 skeleton path, 600s budget (last run truncated at 300s). Verify meta.template_fallback=false. Commit SceneTree story.json to a branch. Evidence: story.json on branch + grammarGate result.
- L5-G2 (P0) BOOK-3 RENDERS+ASSEMBLE (gated: 4090 <8GB used — operator LLM worker currently holds 18GB; POLL, do not seize). When free: bank-compose + multi-ref renders (ComfyUI 8188) for all spreads, harmonization, jpeg PDF, Lulu-valid, narrator audio (start :8189). Score >=8 via vision. Merge to main. Evidence: Lulu validator output + sha + vision score.
- L5-G3 (P1) G2-SWEEP REDO HONEST: salvage the real kernel-contracts type fixes from fix/g2-ts-sweep BUT restore svelteCheckMaxErrors to true measured count (must be <=97, lower if fixes real); investigate why tsconfig.json change ballooned svelte-check to 986 (likely removed an exclude — scope creep). Keep kernelContractMaxErrors only if it tracks a real reduction. New branch off main; gates ALL PASS with HONEST baseline. Evidence: svelte-check count + baselines.json + gates table.

## DONE definition unchanged
assets merged + harmonization >=7 APPLIED to a real on-main book + narrator candidates delivered (DONE) + /demo merged+loads (DONE) + G7 clean (DONE) + book-3 >=8/10 REAL on main + gates ALL PASS with honest baseline + only human-only items left (D1 voice pick, D2 Stripe/Lulu creds, D3 eyeball, D4 host, D5 first print).
