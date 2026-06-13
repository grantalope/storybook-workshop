# LF2-v2 investigation — picture-book corpus + refrain-reward (2026-06-13)

## Goal
Loop-8's descent surfaced that LF2 v1 INVERTS: a refrain-rich "good" story
(67.95) scored BELOW a plain one (82), because v1's two-sided fit on
`repetitionScore` PENALIZED refrains and the corpus was Gutenberg novels. LF2-v2
tried to fix this with (a) a picture-book-shaped corpus and (b) a scorer that
rewards refrains in healthy-vocab prose.

## What was built + measured (in /mnt/d/devbox/lf2-work, not landed)
- `fetch-picturebook-corpus.mjs`: tale-boundary segmentation of PD fable/tale
  collections. RESULT: 120 tales — but ALL from Aesop (11339); the segmenter hit
  TARGET on the first book. Aesop fables are high-vocab, LONG-sentence moral prose.
- `story-quality-scorer-v2.mjs`: refrainScore one-sided-positive; repetitionScore
  penalty gated to low-vocab text; vocab gate moved from corpus-relative to an
  ABSOLUTE TTR floor (0.40) after the relative gate wrongly failed the refrain
  story.

## Measured outcome — inversion PERSISTS (honest)
Story feature reality: plain ttr 0.564 / wps 4.68 / refrain 0.04; rich ttr 0.465 /
wps 7.96 / refrain 0.111; degenerate ttr 0.25 / wps 1.09 / rep 0.73.
- Brackets fine: corpus tale 97.2, degenerate 18.76 (clean good-vs-degenerate).
- Descent (scorer-v2, absolute gate): plain **69.95**, rich **53.23**. Rich still
  LOSES (improved from 46.75 but not flipped).

## Root cause (the real finding — a DATA WALL, like LF1's generation wall)
1. **No PD corpus matches MODERN picture-book structure.** Available PD short-text
   (Aesop/Grimm/Andersen) is 19th-century prose: LONG sentences (Aesop wps p10
   15.3), high vocab, few refrains. Modern picture books are SHORT-sentence +
   refrain + dialogue. Scoring picture-book stories against Aesop penalizes their
   short sentences regardless of refrain handling — the refrain reward can't
   overcome the structural-fit penalty.
2. **The descent's premise is itself unverified.** "rich should beat plain"
   assumes the refrain-laden lane-generated story is genuinely better — not
   confirmed by reading. The instrument scoring plain higher may partly be
   correct.

## Conclusion / recommendation
LF2 (v1, on main) is RELIABLE as a **coherence / degenerate gate + readability
proxy** (97 vs 19 separation is real and useful — it will catch broken/degenerate
generated stories). It is NOT reliable for picture-book CRAFT scoring, and
corpus-fit cannot make it so given PD-corpus limits. True craft-level story
quality needs either (a) curated MODERN picture-book exemplars (largely not
public-domain — a licensing/product decision) or (b) an LLM-rubric judge (which
LFD cautions against for gameability, but may be the only craft-level path) — both
are PRODUCT/HUMAN decisions, not an autonomous corpus tweak.

LF2-v2 is therefore NOT landed as a replacement (would be a v2 that doesn't beat
v1 = gratuitous). v1 stays as the degenerate/coherence gate. This investigation +
its numbers are the deliverable.
