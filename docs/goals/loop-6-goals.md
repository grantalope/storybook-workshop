# Loop-6 Goals
Base: 456ce10
Obj: book3 real story+renders+score>=8 merged to origin/main

## Loop-5 Results
LANDED: fix/g2-honest merged (456ce10), 10/10 gates PASS, G2 honest baseline=97
FAILED: book3 story gen timed out (660s monolithic; 960s per-beat), no output written
FAILED: book3 renders skipped (4090 at 18249MiB, threshold 8000MiB, operator worker active)
MISSING: feat/book3-real-pipeline never pushed (Windows path D:/devbox/storybook-workshop lost)

## Goal 1 [P0] Generate book3 story via per-beat LLM
Use OLLAMA_HOST=127.0.0.1:11500 qwen2.5-coder:7b, 120s per beat, sync HTTP
Write: docs/samples/book3-story.json
Gate: beats.length===7 AND realLlmStory===true AND gates ALL PASS

## Goal 2 [P0] Render book3 scenes
Prereq: nvidia-smi memory.used < 8000MiB
SceneRenderService 7 scenes -> harmonization -> LuluPdfSpec
Write: docs/samples/book3-renders/scene-{0..6}.png
Gate: 7+ PNGs on origin/main, G4-print PASS, score>=8

## Goal 3 [P1] Merge VOICE-PICK.md (human-blocked: operator must pick narrator voice first)

## Goal 4 [P2] Tighten G2 baseline (fix/g2-ts-sweep on origin; review conflicts vs baseline=97)

## Done Definition (ALL required)
1. docs/samples/book3-story.json on origin/main, beats=7, realLlmStory=true
2. docs/samples/book3-renders/ 7+ PNGs on origin/main
3. G4-print PASS + LuluPdfSpec score>=8
4. ALL 10 gates PASS

## Human-only items
D1: Confirm feat/book3-real-pipeline SHA 64c84e543 on any local machine; push to origin if found
D2: Narrator voice ear-pick
D3: Stripe + Lulu sandbox credentials
D4: Final PDF eyeball sign-off
