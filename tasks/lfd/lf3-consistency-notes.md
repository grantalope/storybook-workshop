# LF3 character-consistency instrument (2026-06-13)

Deterministic CLIP-cosine instrument (NOT an LLM judge): for each example book,
embed `hero-portrait.jpg` + every `spread-*.jpg` (clip-vit-base-patch32, mean-pooled,
normalized) and measure cosine(spread, hero) per spread. `pnpm score:consistency`
→ `tasks/lfd/consistency-scores.json`.

## Baseline (8 example-books, threshold 0.6)
- meanConsistencyAcrossBooks = **0.8483** (per-book means 0.78–0.88).
- 0 spreads flagged at 0.6 (all cosines ≥ 0.73) — the example-books are
  acceptably consistent.
- **Signal: climax spreads are consistently the lowest** (p089 climax 0.766,
  p083 climax 0.775); setup spreads are highest (~0.94). Action/climax
  compositions drift most from the clean hero portrait — exactly where character
  consistency is hardest and matters for a print book.

## Honest limitations (follow-ups)
1. **Threshold 0.6 is too lax** to catch real drift. The useful flag is RELATIVE:
   a spread whose cosine is well below its own book's mean (e.g. mean − 0.08) or a
   global ~0.78 cut. A spurious extra figure (book3 scene-6) is a composition
   change CLIP may still score ~0.7, so absolute-0.6 would miss it — a
   relative/per-book-z flag is the v2 refinement.
2. **book3's known scene-6 contamination is NOT in this run** — book3's rendered
   images are out-of-git (`D:/devbox/storybook-real-book-3/`, preserved via
   render-manifest only). To have LF3 auto-flag scene-6, run it against book3's
   image dir once those images are in a scorable location.

## Status
LF3 is the third of three LFD instruments (LF2 story-quality, LF1 photo-match,
LF3 consistency) — all deterministic, all on origin/main. The instrument works;
the threshold/relative-flag tuning is a refinement, not a blocker.
