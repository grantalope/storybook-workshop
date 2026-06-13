# ORCHESTRATOR HANDOFF — Storybook Workshop (Book Builder)
**Written by Fable (architect session), 2026-06-12. For Opus (or any successor orchestrator).**
**Read this fully, then `docs/HANDOFF.md` (architect/builder memory), then act. Not in a doc = didn't happen.**

---

## 0. MISSION + ONE-PARAGRAPH STATE

Personalized children's-picture-book product: kid photo → ON-DEVICE CLIP match to illustrated archetype (photo never leaves device — THE privacy moat) → Pixar-7-beat personalized story → character-consistent illustrations → free digital read-along (TTS karaoke + phonics + edu overlays) → paid print (Lulu POD) + grandparent series subscriptions. Repo: `github.com/grantalope/storybook-workshop` (private). Main is at ~1372+ tests / 136+ files green, 10 acceptance gates (`pnpm gates`), 21+ feature branches merged this week. Two REAL proof books generated; a third (fully-real everything) is in flight. The /loop machinery (below) iterates toward "nearly perfect" with retros authoring each next loop's goals.

## 1. INFRASTRUCTURE MAP

| Thing | Where | Notes |
|---|---|---|
| Repo main checkout | lilaiputia `~/devbox/storybook-workshop` | ssh grantalope@100.104.9.90 (Tailscale). NEVER work in this checkout — worktrees only |
| Node on lilaiputia | `source ~/.nvm/nvm.sh && nvm use 22` | System node is 18 — breaks vite-plugin-svelte@6 + vitest. ALWAYS nvm 22. `npx svelte-kit sync` once per fresh worktree |
| WSL clone (4090 box) | `~/work/storybook-workshop` | Push auth BROKEN in WSL → use bundle relay: `~/work/push-branch.sh <branch>` → `D:/devbox/git-bundles/` → scp to lilaiputia → fetch+push there. WSL /tmp is VOLATILE (restarts wipe it) |
| GPU image server | THIS Windows box, ComfyUI :8188 (Tailscale 100.101.215.25:8188) | Qwen-Image-2512 FP8 (T2I ~24s warm) + Qwen-Image-Edit-2511 GGUF multi-ref (~20-30s warm, character consistency VERIFIED). Docs `D:/ai/README-imagegen.md`. Multi-ref template `D:/ai/templates/spread-gen-multi-ref.json`. Free VRAM: POST /free {"unload_models":true,"free_memory":true} |
| Narrator service | THIS box, `D:/ai/narrator/server.py`, uvicorn :8189 (Tailscale-reachable) | Chatterbox (MIT), lazy-load/idle-unload, needs ~3GB VRAM (choreograph vs ComfyUI's 22GB). /synthesize {text,voiceId,rate}→WAV+timings, /voices, /health. 5 candidates built; ear-pick PENDING (human) |
| Pre-gen asset bank | lilaiputia `~/devbox/storybook-workshop-codex-t5/scripts/pregen/.bank` (~1.1GB) | 84 plates + 102 props (2 regens in flight) + 1200 pose sprites (150 archetypes × 8 poses, chroma-matted). Repo carries manifest (`static/pregen-bank/manifest.json`) + 256px thumbs. Rebuild: `node scripts/pregen/build-manifest-from-bank.mjs --bank <path> --expect-styles flat-painted` + `build-thumbs.py` + `validate-repo-manifest.mjs` (runbook `docs/pregen-bank.md`) |
| Smart LLM queue | `d:\devbox\llm-queue` via `wsl bash -c 'export LLM_QUEUE_DIR=/mnt/d/devbox/llm-queue; node /mnt/d/devbox/llm-router.mjs enqueue-file <job.json>'` | Job {type, privacy:P0|P1|P2, prompt, json?}. **P2 (repo code) NEVER leaves local lanes.** Fleet ops doc: lilaiputia `~/devbox/fleet/docs/OPERATING.md` |
| Ollama | lilaiputia 3080 :11434 (gemma4:12b-it-qat — good creative/storyteller), 1080 :11435 (gemma4:e4b); 4090 WSL :11500 (qwen3.6:27b coder) | Loops/batches via queue ONLY; one-off curls OK. Prod app NEVER depends on Ollama (operator mandate) |
| Codex CLI | WSL this box + lilaiputia (fnm path `$HOME/.local/share/fnm/aliases/default/bin`) | gpt-5.5, ALWAYS `</dev/null`, setsid for persistence (nohup-over-ssh dies), `-c model_reasoning_effort=low|medium|xhigh`. **Images-only or cheaper-model-failed-first** (token directive). Built-in image_gen: outputs land `$CODEX_HOME/generated_images/<id>/` — must copy into repo; verify >100KB |
| Fleet check-in | `node d:/devbox/fleet-checkin.mjs --session storybook-fable --done .. --doing .. --next ..` | Every milestone; dashboard :8095 |
| Artifacts for the operator | `D:/devbox/storybook-real-book-1/` (Juniper book), `D:/devbox/storybook-real-book-3/` (Wren book WIP), `D:/devbox/storybook-narrator/` (voice candidates + VOICE-PICK.md), `D:/devbox/storybook-compose-pilot/` (WFC composed+harmonized spreads), `D:/devbox/storybook-demo/` (demo screenshots) | |

## 2. PROTOCOLS (BINDING)

1. **Token routing (operator 2026-06-12, `OPERATING.md`)**: generation verbs (write/generate/summarize/extract/classify/codegen) → smart-queue free-cloud tier-1 (nvidia-free kimi-k2.6/minimax-m3/deepseek-v4, tokenrouter-free minimax-M3 FREE until 6/17, bai-free; then cerebras 1M tok/day, groq, openrouter 1k/day) → local GPUs via queue (P2 repo code = gpu-4090 qwen ONLY, never cloud) → Claude (haiku sweeps/mechanical, sonnet review/fix/synthesis) → codex LAST (genuinely hard + cheaper-failed, note failure one line). Judgment verbs (judge/decide/review/root-cause/architect) → Claude. **Top model = main-loop only, NEVER in fan-outs; every Agent/Workflow dispatch sets model EXPLICITLY.**
2. **CODEX-FABLE LOOP** (for goal-shaped impl; canonical `d:\devbox\SHARED-codex-fable-loop.md`): recon@low → architect plan → red-team@xhigh → fold → framework `docs/goals/<slug>/{context,plan,state,steps/*,notes-from-the-boss}.md` → execute@xhigh in tmux lane (sentinel LANE-DONE, idempotent re-entry) → supervise 20-min cron (read state.md+diff, write boss-notes, NEVER trust prose without counts/shas). Proven: money-integrity goal recon→merged <2h, red-team caught 3 P0s in the architect's own plan.
3. **Merges**: detached worktrees ONLY (`git worktree add --detach /tmp/x origin/main && merge --no-ff && push origin HEAD:main`), never the main checkout. HANDOFF.md conflicts → union (keep both). Builder NEVER pushes; architect/supervisor merges after INDEPENDENT verification (rerun tests yourself — builders have fabricated merge shas: see `bb58c3a40` incident in HANDOFF).
4. **Gates as merge bar**: `node scripts/gates/run-all.mjs` ALL PASS (Node 22!). G2 is a ratchet (auto-tightens). Evidence rule: checkboxes close only with (evidence: <sha>) or (evidence: cmd→output).
5. **Privacy/content hard rules**: no mic APIs; kid PII never to cloud (P2); no living-artist style mimicry (banned-names guard test); narrator voice = style-alike from PD/CC0 only (NO Howser audio — right of publicity); production inference = in-app only (no Ollama hop).
6. **Improvement loop**: worker output fails → fix at root → APPEND learned rule (`d:\devbox\coder-rules\` or fleet lessons) → re-queue.

## 3. IN-FLIGHT RIGHT NOW (resume these first)

- **Loop-3 workflow** `wl341kdx5` / run `wf_1d22dd50-ae8`, script `...workflows/scripts/loop3-quality-gates-and-real-book-wf_1d22dd50-ae8.js`. Phases: (1) gates green on Node 22 (.nvmrc + runner self-exec + PdfBuildInput type fix + rebaseline G2), (2) GPU sequential: finish 3rd harmonized spread (≥8/10 target) → verify compass+fishing-rod prop regens + matting + manifest rebuild (propQcBad=0) → free VRAM → narrator WAVs (re-roll candidate 5 seed 1056; 5 ear-samples; full book-3 narration; VOICE-PICK.md), (3) parallel: book-3 REAL (gemma4:12b story 300s budget + renders driven FROM THE LOCAL BOX hitting 127.0.0.1:8188 — last failure was Node-context unreachability + llama3.1:8b absence; harmonization applied; audio bundled; ≥8/10), G2 TS sweep on haiku (kernel-contracts, ~140→≤40, types only, no redesign), mobile smokes (iPhone 390×844 + M1 viewports) + `tasks/sandbox-smoke-checklist.md`, (4) retro → DONE check or loop-4 goals. **If dead on caps: resume with resumeFromRunId; cached phases replay.**
- **Crons (session-only — RECREATE after any session restart)**: hourly /loop driver (advance loop, launch loop-N+1 from retro goals, resume cap-kills, self-delete on DONE) + 45-min revival beat (FIRST touch `D:/devbox/storybook-loop-heartbeat.txt`, then resume-if-dead, recreate driver if missing). External: Windows task `StorybookLoopRevive` revives via `claude -c -p` when heartbeat >75min stale (log `D:/devbox/storybook-loop-revive.log`).
- **DONE DEFINITION (loop exits when ALL, evidence-backed)**: assets merged (portraits/books/props healthy) ✓(mostly) · harmonization ≥7 APPLIED to a real book · narrator WAVs + candidates delivered · /demo merged+loads ✓ · G7 clean ✓ · book-3 ≥8/10 with REAL story+renders · gates ALL PASS · remaining items human-only.

## 4. COMPLETE REMAINING TASK LIST

### TIER A — finish the loop (in-flight, detail in §3)
A1. Gates green on Node 22. A2. Harmonization 3/3 ≥8 + applied. A3. Prop bank propQcBad=0 + manifest rebuild. A4. Narrator WAVs + VOICE-PICK.md + candidate-5 re-roll. A5. Book-3 fully real (story/renders/harmonize/audio/style-card/Lulu-valid, ≥8/10). A6. G2 sweep ≤40. A7. Mobile smokes + sandbox checklist. A8. Loop retro → loop-4 or DONE.

### TIER B — known debt (next loop(s); each = goal-shaped, route per §2.1)
B1. **REAL pillar embeddings** (CRITICAL for the product's photo-match): v2 manifest embeddings are deterministic hash PLACEHOLDERS — browser CLIP match is dead against them. Embed the 150 real portraits with the SAME model the browser uses (verify in `src/lib/services/PillarVectorizerService.ts` — expected Xenova/clip-vit-base-patch32, 512-dim) via local python (transformers, fp32, L2-normalized), self-match sanity >0.99, write into `static/pillar-library-v2/manifest`, demo match smoke. (Earlier pipeline existed in killed workflow — re-derive; ~30 LOC python.)
B2. **HANDOFF.md log restoration**: 152 lines lost in a `--theirs` cherry-pick; lane tables survive in worktree copies (`~/devbox/storybook-workshop-codex-*/docs/HANDOFF.md`) — merge them back, one commit.
B3. **Bank style expansion**: bank is flat-painted only; 11 other art-history packs have ZERO bank coverage. Mass-gen via codex image lanes (images = sanctioned): plates 84/style, poses phased (top-20 archetypes first = 160/style). Budget table in `docs/specs/2026-06-10-wfc-scene-grammar-pregen.md` (or T5 spec). Per-lane CODEX_HOME isolation (see `/tmp/bb-imagegen-lanes-v2/run_pose_lane.sh` pattern) + chroma matting + manifest rebuild.
B4. **Facing-aware poses**: compose pilot defect — sprites' internal gesture direction not coordinated (sidekick pointed away from hero). Either generate left/right facing variants per pose (bank ×2) or content-aware flip detection. Design choice → mini codex-fable loop.
B5. **Tight-shot framing**: climax "tight-dramatic" reads as medium — implement plate crop-zoom in CompositionPlanner (scale plate region by shot class). Small, scenegrammar-local.
B6. **textZone debug marker**: remove burned-in translucent marker from production composite path (compose driver flag).
B7. **PNG archive decision**: 345MB at `~/devbox/storybook-workshop-codex-img-pillars/.portraits-png-archive/` — keep (re-derive source) or delete (disk). Operator preference; default keep until B1 done.
B8. **Lulu webhook dedup**: only Stripe got the atomic dedup; `api/lulu-webhook` still read-then-write (BUG-BACKLOG cluster E). Reuse `applyStripeWebhookEventOnce` pattern (generalize name). Small goal.
B9. **Backlog P2s**: `docs/BUG-BACKLOG.md` cluster E reliability items (ship before GA).

### TIER C — pre-launch product gaps (bigger; each deserves a codex-fable loop or workflow)
C1. **Real auth provider**: `hooks.server.ts` handle is a stub (dev-bypass env-gated). Pick + wire cookie-JWT/Auth0/Clerk/Supabase per recipes in `docs/production-deploy.md`; kill STORYBOOK_DEV_BYPASS_AUTH in prod path; e2e session test.
C2. **Stripe/Lulu sandbox e2e**: blocked on OPERATOR creds (STRIPE_SECRET_KEY/WEBHOOK_SECRET, LULU_API_KEY/SECRET, OPS_API_TOKEN). Checklist from A7. Then run it: order → webhook (dedup!) → Lulu job → quality-claim refund decision route.
C3. **Production deploy**: host decision (operator), env assembly (`ensureProductionConfig` asserts: STRIPE_*, LULU_*, OPS_API_TOKEN, no dev-bypass), bank rsync to CDN/static host (bankRoot resolution per `docs/pregen-bank.md`), narrator service hosting decision (4090 box vs cloud TTS), `pnpm gates` in CI.
C4. **Voice integration post-pick**: wire chosen voiceId into BundleService (`VOICE_PICK_PENDING` const), regenerate read-along bundles, fallback chain (narrator-server → browser SpeechSynthesis).
C5. **iPhone companion M1**: per `docs/specs/2026-06-10-iphone-on-device-companion.md` — native shell + on-device FoundationModels story draft (@Generable per-beat — storygrammar's per-beat mode fits the 4K ctx); needs macOS/Xcode runner (operator hardware decision). Codex open-questions list at doc tail.
C6. **Series subscriptions live e2e**: autopilot cadence fixed (cluster C) but full gift→redeem→monthly-draft→approve→order flow untested end-to-end; vitest covers units — add integration spec + sandbox run (after C2).
C7. **Marketing funnel live test**: Resend with real domain (operator DNS), email-gate → drip → abandoned-cart on staging; CAN-SPAM verify (unsubscribe tested in unit suite already).
C8. **Performance pass**: bundle audit (lazy CLIP/WASM verified in demo, sweep the rest), image loading strategy on /demo gallery (150 thumbs), Lighthouse on key routes.
C9. **Story quality at scale**: STORY_EVAL=1 harness across N stories × age bands × themes via free-cloud lanes (P1 — prompts contain no PII) + rubric scores; tune skeleton grammar weights from results.

### TIER D — HUMAN-ONLY (surface these, never auto-execute)
D1. Narrator voice ear-pick: listen `D:/devbox/storybook-narrator/*/sample-p1.wav` + `VOICE-PICK.md` → tell orchestrator the id → C4 unblocks.
D2. Stripe + Lulu sandbox credentials → C2/C6 unblock.
D3. Book-3 + /demo eyeball (quality sign-off).
D4. Production host + domain + Lulu production account decisions.
D5. First real print order (the original dream: print + mail a book).

## 5. GOTCHAS INDEX (expensive lessons — do not relearn)
- Builders LIE in self-reports: verify merges via `git show origin/main:<file>`; rerun tests yourself before merging. (Fabricated sha incident; "LANE-DONE" with zero commits incident.)
- Session caps kill subagents mid-flight constantly: Workflow resumeFromRunId replays cached phases; design workflows so every phase output is null-guarded (`const x = result || fallback`).
- ScheduleWakeup unreliable for this operator — use background-Bash watchers (notify on completion) + CronCreate; crons are SESSION-ONLY (recreate after restart; durable flag doesn't take).
- ssh+nohup dies with the session → `setsid ... </dev/null` or tmux lanes; WSL tmpfs wipes on restart; codex `-s workspace-write` BREAKS git in worktrees (metadata outside sandbox) — rely on config full-access.
- pnpm 10 blocks build scripts; fresh worktree needs `npx svelte-kit sync`; vitest in /tmp worktrees hits pnpm-store realpath issues — run suites in `~/devbox` worktrees with node_modules symlink (EXCEPT T6-style native-dep tasks: real pnpm install).
- HANDOFF.md union-merge: `re.sub(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", lambda m: m.group(1)+m.group(2), s, flags=re.DOTALL)` — and watch for dropped closing braces when both sides end functions.
- GPU checkout (`gpu-checkout.sh`) KILLS running ollama batches — reserve only for non-ollama VRAM needs; ComfyUI coexists without reservation.
- Workflow scripts: plain JS only, no Math.random/Date.now (validator greps), escape apostrophes in single-quoted prompt lines (or use typographic '), meta must be pure literal.

## 6. FIRST ACTIONS FOR THE NEW ORCHESTRATOR
1. Touch `D:/devbox/storybook-loop-heartbeat.txt`. 2. Check loop-3 (`wl341kdx5`) state — resume/advance per §3. 3. Recreate the two crons if missing (CronList). 4. Read `docs/HANDOFF.md` tail + `docs/goals/loop-3-goals.md` (+ loop-4 if retro ran). 5. Fleet check-in. 6. Work tiers A→B→C, surfacing D items to the operator as they unblock. 7. Each loop ends with a retro that authors the next loop's goals into `docs/goals/` — keep that contract; it is what "running a /loop until everything is done and dusted" means here.
