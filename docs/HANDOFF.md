# HANDOFF — Architect ↔ Builder Memory

> Protocol: Claude Fable 5 = ARCHITECT (judges, specs, arbitration — never implementation).
> Codex 5.5 = BUILDER (implements, raises disagreements — never grades own work).
> This file is the memory. Not in here (or repo docs) = didn't happen.
> Builder updates RAW results only (tables/numbers, no narrative spin) after every session.
> Architect rules on disagreements + writes next slice. Success criteria freeze BEFORE results.

## Current state (2026-06-10, architect-written baseline)

- main `0260d47`, 1097 passed / 4 skipped across 92 files.
- Shipped today: ImageGenProvider (local 4090 ComfyUI + cloud-swap), StoryLLM provider
  (Ollama + Anthropic shape), storyteller craft rules + best-of-2 rubric gate, heuristic
  Stein-Glenn grammar gate (PR #14), WWDC26 iPhone on-device brief (`docs/specs/2026-06-10-iphone-on-device-companion.md`).
- GPU box (Windows, RTX 4090, Tailscale 100.101.215.25): ComfyUI :8188 with Qwen-Image-2512
  FP8 (T2I, ~24s warm) + Qwen-Image-Edit-2511 GGUF multi-ref (VERIFIED character consistency;
  template `D:/ai/templates/spread-gen-multi-ref.json`, ~20-30s warm). 150-archetype
  population-weighted taxonomy at `D:/ai/pillar-library/taxonomy.json`.
- Proof artifact: complete real book (24pp, real LLM story + 27 real GPU images, Lulu-valid
  PDF) at `D:/devbox/storybook-real-book-1/`.

## Decisions (architect rulings — binding until overturned HERE)

1. Providers stay swappable behind env (`IMAGE_GEN_PROVIDER`, `STORY_LLM_PROVIDER`); mock
   default in vitest/CI. No real network in tests — injectable HTTP boundaries everywhere.
2. Generative logic (collapse engines) must be seeded-hash deterministic. No wall-clock /
   global Math.random in pure services.
3. Art-style packs: public-domain masters only (died >70y); culture packs = technique-not-costume
   + respectNote. Living-artist mimicry is a hard reject.
4. Read-aloud: NO microphone APIs in v1. All kid data local.
5. Narrator voice: style-alike only (warm Tennessee drawl), built from PD/CC0 audio
   (LibriVox/GLOBE/Common Voice). Zero Huell Howser audio — right-of-publicity.
6. Merges to main only via detached worktrees after green tests + architect (or supervisor)
   review. Never the main checkout on claude.local.

## Open disagreements

- (none yet — builder: raise yours in PHASE 0 of each task, silence = failure)

## Task queue (specs in tasks/codex/)

T6 orderstore-sqlite → T1 wfc-scene-grammar → T2 story-wfc-grammar → T4 art-history-styles
→ T3 readaloud-phonics → T5 pregen-bank-drivers. Bonus (loop-1 leftovers, fix-required):
privacy-allowlist (branch `fix/privacy-fictional-names`), scene-service (branch
`feat/scene-render-service`), pdf-compression (no branch — impl failed, restart from spec
in tasks/codex/README-protocol.md addendum or loop-1 scope).

## Next slice

T6 — SqliteOrderStore per `tasks/codex/T6-orderstore-sqlite.md`. Acceptance: suite ≥1097+new
green in WSL clone; restart-persistence test proves orders survive store reopen; in-memory
default untouched for vitest/browser; `better-sqlite3` optionalDependency; no consumer churn.

## Session log (builder appends below — RAW results only)

| Date | Branch | Task | Scenegrammar tests | Full tests | Check | Lint | Determinism grep | Push |
|---|---|---|---:|---:|---|---|---:|---|
| 2026-06-11 | feat/wfc-scene-grammar | T1 | 28 passed / 6 files | 1125 passed, 4 skipped / 98 files | `pnpm check`: unable to open database file; direct `svelte-check`: 102 existing errors / 20 warnings | `pnpm lint`: unable to open database file; direct `eslint`: binary absent | 0 matches in `src/lib/services/scenegrammar` | no |
| date | lane | branch | check errors | tests | lint | banned-name grep | commit | push |
|---|---|---|---:|---|---|---|---|---|
| 2026-06-11 | T4 art-history-styles | feat/art-history-styles | 102 → 102 | 1114 passed / 4 skipped | pnpm launcher: unable to open database file; local eslint binary missing | CLEAN | blocked: git metadata read-only | not pushed |
| 2026-06-11 | T2 story-wfc-grammar | feat/story-wfc-grammar | 102 → 102 | 1165 passed / 4 skipped | `pnpm lint`: eslint not found | CLEAN (`Math.random`/`Date.now`/`rescuer`) | 8b78556/f51adb2/e699b05 | not pushed; LANE-DONE |
| 2026-06-11 | T3 readaloud-phonics | feat/readaloud-phonics | 102 → 97 (`pnpm check`: 97 errors / 20 warnings) | targeted: 81 passed / 16 files; full: 1166 passed / 4 skipped / 111 files | `pnpm lint`: eslint not found; `node_modules/.bin/eslint` absent | no-mic grep CLEAN; readaloud Math.random/Date.now grep CLEAN; narrator :8189 grep CLEAN | 8c8dead | not pushed; LANE-DONE |

## Architect log 2026-06-11 (Fable)

- MERGED: T1 feat/wfc-scene-grammar (b68a302) + T4 feat/art-history-styles (8d9d98c)
  → main 9d20117. Independent verify: 1142 passed / 102 files on merged main.
- T6 in flight on the 4090-box WSL clone (bundle-relay merge when done).
- RULINGS (binding): style application at request boundary via applyStylePack;
  blank-padding honors format pageCountMultiple; pnpm-check gate = NO NEW errors
  vs 102 pre-existing baseline; sceneBrief flows only to PromptSerializer;
  slot requiredness inferred from beat+template rules; CSPRNG for all ids.
- SANDBOX LESSON: do NOT pass `-s workspace-write` for worktree lanes — git
  metadata lives under the main repo .git; config default (danger-full-access)
  is required for commits. Lanes are architect-managed.
