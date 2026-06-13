# Loop-7 Goals
Base: e22f8d0
Obj: book3 story+renders on origin/main, all 11 gates PASS, score>=8

## Loop-6 Results
LANDED: feat/validation-harness (e22f8d0) — 7-probe harness + G11 + corpus C1-C5 + honest G2 baseline=79
PARTIAL: book3 story on feat/book3-story (a2121b9) — 7 beats, quality 74/100, real kimi-k2.6, NOT on main
FAILED: book3 renders — 4090 blocked; no PNGs on origin/main
DROPPED: G4 (fix/g2-ts-sweep) — gamed 97->986; superseded by fix/g2-honest (97->79)

## Goal 1 [P0] Merge book3 story branch to origin/main
Branch: feat/book3-story (a2121b9)
Action: merge feat/book3-story -> main; confirm docs/samples/book3-story.json present on origin/main
Gate: git ls-tree origin/main docs/samples/book3-story.json exits 0; jq '.beats|length' == 7; realLlmStory=true

## Goal 2 [P0] Render book3 scenes (4090-gated)
Prereq: nvidia-smi --query-gpu=memory.used --format=csv,noheader < 8000 MiB
Action: SceneRenderService 4 key scenes -> docs/samples/book3-renders/scene-{0..3}.png
Harmonize + score via LuluPdfSpec
Gate: ls docs/samples/book3-renders/*.png | wc -l >= 4; pnpm test tests/author/book3-score.test.ts green; score>=8

## Goal 3 [P1] Wire G11 probe suite to vitest (auto-regression on every commit)
Current: probes run via capture-defects.mjs (manual). G11 gate passes but defect corpus only tested via probe-corpus.test.ts.
Action: add tests/validation/probe-regression.test.ts that runs each probe against the known-defect-corpus AND the live codebase, fails on new P0/P1 findings.
Gate: G1-tests includes probe-regression suite; gate count stays 11

## Goal 4 [P2] Fix book3 renders identity contamination (scored 7/10 for multi-ref style bleed)
Prereq: Goal 2 renders exist
Action: single-ref character sheet for Wren+Hoot in scene 6 climax; re-render + re-score
Gate: climax scene score >=8; overall average >=8.5

## Done Definition (ALL required)
1. docs/samples/book3-story.json on origin/main — beats=7, realLlmStory=true
2. docs/samples/book3-renders/*.png — 4+ PNGs on origin/main
3. LuluPdfSpec score>=8 (average across all rendered scenes)
4. ALL 11 gates PASS on origin/main (G1-G11)
5. No new P0/P1 from G11 probe

## Human-only items
D1: 4090 GPU clear — run `nvidia-smi` and confirm memory.used < 8000MiB before Goal 2
D2: Narrator voice ear-pick (feat/book3-story has VOICE-PICK.md candidate list)
D3: Stripe + Lulu sandbox credentials
D4: Final PDF eyeball sign-off

## Verification commands
```bash
# story merged
git ls-tree origin/main docs/samples/book3-story.json
node -e "const b=JSON.parse(require('fs').readFileSync('docs/samples/book3-story.json','utf8')); console.assert(b.beats.length===7); console.assert(b.realLlmStory===true)"

# renders present
ls docs/samples/book3-renders/*.png | wc -l  # expect >=4

# gates
node scripts/gates/run-all.mjs  # expect ALL GATES PASS (11/11)

# score
pnpm test tests/author/book3-score.test.ts  # expect 5/5 green
```
