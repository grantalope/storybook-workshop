# LF1 photo-match — bigger eval + descent step (2026-06-13)

## Bigger, honest eval (40 held-out spread queries)
`score-match-full.mjs` (pnpm: extend of score:match) uses EVERY `spread-*.jpg`
across the 8 example-books as a query (40 total, spreads-only = held out from the
portrait bake), matched over all 150 archetypes (random baseline 2%).

- **recall@1 = 0.50, recall@3 = 0.675** (vs 0.75 on the smaller 8-setup eval —
  the 8-setup number was optimistic; setup spreads are the cleanest character
  shots).
- Per-book recall@3: p005/p006/p024/p083 = **1.0** (perfect); p002 = 0.8;
  p089 = 0.4; p011 = 0.2; **p065 = 0.0**.

## Descent attempt (measured, not predicted)
Tried the suggested descent — average each archetype's portrait + portraits-thumb
embedding for a more robust rep (`descent-eval.mjs`, in-memory, no clobber):

- baseline (portrait-only): recall@3 **0.675**
- portrait+thumb-avg: recall@3 **0.65**  (delta **−0.025** — slightly WORSE)

Instrument-verified: the average does NOT help (the thumbnail is a downscale of
the same portrait — no new signal, slight dilution). **Kept portrait-only** (what
is on main). The archetype representation is NOT the lever.

## The real lever (why 0.9 is generation-gated, not matcher-gated)
The failing books (p065 0.0, p011 0.2, p089 0.4) fail because their CHARACTER
RENDERS drifted from the archetype portrait — the spread depicts a character that
genuinely looks different from `portraits/pNNN.jpg`. CLIP is correctly reporting
low similarity. This is the SAME drift LF3 (character-consistency) measures — the
instruments interconnect: LF1 match-failure ⇔ LF3 low-consistency.

Pushing recall@3 toward 0.9 therefore requires GENERATION-SIDE fixes (render the
book hero consistently with the archetype portrait — e.g. reference-image
conditioning at generation time), NOT a matcher/embedding tweak. That is a
generation follow-up (image-gen, currently codex-off; ComfyUI path), out of scope
for an autonomous matcher descent.

## Status
LF1 the CORE MECHANIC is fixed and works (was dead at 64-dim placeholder; now real
512-dim CLIP, recall@3 0.675 honest = ~34× random). Reaching 0.9 is a
generation-quality follow-up, not autonomous code. Backlog, not a blocker.
