---
type: Decision
title: Never Use git add -A — Stage Explicit Paths Only
description: git add -A captured working-tree deletions into a commit, silently deleting src/routes/demo/+page.svelte and 17 tests. Explicit path staging is now mandatory.
tags: [git, workflow, hazard, ci, testing]
timestamp: 2026-06-12T00:00:00Z
status: enforced
---

# Decision

`git add -A` (or `git add .`) is **banned** from any automated or agent-driven commit workflow. All staging must name explicit file paths:

```bash
# WRONG
git add -A
git add .

# CORRECT
git add src/routes/demo/+page.svelte src/lib/util/uuid.ts
```

# What Happened

During a multi-agent session, `git add -A` was run after a worktree operation that had left some files deleted in the working tree (they existed in another worktree or had been temporarily removed during a refactor).

The commit silently included those deletions:

- `src/routes/demo/+page.svelte` — deleted
- `tests/demo-page.test.ts` — deleted (17 tests)

The deletion was not caught before push because:
1. The commit message gave no indication files were being removed.
2. CI ran against the post-deletion tree, so the 17 deleted tests simply stopped existing rather than failing.
3. The build still passed (no imports of the deleted files).

# Rules

1. **Stage explicit paths** in all automated commits. List every file by name.
2. **Commit message files go in `/tmp`**, never inside the repo directory. A file like `commit-msg.txt` placed in the repo root will be swept by `git add -A` and committed.
3. **Verify the merge diff before pushing**: `git diff --stat HEAD~1 HEAD` — look for unexpected deletions (lines starting with `-` for filenames, or `D` in `--name-status` output).
4. **Pre-push hook** (recommended): fail if `git diff --name-status HEAD~1 HEAD` shows any `D` (deleted) lines that are not explicitly listed in the commit intent.

# Checklist for Agent Commit Workflows

```bash
# 1. Show what WILL be staged
git status --short

# 2. Stage only what you authored
git add src/path/to/file1.ts src/path/to/file2.svelte

# 3. Verify staged set — look for unexpected D lines
git diff --cached --name-status

# 4. Write commit message to /tmp (never in repo)
git commit -m "$(cat /tmp/commit-msg.txt)"

# 5. Verify final diff before push
git diff --stat origin/main...HEAD
```

# Alternative Rejected

**`.gitignore` the commit message file**: fragile — requires every agent to use a predictable filename. The `/tmp` rule is more robust and generalizes to all temporary files.

**Post-commit hook to detect deletions**: hooks run after the commit is already made and signed. A pre-commit check is safer but still doesn't catch the root cause (using `-A`). The explicit-path rule prevents the issue entirely.
