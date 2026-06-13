# Loop-6 Goals
Base: 456ce10
Obj: book3 real story+renders+score>=8 merged to origin/main

## Loop-5 Results
LANDED: fix/g2-honest merged (456ce10), 10/10 gates PASS, G2 honest baseline=97
FAILED: book3 story gen timed out (660s monolithic; 960s per-beat), no output written
FAILED: book3 renders skipped (4090 at 18249MiB, threshold 8000MiB, operator worker active)
MISSING: feat/book3-real-pipeline never pushed (Windows path D:/devbox/storybook-workshop lost)

## Loop-6 Results (retro 2026-06-13)
LANDED: feat/validation-harness merged (e22f8d0) — 7-probe harness + corpus (5 defect classes) + G11 gate
LANDED: G2 honest baseline re-ratcheted 97->79 (harness evidence-honesty probe auto-catches future regressions)
PARTIAL: book3 story generated on feat/book3-story (a2121b9) — 7 beats, grammar 0.93, quality 74/100, real LLM (kimi-k2.6) — NOT merged to origin/main
FAILED: book3 renders — 4090 blocked (render.merged in retro input refers to render branch attempt, not origin/main; no PNGs on origin/main)
FAILED: G11 appeared unwired in stale checkout; confirmed wired+passing on origin/main after checkout fix
NOTE: local main was on docs/loop-4-goals during loop-6 gate runs — gates showed 10/10 not 11/11; real origin/main has 11/11 PASS

## Goal 1 [P0] Generate book3 story via per-beat LLM
Use OLLAMA_HOST=127.0.0.1:11500 qwen2.5-coder:7b, 120s per beat, sync HTTP
Write: docs/samples/book3-story.json
Gate: beats.length===7 AND realLlmStory===true AND gates ALL PASS
STATUS: DONE on feat/book3-story — needs merge to origin/main in loop-7

## Goal 2 [P0] Render book3 scenes
Prereq: nvidia-smi memory.used < 8000MiB
SceneRenderService 7 scenes -> harmonization -> LuluPdfSpec
Write: docs/samples/book3-renders/scene-{0..6}.png
Gate: 7+ PNGs on origin/main, G4-print PASS, score>=8
STATUS: BLOCKED (4090 busy) — carry to loop-7

## Goal 3 [P1] Merge VOICE-PICK.md (human-blocked: operator must pick narrator voice first)

## Goal 4 [P2] Tighten G2 baseline (fix/g2-ts-sweep on origin; review conflicts vs baseline=97)
STATUS: DROPPED-superseded — fix/g2-ts-sweep gamed baseline (97->986 errors, rejected).
fix/g2-honest landed instead (97->79 honest). G4 branch is dead; g2-honest already beat it.
G2 baseline is now 79 on origin/main — no further tightening needed this cycle.

## Done Definition (ALL required)
1. docs/samples/book3-story.json on origin/main, beats=7, realLlmStory=true
2. docs/samples/book3-renders/ 7+ PNGs on origin/main
3. G4-print PASS + LuluPdfSpec score>=8
4. ALL 11 gates PASS (G1-G11)

## Human-only items
D1: Confirm feat/book3-real-pipeline SHA 64c84e543 on any local machine; push to origin if found
D2: Narrator voice ear-pick
D3: Stripe + Lulu sandbox credentials
D4: Final PDF eyeball sign-off
