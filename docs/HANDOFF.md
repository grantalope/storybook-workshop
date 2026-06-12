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
| 2026-06-11 | feat/scene-render-service | scene-service LANE-DONE | scenerender 22 passed / 3 files | 1188 passed, 4 skipped / 107 files | `pnpm check`: 102 existing errors / 20 warnings (no new vs baseline 102) | `pnpm lint`: `eslint` binary absent | 0 matches in `src/lib/services/scenerender` | no |
| 2026-06-11 | feat/scene-render-service | scene-service LANE-DONE | scenerender+imagegen 62 passed / 6 files | 1188 passed, 4 skipped / 107 files | `pnpm check`: 102 existing errors / 20 warnings (no new vs baseline 102) | `pnpm lint`: `eslint` binary absent | 0 matches in `src/lib/services/scenerender` | no |
| 2026-06-11 | feat/scene-render-service | scene-service LANE-DONE | scenerender+imagegen 91 passed / 10 files | 1188 passed, 4 skipped / 107 files | `pnpm check`: 102 existing errors / 20 warnings (no new vs baseline 102) | `pnpm lint`: `eslint` binary absent | 0 matches in `src/lib/services/scenerender` | no |
| 2026-06-11 | feat/scene-render-service | scene-service LANE-DONE | scenerender+imagegen+stylepacks focused 65 passed / 7 files | 1188 passed, 4 skipped / 107 files | `pnpm check`: 102 existing errors / 20 warnings (no new vs baseline 102) | `pnpm lint`: `eslint` binary absent | 0 matches in `src/lib/services/scenerender` | no |
| date | lane | branch | check errors | tests | lint | banned-name grep | commit | push |
|---|---|---|---:|---|---|---|---|---|
| 2026-06-11 | T4 art-history-styles | feat/art-history-styles | 102 → 102 | 1114 passed / 4 skipped | pnpm launcher: unable to open database file; local eslint binary missing | CLEAN | blocked: git metadata read-only | not pushed |
| 2026-06-11 | T2 story-wfc-grammar | feat/story-wfc-grammar | 102 → 102 | 1165 passed / 4 skipped | `pnpm lint`: eslint not found | CLEAN (`Math.random`/`Date.now`/`rescuer`) | 8b78556/f51adb2/e699b05 | not pushed; LANE-DONE |
| 2026-06-11 | T3 readaloud-phonics | feat/readaloud-phonics | 102 → 97 (`pnpm check`: 97 errors / 20 warnings) | targeted: 81 passed / 16 files; full: 1166 passed / 4 skipped / 111 files | `pnpm lint`: eslint not found; `node_modules/.bin/eslint` absent | no-mic grep CLEAN; readaloud Math.random/Date.now grep CLEAN; narrator :8189 grep CLEAN | 8c8dead | not pushed; LANE-DONE |
| 2026-06-11 | T5 pregen-bank-drivers LANE-DONE | feat/pregen-bank-drivers | 102 → 102 | pregen 15 passed / 5 files; full 1157 passed, 4 skipped / 107 files | `pnpm lint`: eslint not found | 0 `Math.random`/`Date.now`/`randomUUID`; 0 live-GPU URL in executable scripts | 08a8239..992eceb + handoff | not pushed |

| date | lane | branch | check errors | fulfillment tests | full tests | lint | SQL/CSPRNG grep | commits | push | status |
|---|---|---|---:|---|---|---|---|---|---|---|
| 2026-06-11 | T6 orderstore-sqlite | feat/orderstore-sqlite | 102 → 102 | 168 passed / 16 files / 0 skipped | 1163 passed, 4 skipped / 104 files | eslint missing | SQL interpolation 0; executable Math.random 0 | acccc88, a9ce39f, 1b04f9e | no | LANE-DONE |
| 2026-06-11 | privacy-allowlist LANE-DONE | fix/privacy-fictional-names | 102 → 102 (20 warnings) | 1164 passed / 4 skipped / 103 files | `pnpm lint`: eslint not found | CLEAN (source diff real-PII grep; `allowNames` only privacy + author scene-render path) | c3b5c18 | not pushed |
| 2026-06-11 | privacy-allowlist LANE-DONE | fix/privacy-fictional-names | 102 → 102 (20 warnings) | 1166 passed / 4 skipped / 103 files | `pnpm lint`: eslint not found | CLEAN (source added-line real-PII grep; `allowNames` only privacy + author scene-render path) | ded65d0 | not pushed |

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

| date | lane | branch | id | bytes | status |
|---|---|---|---|---:|---|
| 2026-06-12 | example-books | feat/img-books | p002/cover.jpg | 552354 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p002/hero-portrait.jpg | 460078 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p002/spread-climax.jpg | 648029 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p002/spread-midpoint.jpg | 647687 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p002/spread-resolution.jpg | 519929 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p002/spread-setup.jpg | 519804 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p002/spread-trial.jpg | 568278 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p002/story.json | 3516 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p005/cover.jpg | 441319 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p005/hero-portrait.jpg | 400786 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p005/spread-climax.jpg | 470137 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p005/spread-midpoint.jpg | 453146 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p005/spread-resolution.jpg | 458634 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p005/spread-setup.jpg | 457544 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p005/spread-trial.jpg | 457094 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p005/story.json | 3342 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p011/cover.jpg | 709032 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p011/hero-portrait.jpg | 493856 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p011/spread-climax.jpg | 685340 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p011/spread-midpoint.jpg | 672895 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p011/spread-resolution.jpg | 674908 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p011/spread-setup.jpg | 571114 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p011/spread-trial.jpg | 528781 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p011/story.json | 3323 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p024/cover.jpg | 677149 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p024/hero-portrait.jpg | 555712 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p024/spread-climax.jpg | 697897 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p024/spread-midpoint.jpg | 664935 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p024/spread-resolution.jpg | 584099 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p024/spread-setup.jpg | 673350 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p024/spread-trial.jpg | 666577 | LANE-DONE |
| 2026-06-12 | example-books | feat/img-books | p024/story.json | 3266 | LANE-DONE |

| date | lane | branch | id | bytes | status |
|---|---|---|---|---:|---|
| 2026-06-12 | example-books-resume-verify | feat/img-books | p002/cover.jpg | 552354 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p002/hero-portrait.jpg | 460078 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p002/spread-climax.jpg | 648029 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p002/spread-midpoint.jpg | 647687 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p002/spread-resolution.jpg | 519929 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p002/spread-setup.jpg | 519804 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p002/spread-trial.jpg | 568278 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p002/story.json | 3516 | LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p005/cover.jpg | 441319 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p005/hero-portrait.jpg | 400786 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p005/spread-climax.jpg | 470137 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p005/spread-midpoint.jpg | 453146 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p005/spread-resolution.jpg | 458634 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p005/spread-setup.jpg | 457544 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p005/spread-trial.jpg | 457094 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p005/story.json | 3342 | LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p011/cover.jpg | 709032 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p011/hero-portrait.jpg | 493856 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p011/spread-climax.jpg | 685340 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p011/spread-midpoint.jpg | 672895 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p011/spread-resolution.jpg | 674908 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p011/spread-setup.jpg | 571114 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p011/spread-trial.jpg | 528781 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p011/story.json | 3323 | LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p024/cover.jpg | 677149 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p024/hero-portrait.jpg | 555712 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p024/spread-climax.jpg | 697897 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p024/spread-midpoint.jpg | 664935 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p024/spread-resolution.jpg | 584099 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p024/spread-setup.jpg | 673350 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p024/spread-trial.jpg | 666577 | RESUME-SKIP LANE-DONE |
| 2026-06-12 | example-books-resume-verify | feat/img-books | p024/story.json | 3266 | LANE-DONE |

| date | lane | branch | id | bytes | status |
|---|---|---|---|---:|---|
| 2026-06-12 | example-books-final-verify | feat/img-books | p002/cover.jpg | 552354 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p002/hero-portrait.jpg | 460078 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p002/spread-climax.jpg | 648029 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p002/spread-midpoint.jpg | 647687 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p002/spread-resolution.jpg | 519929 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p002/spread-setup.jpg | 519804 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p002/spread-trial.jpg | 568278 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p002/story.json | 3516 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p005/cover.jpg | 441319 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p005/hero-portrait.jpg | 400786 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p005/spread-climax.jpg | 470137 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p005/spread-midpoint.jpg | 453146 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p005/spread-resolution.jpg | 458634 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p005/spread-setup.jpg | 457544 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p005/spread-trial.jpg | 457094 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p005/story.json | 3342 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p011/cover.jpg | 709032 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p011/hero-portrait.jpg | 493856 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p011/spread-climax.jpg | 685340 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p011/spread-midpoint.jpg | 672895 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p011/spread-resolution.jpg | 674908 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p011/spread-setup.jpg | 571114 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p011/spread-trial.jpg | 528781 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p011/story.json | 3323 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p024/cover.jpg | 677149 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p024/hero-portrait.jpg | 555712 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p024/spread-climax.jpg | 697897 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p024/spread-midpoint.jpg | 664935 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p024/spread-resolution.jpg | 584099 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p024/spread-setup.jpg | 673350 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p024/spread-trial.jpg | 666577 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-final-verify | feat/img-books | p024/story.json | 3266 | RESUME-SKIP VISUAL-OK LANE-DONE |

| date | lane | branch | id | bytes | status |
|---|---|---|---|---:|---|
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p002/cover.jpg | 552354 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p002/hero-portrait.jpg | 460078 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p002/spread-climax.jpg | 648029 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p002/spread-midpoint.jpg | 647687 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p002/spread-resolution.jpg | 519929 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p002/spread-setup.jpg | 519804 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p002/spread-trial.jpg | 568278 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p002/story.json | 3516 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p005/cover.jpg | 441319 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p005/hero-portrait.jpg | 400786 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p005/spread-climax.jpg | 470137 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p005/spread-midpoint.jpg | 453146 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p005/spread-resolution.jpg | 458634 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p005/spread-setup.jpg | 457544 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p005/spread-trial.jpg | 457094 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p005/story.json | 3342 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p011/cover.jpg | 709032 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p011/hero-portrait.jpg | 493856 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p011/spread-climax.jpg | 685340 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p011/spread-midpoint.jpg | 672895 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p011/spread-resolution.jpg | 674908 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p011/spread-setup.jpg | 571114 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p011/spread-trial.jpg | 528781 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p011/story.json | 3323 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p024/cover.jpg | 677149 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p024/hero-portrait.jpg | 555712 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p024/spread-climax.jpg | 697897 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p024/spread-midpoint.jpg | 664935 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p024/spread-resolution.jpg | 584099 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p024/spread-setup.jpg | 673350 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p024/spread-trial.jpg | 666577 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-idempotent-verify | feat/img-books | p024/story.json | 3266 | JSON-OK LANE-DONE |

| date | lane | branch | id | bytes | status |
|---|---|---|---|---:|---|
| 2026-06-12 | example-books-codex55-final | feat/img-books | p002/cover.jpg | 552354 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p002/hero-portrait.jpg | 460078 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p002/spread-climax.jpg | 648029 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p002/spread-midpoint.jpg | 647687 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p002/spread-resolution.jpg | 519929 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p002/spread-setup.jpg | 519804 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p002/spread-trial.jpg | 568278 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p002/story.json | 3516 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p005/cover.jpg | 441319 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p005/hero-portrait.jpg | 400786 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p005/spread-climax.jpg | 470137 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p005/spread-midpoint.jpg | 453146 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p005/spread-resolution.jpg | 458634 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p005/spread-setup.jpg | 457544 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p005/spread-trial.jpg | 457094 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p005/story.json | 3342 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p011/cover.jpg | 709032 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p011/hero-portrait.jpg | 493856 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p011/spread-climax.jpg | 685340 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p011/spread-midpoint.jpg | 672895 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p011/spread-resolution.jpg | 674908 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p011/spread-setup.jpg | 571114 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p011/spread-trial.jpg | 528781 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p011/story.json | 3323 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p024/cover.jpg | 677149 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p024/hero-portrait.jpg | 555712 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p024/spread-climax.jpg | 697897 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p024/spread-midpoint.jpg | 664935 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p024/spread-resolution.jpg | 584099 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p024/spread-setup.jpg | 673350 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p024/spread-trial.jpg | 666577 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-final | feat/img-books | p024/story.json | 3266 | JSON-OK LANE-DONE |

| date | lane | branch | id | bytes | status |
|---|---|---|---|---:|---|
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p002/cover.jpg | 552354 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p002/hero-portrait.jpg | 460078 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p002/spread-climax.jpg | 648029 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p002/spread-midpoint.jpg | 647687 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p002/spread-resolution.jpg | 519929 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p002/spread-setup.jpg | 519804 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p002/spread-trial.jpg | 568278 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p002/story.json | 3516 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p005/cover.jpg | 441319 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p005/hero-portrait.jpg | 400786 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p005/spread-climax.jpg | 470137 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p005/spread-midpoint.jpg | 453146 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p005/spread-resolution.jpg | 458634 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p005/spread-setup.jpg | 457544 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p005/spread-trial.jpg | 457094 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p005/story.json | 3342 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p011/cover.jpg | 709032 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p011/hero-portrait.jpg | 493856 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p011/spread-climax.jpg | 685340 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p011/spread-midpoint.jpg | 672895 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p011/spread-resolution.jpg | 674908 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p011/spread-setup.jpg | 571114 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p011/spread-trial.jpg | 528781 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p011/story.json | 3323 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p024/cover.jpg | 677149 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p024/hero-portrait.jpg | 555712 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p024/spread-climax.jpg | 697897 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p024/spread-midpoint.jpg | 664935 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p024/spread-resolution.jpg | 584099 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p024/spread-setup.jpg | 673350 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p024/spread-trial.jpg | 666577 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-closeout | feat/img-books | p024/story.json | 3266 | JSON-OK LANE-DONE |

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-resume-verify, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-idempotent-closeout, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-current-idempotent-verify, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-image-builder-verify, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-resume-fresh-verify, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

| date | lane | branch | id | bytes | status |
|---|---|---|---|---:|---|
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p002/cover.jpg | 552354 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p002/hero-portrait.jpg | 460078 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p002/spread-climax.jpg | 648029 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p002/spread-midpoint.jpg | 647687 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p002/spread-resolution.jpg | 519929 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p002/spread-setup.jpg | 519804 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p002/spread-trial.jpg | 568278 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p002/story.json | 3516 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p005/cover.jpg | 441319 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p005/hero-portrait.jpg | 400786 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p005/spread-climax.jpg | 470137 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p005/spread-midpoint.jpg | 453146 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p005/spread-resolution.jpg | 458634 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p005/spread-setup.jpg | 457544 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p005/spread-trial.jpg | 457094 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p005/story.json | 3342 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p011/cover.jpg | 709032 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p011/hero-portrait.jpg | 493856 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p011/spread-climax.jpg | 685340 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p011/spread-midpoint.jpg | 672895 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p011/spread-resolution.jpg | 674908 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p011/spread-setup.jpg | 571114 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p011/spread-trial.jpg | 528781 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p011/story.json | 3323 | JSON-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p024/cover.jpg | 677149 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p024/hero-portrait.jpg | 555712 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p024/spread-climax.jpg | 697897 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p024/spread-midpoint.jpg | 664935 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p024/spread-resolution.jpg | 584099 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p024/spread-setup.jpg | 673350 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p024/spread-trial.jpg | 666577 | RESUME-SKIP VISUAL-OK LANE-DONE |
| 2026-06-12 | example-books-codex55-current-run | feat/img-books | p024/story.json | 3266 | JSON-OK LANE-DONE |

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-current-run, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-final-idempotent-pass, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-current-idempotent-verify, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-local-visual-verify, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-current-run, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-idempotent-recheck, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-idempotent-visual-recheck, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-built-in-idempotent-visual-check, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-current-idempotent-check, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-user-request-idempotent, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-resolution.jpg | 519929 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-trial.jpg | 568278 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-resolution.jpg | 458634 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-trial.jpg | 457094 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-resolution.jpg | 674908 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-trial.jpg | 528781 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-resolution.jpg | 584099 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-trial.jpg | 666577 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-resume-final, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-resolution.jpg | 519929 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-trial.jpg | 568278 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-resolution.jpg | 458634 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-trial.jpg | 457094 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-resolution.jpg | 674908 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-trial.jpg | 528781 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-resolution.jpg | 584099 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-trial.jpg | 666577 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-idempotent-current, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-resolution.jpg | 519929 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-trial.jpg | 568278 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-resolution.jpg | 458634 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-trial.jpg | 457094 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-resolution.jpg | 674908 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-trial.jpg | 528781 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-resolution.jpg | 584099 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-trial.jpg | 666577 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-idempotent-built-in-only, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-final-idempotent, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-built-in-resume-verify, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-image-builder-idempotent-final, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-built-in-idempotent-rerun, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE

RAW results table (id -> bytes), 2026-06-12, lane example-books-codex55-resume-skip-verify, branch feat/img-books:

| id | bytes |
|---|---:|
| p002/cover.jpg | 552354 |
| p002/hero-portrait.jpg | 460078 |
| p002/spread-setup.jpg | 519804 |
| p002/spread-midpoint.jpg | 647687 |
| p002/spread-trial.jpg | 568278 |
| p002/spread-climax.jpg | 648029 |
| p002/spread-resolution.jpg | 519929 |
| p002/story.json | 3516 |
| p005/cover.jpg | 441319 |
| p005/hero-portrait.jpg | 400786 |
| p005/spread-setup.jpg | 457544 |
| p005/spread-midpoint.jpg | 453146 |
| p005/spread-trial.jpg | 457094 |
| p005/spread-climax.jpg | 470137 |
| p005/spread-resolution.jpg | 458634 |
| p005/story.json | 3342 |
| p011/cover.jpg | 709032 |
| p011/hero-portrait.jpg | 493856 |
| p011/spread-setup.jpg | 571114 |
| p011/spread-midpoint.jpg | 672895 |
| p011/spread-trial.jpg | 528781 |
| p011/spread-climax.jpg | 685340 |
| p011/spread-resolution.jpg | 674908 |
| p011/story.json | 3323 |
| p024/cover.jpg | 677149 |
| p024/hero-portrait.jpg | 555712 |
| p024/spread-setup.jpg | 673350 |
| p024/spread-midpoint.jpg | 664935 |
| p024/spread-trial.jpg | 666577 |
| p024/spread-climax.jpg | 697897 |
| p024/spread-resolution.jpg | 584099 |
| p024/story.json | 3266 |

LANE-DONE
