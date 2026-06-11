# Codex Task Pack — storybook-workshop — Supervision Protocol

This directory contains 6 self-contained task specs (T1..T6) for Codex 5.5, executed via
`codex` CLI in isolated git worktrees on claude.local, supervised by a Claude agent.
Every task file embeds everything Codex needs — zero conversation context assumed.
Each task file references THIS file for the shared environment + rules; if the task file
and this file disagree, the task file wins for its own scope.

---

## 1. Shared environment header (referenced by every task)

| Item | Value |
|---|---|
| Repo | `grantalope/storybook-workshop` (GitHub) |
| Host | claude.local (`100.104.9.90`), user `grantalope` |
| Main checkout | `~/devbox/storybook-workshop` — **NEVER work here; worktrees only** |
| Stack | SvelteKit 2 + Svelte 5 runes + TypeScript strict + Vitest 4 (`^4.1.4`) |
| Alias | `$lib` = `src/lib` |
| Node | 22 — activate per shell: `source ~/.nvm/nvm.sh && nvm use 22` |
| Package manager | pnpm (`packageManager: pnpm@10.20.0`) |
| Test layout | `tests/**/*.test.ts` (92 files; subdirs: advanced, assemble, author, fulfillment, imagegen, marketing, render, setup, storyllm, subscription, ui) |
| Test baseline | Full suite ~1097 tests green on `origin/main`. **MUST stay green, plus your additions.** |
| Commands | `pnpm test` (vitest run) · `pnpm check` (svelte-check) · `pnpm lint` (eslint) |

### Repo conventions (HARD rules)

1. **Injectable boundaries.** All HTTP / store / clock / random dependencies are constructor-
   or options-injected so tests run hermetic. Exemplar:
   `src/lib/services/fulfillment/StripeCheckoutService.ts` (injected `StripeHttpClient`,
   mock provided in tests). Mirror that pattern for any new external boundary.
2. **CSPRNG for security-sensitive randomness.** Use
   `src/lib/services/subscription/secureRandom.ts` (`secureRandomInt`, `secureRandomString`).
   Never `Math.random()` for ids/codes/tokens.
3. **Seeded-hash determinism for generative logic.** Pure services that "roll dice"
   (layout collapse, skeleton collapse, seed selection) must derive ALL randomness from a
   caller-supplied seed via a deterministic hash (FNV-1a / xmur3 + mulberry32 are fine).
   NO `Date.now()`, NO `Math.random()` inside pure generative services.
4. **Atomic commits**, one logical change each. NO `--amend`, NO `--no-verify`, NO force-push.
5. Every commit message ends with the trailer line:
   `Co-Authored-By: Codex 5.5 <noreply@openai.com>`
6. TypeScript strict; `pnpm check` must pass (Svelte 5 runes syntax: `$state`, `$derived`,
   `$props` — see `src/routes/(marketing)/r/[shortcode]/+page.svelte` for an example page).

### Worktree setup (per task N)

```bash
source ~/.nvm/nvm.sh && nvm use 22
cd ~/devbox/storybook-workshop && git fetch origin
git worktree add ~/devbox/storybook-workshop-codex-tN -b <branch-from-task> origin/main
ln -s ~/devbox/storybook-workshop/node_modules ~/devbox/storybook-workshop-codex-tN/node_modules
cd ~/devbox/storybook-workshop-codex-tN
pnpm test   # confirm green baseline BEFORE touching anything
```

Exception: **T6 adds a native dependency** (`better-sqlite3`). For T6 do NOT symlink —
run a real `pnpm install` inside the worktree so the optionalDependency builds there.

### Task end sequence (every task)

```bash
pnpm check && pnpm lint && pnpm test          # all green, additions included
git push -u origin <branch>
gh pr create --title "<task title>" --label king:review \
  --body "<summary + test counts + verification output>"
```

Do not merge. Do not touch `main`. The supervisor merges after review.

---

## 2. How the supervisor invokes a task

1. Copy the task file to claude.local: `scp D:/ai/codex-tasks/TN-*.md grantalope@100.104.9.90:~/codex-tasks/`
2. Create the worktree (commands above — supervisor may pre-create it).
3. Run Codex with the task file as the entire prompt:

```bash
ssh grantalope@100.104.9.90
source ~/.nvm/nvm.sh && nvm use 22
codex exec --cd ~/devbox/storybook-workshop-codex-tN \
  "$(cat ~/codex-tasks/TN-<slug>.md)"
```

4. Codex works until the Done-criteria checklist in the task is satisfied, then pushes +
   opens the PR.

## 3. Test gate (supervisor-enforced, non-negotiable)

After Codex reports done, supervisor independently runs IN THE WORKTREE:

```bash
pnpm check && pnpm lint && pnpm test 2>&1 | tail -20
```

- Full suite green (>= baseline 1097 + the task's promised new tests actually executed —
  verify the reported test count increased; a "green" run that never ran the new files fails the gate).
- Any pre-existing test modified to pass = automatic kickback unless the task explicitly
  authorized touching it.

## 4. Cross-model adversarial review checklist (Claude reviews Codex diff)

Supervisor generates `git diff origin/main...HEAD > /tmp/tN-diff.patch` and reviews with
P0/P1/P2 tagging. Hunt list:

- **Security inputs**: anything reaching SQL (T6 — parameterized statements only), file paths
  from env (traversal), HTTP bodies parsed without shape checks, `Math.random()` where
  CSPRNG required.
- **Determinism**: same seed → byte-identical output; hidden `Date.now()` / iteration-order
  dependence (object key order, `Map` vs sort) in pure generative services (T1/T2/T5 seeds).
- **Vacuous tests**: assertions that can't fail (`expect(x).toBeDefined()` on a literal),
  mocks asserting the mock, snapshot-only suites, promised counts padded with trivia.
- **Swallowed errors**: empty `catch {}`, fallbacks that hide real failures (T3 narrator
  degradation must log/flag, not silently mute; T6 sqlite fallback must be observable).
- **License/curation guards** (T4): grep-guard actually enforced in a test, not a comment;
  era guard runtime-thrown not doc-only.
- **Scope creep**: files touched outside the task's file plan; dependency additions not
  named by the task.
- **Page-count invariants** (T4): Lulu interior page count parity preserved both flag states.

## 5. Fix-request loop format

Findings go back to Codex as a follow-up `codex exec` in the SAME worktree with this prompt
shape (keeps the chain auditable):

```
FIX-REQUEST for <branch> (round R):
P0-1: <file>:<line> — <finding>. Required behavior: <spec>.
P1-1: ...
Rules: fix in a NEW commit (no amend). Re-run pnpm check && pnpm lint && pnpm test.
Reply with the verification output and updated test count. Do not touch unrelated files.
```

Then a second adversarial review pass over the fix-up diff. Expected terminal state: 0 P0,
0 unaddressed P1. P2s may ship with a note in the PR body.

## 6. Merge protocol (supervisor only)

Never merge from the main checkout (other agents may be active in it):

```bash
git -C ~/devbox/storybook-workshop fetch origin
git worktree add /tmp/sw-main-tmp -B main origin/main
git -C /tmp/sw-main-tmp merge --no-ff <branch> -m "Merge <branch> (TN: <title>)"
git -C /tmp/sw-main-tmp push origin main
git worktree remove /tmp/sw-main-tmp
git -C ~/devbox/storybook-workshop worktree remove ~/devbox/storybook-workshop-codex-tN
```

Run the full suite once more in the temp worktree before `push` if any sibling task merged
since the branch's review.

## 7. Recommended task order

**T6 → T1 → T2 → T4 → T3 → T5**

- T6 first: smallest blast radius, exercises the whole protocol loop cheaply.
- T1 before T2: T2's skeleton briefs feed T1's composition planner conceptually, but they
  share no code — order is for reviewer context only.
- T4 before T3: T3's read-along style card consumes T4's registry if both merge; T3 has a
  graceful absent-registry path either way.
- T5 LAST: its drivers are repo-side only; the supervisor executes them on the GPU box
  (100.101.215.25, ComfyUI on :8188) after merge, in phased runs (`--limit`, `--filter`).
  Nothing in CI ever calls the live GPU.

## 8. Conflict notes between tasks

- T1 and T5 both define the `BankManifest` JSON shape — they are specified identically
  (T1 owns the TypeScript types at `src/lib/services/scenegrammar/types.ts`; T5's manifest
  builder imports from there if merged after T1, else duplicates the shape in the script
  with a TODO to converge). Supervisor: if both land, verify one source of truth.
- T3 and T4 both add an additive section to the read-along page
  `src/routes/(marketing)/r/[shortcode]/+page.svelte` — merge whichever lands second by hand.
- No other intentional overlaps. Two tasks touching the same file outside this list = scope
  creep, kick it back.
