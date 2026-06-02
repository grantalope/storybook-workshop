# Storybook Workshop — Master Goal Dispatch Index

**Date:** 2026-05-24
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md)
**Product branch:** Storybook Workshop (within pachinko-app, eventual standalone extraction per ADR-0042).
**Recommended executor:** Codex for asset/image-heavy goals (#10 pillar library, #4 PreText effects, #12 World Builder upstream). Claude for service + UI + backend goals. Each goal file declares preference but dispatcher picks.

## Why this product branch exists

Personalized AI-generated children's-book product (24-page hardcover, kid as hero, Pixar 7-beat). Three moats: (1) on-device privacy (no kid PII to our cloud), (2) settler/pachinko provenance + PreText typography pipeline, (3) evidence-backed pedagogy with citations. Per-book retail + grandparent series subscription. Spec §0-§11 has full design.

## Wave plan

### Wave 1 — Foundational pure-services (5 workers, parallel-safe)
| # | Goal | Branch | Worktree | Executor |
|---|---|---|---|---|
| 1 | [pillar-vectorizer](2026-05-24-storybook-workshop-pillar-vectorizer.md) | `feat/storybook-workshop-pillar-vectorizer` | `~/devbox/pachinko-app-sw-pillar-vectorizer` | claude |
| 2 | [kids-content-safety](2026-05-24-storybook-workshop-kids-content-safety.md) | `feat/storybook-workshop-kids-content-safety` | `~/devbox/pachinko-app-sw-kids-content-safety` | claude |
| 3 | [story-author](2026-05-24-storybook-workshop-story-author.md) | `feat/storybook-workshop-story-author` | `~/devbox/pachinko-app-sw-story-author` | claude |
| 4 | [pretext-book-adapter](2026-05-24-storybook-workshop-pretext-book-adapter.md) | `feat/storybook-workshop-pretext-book-adapter` | `~/devbox/pachinko-app-sw-pretext-book-adapter` | codex (animation-heavy) |
| 5 | [book-assembler](2026-05-24-storybook-workshop-book-assembler.md) | `feat/storybook-workshop-book-assembler` | `~/devbox/pachinko-app-sw-book-assembler` | claude |

### Wave 2 — UI + backend (4 workers, depends on Wave 1)
| # | Goal | Branch | Worktree | Executor |
|---|---|---|---|---|
| 6 | [ui-shell](2026-05-24-storybook-workshop-ui-shell.md) | `feat/storybook-workshop-ui-shell` | `~/devbox/pachinko-app-sw-ui-shell` | claude |
| 7 | [advanced-mode](2026-05-24-storybook-workshop-advanced-mode.md) | `feat/storybook-workshop-advanced-mode` | `~/devbox/pachinko-app-sw-advanced-mode` | claude |
| 8 | [fulfillment](2026-05-24-storybook-workshop-fulfillment.md) | `feat/storybook-workshop-fulfillment` | `~/devbox/pachinko-app-sw-fulfillment` | claude |
| 9 | [subscription-engine](2026-05-24-storybook-workshop-subscription-engine.md) | `feat/storybook-workshop-subscription-engine` | `~/devbox/pachinko-app-sw-subscription-engine` | claude |

### Wave 3 — Marketing + assets + upstream (3 workers, parallel with Wave 2 after Wave 1)
| # | Goal | Branch | Worktree | Executor |
|---|---|---|---|---|
| 10 | [pillar-library-pixal3d](2026-05-25-storybook-workshop-pillar-library-pixal3d.md) ⚡ **REVISED 2026-05-25** (original: ~~[pillar-library-assets](2026-05-24-storybook-workshop-pillar-library-assets.md)~~ — flat 2D approach DEPRECATED) | `feat/storybook-workshop-pillar-library-assets` | `~/devbox/pachinko-app-sw-pillar-library-assets` | **codex (Pixal3D+TRELLIS.2 on RTX 4090)** |
| 11 | [marketing-funnel](2026-05-24-storybook-workshop-marketing-funnel.md) | `feat/storybook-workshop-marketing-funnel` | `~/devbox/pachinko-app-sw-marketing-funnel` | claude |
| 12 | [hd2d-renderer-adapter](2026-05-25-storybook-workshop-hd2d-renderer-adapter.md) ⚡ **REPLACED 2026-05-25** (original: ~~[worldbuilder-upstream-changes](2026-05-24-storybook-workshop-worldbuilder-upstream-changes.md)~~ — DEPRECATED) | `feat/storybook-workshop-worldbuilder-upstream-changes` (legacy name, scope is now HD-2D adapter — same branch already on remote) | `~/devbox/pachinko-app-sw-worldbuilder-upstream-changes` | claude (with /codex:rescue for engine internals) |

> 🔄 **2026-05-25 PIVOT:** Goals #10 + #12 revised after HD-2D engine shipped on `feat/real-place-pipeline-e2e`. Storybook Workshop now consumes the in-repo THREE r171 engine (`Real3dHd2dScene` + 7 modules) instead of upstream WB API. See [docs/superpowers/specs/2026-05-25-storybook-workshop-hd2d-renderer-pivot.md](../specs/2026-05-25-storybook-workshop-hd2d-renderer-pivot.md) for full pivot rationale.

## Dispatch instructions (claude.local fleet ops)

Per CLAUDE.md §9 (king-of-the-tree) + standard kickoff pattern:

```bash
# 1. SSH in
ssh grantalope@100.104.9.90

# 2. From pachinko-app main checkout, fetch the spec-landing branch
cd ~/devbox/pachinko-app
git fetch origin feat/storybook-workshop-product-branch

# 3. Per-goal worktree (repeat per goal in this index)
git worktree add ~/devbox/pachinko-app-sw-<slug> -b feat/storybook-workshop-<slug> origin/feat/storybook-workshop-product-branch
ln -sfn ~/devbox/pachinko-app/node_modules ~/devbox/pachinko-app-sw-<slug>/node_modules

# 4. Write .kickoff.sh per goal (see kickoff template below)
# 5. Spawn tmux session under nice/ionice
tmux new-session -d -s claude-sw-<slug> -c ~/devbox/pachinko-app-sw-<slug>
tmux send-keys -t claude-sw-<slug> "nice -n 5 ionice -c 3 ./.kickoff.sh" Enter
```

**Kickoff template** (per CLAUDE.md fleet pattern):
```bash
#!/bin/bash
cd "$(dirname "$0")"
exec claude --dangerously-skip-permissions "Read docs/superpowers/goals/2026-05-24-storybook-workshop-<SLUG>.md in full + docs/superpowers/specs/2026-05-24-storybook-workshop-design.md + ADR-0042 + ADR-0043 + ~/devbox/claude-dash/docs/CODEX_USAGE.md. Branch feat/storybook-workshop-<SLUG> in this worktree (pwd). Execute every Build sequence step. CODEX SPINE: /codex:review after every commit, /codex:adversarial-review per phase, /codex:rescue if stuck 20min. NO COST CAP (Max plans). ONE FIX = ONE COMMIT. NO --amend, NO force-push, NO --no-verify. Maintain implementation-notes.md per Rule 14. When done: gh pr create --base main --head feat/storybook-workshop-<SLUG> --label king:review then ~/bin/king-review feat/storybook-workshop-<SLUG>. GO."
```

For Wave 3 codex-preferred goals, replace `exec claude` with `exec codex` if codex CLI is wired for autonomous mode; otherwise use claude with heavy `/codex:rescue` delegation for asset generation.

## Fleet capacity discipline
Per `feedback_claude_local_fleet_spawn_discipline.md`: box currently at load 13+ with 23 sessions. **Spawn Wave 1 (5 workers) immediately.** Wave 2 and Wave 3 dispatched after Wave 1 PRs start landing — check `gh pr list` + king progress before spawning more. Watchdog handles cap-hit recovery.

## Wakeup
6 hours post-dispatch (cron one-shot scheduled in dispatching Claude session). Check `tmux ls`, `gh pr list`, watchdog log, king queue. Re-dispatch any Wave 1 worker that crashed and didn't auto-recover.

## When all 12 PRs merged
- Pachinko-app main has full Storybook Workshop product branch live.
- Spec + ADRs + CONTEXT.md cluster updated.
- `/dashboard/storybook-workshop` route loads and walks parent through 7 stations.
- Internal alpha begins (Spec §9.2 phase 1).
- Trigger CLAUDE.md update with Storybook Workshop top-level section.
