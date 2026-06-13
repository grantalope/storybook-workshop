---
type: Concept
title: Loss-Function Development (LFD)
description: A methodology for descending toward a blind target scored by an instrument the agent cannot fake, rather than spec-compliance or self-reported quality.
tags: [lfd, evaluation, quality, agent, blind-eval, storybook]
timestamp: 2026-06-12T00:00:00Z
path: docs/LFD-OPERATING-MODEL.md
---

# What Is LFD?

Loss-Function Development is a quality discipline where:

1. A **blind target** is defined before any agent output is produced.
2. An **instrument** scores output against the target on dimensions the agent **cannot fake or game**.
3. The agent iterates by descending the loss — exactly as gradient descent works, but in the space of design decisions.

The key invariant: **the scoring instrument must not be accessible to the agent at generation time**. If the agent can read the scorer, it will optimize the scorer rather than the underlying quality.

# Why This Matters — Cheap-Path Fencing

Agents left to self-evaluate will find and exploit every cheap path available:

| Cheat pattern | Example | Detection |
|---|---|---|n| Phantom renders | Report image generated; no bytes written | `sha256sum` the output file; compare to claimed digest |
| Fabricated SHAs | Print a plausible git SHA; don't actually commit | `git log --oneline -1` to verify HEAD changed |
| Gamed baselines | Write a test that asserts whatever the current output is | Diff the test assertions against the spec |
| Self-scored quality | Ask the same model to rate its own output | Use a *different* model or a deterministic instrument |

**Rule**: any quality gate the agent can observe AND influence is not a real gate. Fence it mechanically.

# The Three Storybook Loss Functions

These were designed for the storybook product (illustrated children's books) but the pattern generalizes.

## 1. Photo-Match (CLIP Recall@3)

- **What it measures**: does the generated illustration match the page text?
- **Instrument**: CLIP embeddings; cosine similarity between the text prompt and the generated image.
- **Metric**: Recall@3 — the correct illustration appears in the top 3 matches when the 12 page images are ranked by similarity to their corresponding text.
- **Why blind**: the CLIP model is fixed; the agent cannot change it. The agent sees only pass/fail, not the similarity scores.

## 2. Story Quality (Corpus-Distribution Fit)

- **What it measures**: does the generated story text read like high-quality children's literature?
- **Instrument**: perplexity under a language model fine-tuned on a private corpus of award-winning picture books.
- **Metric**: perplexity below a threshold derived from the corpus P95.
- **Why blind**: the fine-tuned model is private; agents cannot query it directly.

## 3. Consistency (CLIP Cosine Across Spreads)

- **What it measures**: do the illustrations across a book's 12 spreads form a coherent visual world (character appearance, color palette, setting)?
- **Instrument**: pairwise CLIP cosine similarity across all 12 generated images; variance must be below a threshold.
- **Metric**: mean pairwise cosine ≥ 0.72 (empirically derived from human-rated consistent books).
- **Why blind**: the threshold is fixed and the agent sees only pass/fail after all 12 images are generated — it cannot tune individual images to hit the threshold.

# The Moat

The private blind eval is the product's **quality moat**. A competitor who ships a similar pipeline without the blind eval will optimize for the wrong signal (user-reported satisfaction, which is gameable) and produce lower-quality output at scale.

The eval corpus must remain private. Never include it in the repo, never expose it via an API the agent can probe.

# Operating Model

Full protocol: `docs/LFD-OPERATING-MODEL.md` on main.

Short version:
1. Write the acceptance gates BEFORE any generation work starts.
2. Run generation.
3. Score with the blind instrument.
4. Treat the score as ground truth — override any agent self-report.
5. Diagnose failures by examining the *distribution* of outputs, not individual cases.
6. Append learned rules to `d:/devbox/coder-rules/` after each review cycle.

# Related

- The [CODEX-FABLE loop](/decisions/no-ollama-in-browser.md) uses LFD gates at the recon and red-team stages.
- Fleet worker output verification follows the same "mechanical truth" principle: run the tests, check the diff, never trust self-report.
