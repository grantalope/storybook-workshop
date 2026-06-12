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

| date | lane | branch | full tests | gates | check ratchet | G6-money | G7-security | commits | push | status |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-06-12 | bh-a-money-integrity | fix/bh-a-money-integrity | 1372 passed / 4 skipped / 136 files | ALL PASS / 40.6s | 109 → 106 errors (baseline tightened) | PASS / 370 pass | WARN allow-listed / 2 findings | 5625828, e403c39, e2f24b7, d2a6783, final closeout commit | no | LANE-DONE |

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

| date | lane | branch | portraits | thumbs | portrait <=100KB | push | status |
|---|---|---|---:|---:|---:|---|---|
| 2026-06-12 | archetype PORTRAITS | feat/img-pillars | 150 | 150 | 0 | no | LANE-DONE |
| 2026-06-12 | archetype PORTRAITS correction pass | feat/img-pillars | 150 | 150 | 0 | no | LANE-DONE |
| 2026-06-12 | archetype PORTRAITS thumb q85 normalization | feat/img-pillars | 150 | 150 | 0 | no | LANE-DONE |
| 2026-06-12 | archetype PORTRAITS idempotent verify | feat/img-pillars | 150 | 150 | 0 | no | LANE-DONE |

| id | bytes |
|---|---:|
| p001 | 2381089 |
| p002 | 2380953 |
| p003 | 2452192 |
| p004 | 2458715 |
| p005 | 2174231 |
| p006 | 2355163 |
| p007 | 2518793 |
| p008 | 2382920 |
| p009 | 2299454 |
| p010 | 2592585 |
| p011 | 2681534 |
| p012 | 2471598 |
| p013 | 2523921 |
| p014 | 2591260 |
| p015 | 2653303 |
| p016 | 2600706 |
| p017 | 2553605 |
| p018 | 2519587 |
| p019 | 2494384 |
| p020 | 2709314 |
| p021 | 2518349 |
| p022 | 2608078 |
| p023 | 2609484 |
| p024 | 2714039 |
| p025 | 2660607 |
| p026 | 2583603 |
| p027 | 2581303 |
| p028 | 2740463 |
| p029 | 2543890 |
| p030 | 2637473 |
| p031 | 2575451 |
| p032 | 2589199 |
| p033 | 2659926 |
| p034 | 2665560 |
| p035 | 2640975 |
| p036 | 2533008 |
| p037 | 2533581 |
| p038 | 2480554 |
| p039 | 2730558 |
| p040 | 2615666 |
| p041 | 2633290 |
| p042 | 2608875 |
| p043 | 2710831 |
| p044 | 2571013 |
| p045 | 2507899 |
| p046 | 2657198 |
| p047 | 2613466 |
| p048 | 2571794 |
| p049 | 2715262 |
| p050 | 2643348 |
| p051 | 2555806 |
| p052 | 2647956 |
| p053 | 2715795 |
| p054 | 2598998 |
| p055 | 2829520 |
| p056 | 2655959 |
| p057 | 2623236 |
| p058 | 2632093 |
| p059 | 2582268 |
| p060 | 2647437 |
| p061 | 2554593 |
| p062 | 2644646 |
| p063 | 2626858 |
| p064 | 2473681 |
| p065 | 2630874 |
| p066 | 2680094 |
| p067 | 2721895 |
| p068 | 2577844 |
| p069 | 2699377 |
| p070 | 2663289 |
| p071 | 2468364 |
| p072 | 2408015 |
| p073 | 2748933 |
| p074 | 2532839 |
| p075 | 2559184 |
| p076 | 2610958 |
| p077 | 2602773 |
| p078 | 2592001 |
| p079 | 2757574 |
| p080 | 2673165 |
| p081 | 2757162 |
| p082 | 2706538 |
| p083 | 2834151 |
| p084 | 2766022 |
| p085 | 2862909 |
| p086 | 2680746 |
| p087 | 2609447 |
| p088 | 2680556 |
| p089 | 2593624 |
| p090 | 2648549 |
| p091 | 2681843 |
| p092 | 2787369 |
| p093 | 2541282 |
| p094 | 2696508 |
| p095 | 2642544 |
| p096 | 2568530 |
| p097 | 2661335 |
| p098 | 2496607 |
| p099 | 2567365 |
| p100 | 2728153 |
| p101 | 2648751 |
| p102 | 2611896 |
| p103 | 2460351 |
| p104 | 2600197 |
| p105 | 2531517 |
| p106 | 2648799 |
| p107 | 2561916 |
| p108 | 2591456 |
| p109 | 2532480 |
| p110 | 2489019 |
| p111 | 2455662 |
| p112 | 2421460 |
| p113 | 2514346 |
| p114 | 2520514 |
| p115 | 2536669 |
| p116 | 2472097 |
| p117 | 2596939 |
| p118 | 2600237 |
| p119 | 2672380 |
| p120 | 2793639 |
| p121 | 2477797 |
| p122 | 2492092 |
| p123 | 2605635 |
| p124 | 2657711 |
| p125 | 2509293 |
| p126 | 2628093 |
| p127 | 2696805 |
| p128 | 2638434 |
| p129 | 2771211 |
| p130 | 2607185 |
| p131 | 2263218 |
| p132 | 2683552 |
| p133 | 2562231 |
| p134 | 2551064 |
| p135 | 2724202 |
| p136 | 2677073 |
| p137 | 2732435 |
| p138 | 2768092 |
| p139 | 2650524 |
| p140 | 2278740 |
| p141 | 2691646 |
| p142 | 2538451 |
| p143 | 2632391 |
| p144 | 2694228 |
| p145 | 2625335 |
| p146 | 2601318 |
| p147 | 2680042 |
| p148 | 2729032 |
| p149 | 2751351 |
| p150 | 2722267 |

| 2026-06-12 | archetype PORTRAITS Codex 5.5 idempotent verify | feat/img-pillars | 150 | 150 | 0 | no | LANE-DONE |

| id | bytes |
|---|---:|
| p001 | 2381089 |
| p002 | 2380953 |
| p003 | 2452192 |
| p004 | 2458715 |
| p005 | 2174231 |
| p006 | 2355163 |
| p007 | 2518793 |
| p008 | 2382920 |
| p009 | 2299454 |
| p010 | 2592585 |
| p011 | 2681534 |
| p012 | 2471598 |
| p013 | 2523921 |
| p014 | 2591260 |
| p015 | 2653303 |
| p016 | 2600706 |
| p017 | 2553605 |
| p018 | 2519587 |
| p019 | 2494384 |
| p020 | 2709314 |
| p021 | 2518349 |
| p022 | 2608078 |
| p023 | 2609484 |
| p024 | 2714039 |
| p025 | 2660607 |
| p026 | 2583603 |
| p027 | 2581303 |
| p028 | 2740463 |
| p029 | 2543890 |
| p030 | 2637473 |
| p031 | 2575451 |
| p032 | 2589199 |
| p033 | 2659926 |
| p034 | 2665560 |
| p035 | 2640975 |
| p036 | 2533008 |
| p037 | 2533581 |
| p038 | 2480554 |
| p039 | 2730558 |
| p040 | 2615666 |
| p041 | 2633290 |
| p042 | 2608875 |
| p043 | 2710831 |
| p044 | 2571013 |
| p045 | 2507899 |
| p046 | 2657198 |
| p047 | 2613466 |
| p048 | 2571794 |
| p049 | 2715262 |
| p050 | 2643348 |
| p051 | 2555806 |
| p052 | 2647956 |
| p053 | 2715795 |
| p054 | 2598998 |
| p055 | 2829520 |
| p056 | 2655959 |
| p057 | 2623236 |
| p058 | 2632093 |
| p059 | 2582268 |
| p060 | 2647437 |
| p061 | 2554593 |
| p062 | 2644646 |
| p063 | 2626858 |
| p064 | 2473681 |
| p065 | 2630874 |
| p066 | 2680094 |
| p067 | 2721895 |
| p068 | 2577844 |
| p069 | 2699377 |
| p070 | 2663289 |
| p071 | 2468364 |
| p072 | 2408015 |
| p073 | 2748933 |
| p074 | 2532839 |
| p075 | 2559184 |
| p076 | 2610958 |
| p077 | 2602773 |
| p078 | 2592001 |
| p079 | 2757574 |
| p080 | 2673165 |
| p081 | 2757162 |
| p082 | 2706538 |
| p083 | 2834151 |
| p084 | 2766022 |
| p085 | 2862909 |
| p086 | 2680746 |
| p087 | 2609447 |
| p088 | 2680556 |
| p089 | 2593624 |
| p090 | 2648549 |
| p091 | 2681843 |
| p092 | 2787369 |
| p093 | 2541282 |
| p094 | 2696508 |
| p095 | 2642544 |
| p096 | 2568530 |
| p097 | 2661335 |
| p098 | 2496607 |
| p099 | 2567365 |
| p100 | 2728153 |
| p101 | 2648751 |
| p102 | 2611896 |
| p103 | 2460351 |
| p104 | 2600197 |
| p105 | 2531517 |
| p106 | 2648799 |
| p107 | 2561916 |
| p108 | 2591456 |
| p109 | 2532480 |
| p110 | 2489019 |
| p111 | 2455662 |
| p112 | 2421460 |
| p113 | 2514346 |
| p114 | 2520514 |
| p115 | 2536669 |
| p116 | 2472097 |
| p117 | 2596939 |
| p118 | 2600237 |
| p119 | 2672380 |
| p120 | 2793639 |
| p121 | 2477797 |
| p122 | 2492092 |
| p123 | 2605635 |
| p124 | 2657711 |
| p125 | 2509293 |
| p126 | 2628093 |
| p127 | 2696805 |
| p128 | 2638434 |
| p129 | 2771211 |
| p130 | 2607185 |
| p131 | 2263218 |
| p132 | 2683552 |
| p133 | 2562231 |
| p134 | 2551064 |
| p135 | 2724202 |
| p136 | 2677073 |
| p137 | 2732435 |
| p138 | 2768092 |
| p139 | 2650524 |
| p140 | 2278740 |
| p141 | 2691646 |
| p142 | 2538451 |
| p143 | 2632391 |
| p144 | 2694228 |
| p145 | 2625335 |
| p146 | 2601318 |
| p147 | 2680042 |
| p148 | 2729032 |
| p149 | 2751351 |
| p150 | 2722267 |

## Compose pilot 2026-06-11 (Fable)

- COMPOSE PILOT: scripts/pregen/compose-pilot.mjs — first 3 bank-composed spreads
  (book pilot-1: setup/climax/resolution; desert + compass + p001/p002; real engine
  path collapseLayout -> planComposition -> PIL compositor; zero direct-gen
  fallbacks; ~1.9 s/spread at 1536x1184). Visual verdict 6/10 pre-harmonization:
  grounding/scale/textZone-clear all hold; main defect is a BANK QC issue —
  propC/compass/flat-painted.png is a green-screen landscape, not a compass
  (prop-gen content miss + matting failed to key green). Layer-C needs the QC
  pass qc-similarity only gives Layer B. Next step: img2img harmonization pass
  on the 4090 (lighting/palette unification + contact shadows).

| date | lane | branch | portraits | thumbs | portrait <=100KB | push | status |
|---|---|---|---:|---:|---:|---|---|
| 2026-06-12 | archetype PORTRAITS PNG restore | feat/img-pillars | 150 | 150 | 0 | no | LANE-DONE |

| id | bytes |
|---|---:|
| p001 | 2381089 |
| p002 | 2380953 |
| p003 | 2452192 |
| p004 | 2458715 |
| p005 | 2174231 |
| p006 | 2355163 |
| p007 | 2518793 |
| p008 | 2382920 |
| p009 | 2299454 |
| p010 | 2592585 |
| p011 | 2681534 |
| p012 | 2471598 |
| p013 | 2523921 |
| p014 | 2591260 |
| p015 | 2653303 |
| p016 | 2600706 |
| p017 | 2553605 |
| p018 | 2519587 |
| p019 | 2494384 |
| p020 | 2709314 |
| p021 | 2518349 |
| p022 | 2608078 |
| p023 | 2609484 |
| p024 | 2714039 |
| p025 | 2660607 |
| p026 | 2583603 |
| p027 | 2581303 |
| p028 | 2740463 |
| p029 | 2543890 |
| p030 | 2637473 |
| p031 | 2575451 |
| p032 | 2589199 |
| p033 | 2659926 |
| p034 | 2665560 |
| p035 | 2640975 |
| p036 | 2533008 |
| p037 | 2533581 |
| p038 | 2480554 |
| p039 | 2730558 |
| p040 | 2615666 |
| p041 | 2633290 |
| p042 | 2608875 |
| p043 | 2710831 |
| p044 | 2571013 |
| p045 | 2507899 |
| p046 | 2657198 |
| p047 | 2613466 |
| p048 | 2571794 |
| p049 | 2715262 |
| p050 | 2643348 |
| p051 | 2555806 |
| p052 | 2647956 |
| p053 | 2715795 |
| p054 | 2598998 |
| p055 | 2829520 |
| p056 | 2655959 |
| p057 | 2623236 |
| p058 | 2632093 |
| p059 | 2582268 |
| p060 | 2647437 |
| p061 | 2554593 |
| p062 | 2644646 |
| p063 | 2626858 |
| p064 | 2473681 |
| p065 | 2630874 |
| p066 | 2680094 |
| p067 | 2721895 |
| p068 | 2577844 |
| p069 | 2699377 |
| p070 | 2663289 |
| p071 | 2468364 |
| p072 | 2408015 |
| p073 | 2748933 |
| p074 | 2532839 |
| p075 | 2559184 |
| p076 | 2610958 |
| p077 | 2602773 |
| p078 | 2592001 |
| p079 | 2757574 |
| p080 | 2673165 |
| p081 | 2757162 |
| p082 | 2706538 |
| p083 | 2834151 |
| p084 | 2766022 |
| p085 | 2862909 |
| p086 | 2680746 |
| p087 | 2609447 |
| p088 | 2680556 |
| p089 | 2593624 |
| p090 | 2648549 |
| p091 | 2681843 |
| p092 | 2787369 |
| p093 | 2541282 |
| p094 | 2696508 |
| p095 | 2642544 |
| p096 | 2568530 |
| p097 | 2661335 |
| p098 | 2496607 |
| p099 | 2567365 |
| p100 | 2728153 |
| p101 | 2648751 |
| p102 | 2611896 |
| p103 | 2460351 |
| p104 | 2600197 |
| p105 | 2531517 |
| p106 | 2648799 |
| p107 | 2561916 |
| p108 | 2591456 |
| p109 | 2532480 |
| p110 | 2489019 |
| p111 | 2455662 |
| p112 | 2421460 |
| p113 | 2514346 |
| p114 | 2520514 |
| p115 | 2536669 |
| p116 | 2472097 |
| p117 | 2596939 |
| p118 | 2600237 |
| p119 | 2672380 |
| p120 | 2793639 |
| p121 | 2477797 |
| p122 | 2492092 |
| p123 | 2605635 |
| p124 | 2657711 |
| p125 | 2509293 |
| p126 | 2628093 |
| p127 | 2696805 |
| p128 | 2638434 |
| p129 | 2771211 |
| p130 | 2607185 |
| p131 | 2263218 |
| p132 | 2683552 |
| p133 | 2562231 |
| p134 | 2551064 |
| p135 | 2724202 |
| p136 | 2677073 |
| p137 | 2732435 |
| p138 | 2768092 |
| p139 | 2650524 |
| p140 | 2278740 |
| p141 | 2691646 |
| p142 | 2538451 |
| p143 | 2632391 |
| p144 | 2694228 |
| p145 | 2625335 |
| p146 | 2601318 |
| p147 | 2680042 |
| p148 | 2729032 |
| p149 | 2751351 |
| p150 | 2722267 |
