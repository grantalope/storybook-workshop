# LF2 Descent Step 1 — and the instrument flaw it surfaced (2026-06-13)

## What was run
Generated two stories (same topic: a hedgehog afraid of rain) via the groq
llama-3.3-70b free-cloud lane, both extracted CLEAN through the shared
`lane-extract.mjs` sanitizer, both scored by the LF2 instrument:

| version | words | LF2 score | weakest features |
|---|---|---|---|
| BASELINE (plain, choppy, no refrain/dialogue) | 117 | **82.0** | wordCount(0), avgWordsPerSentence(0.44) |
| RICH (corpus-hinted: ~15-word sentences, a mutating REFRAIN, dialogue, exclamations) | 215 | **67.95** | repetitionScore(0), exclaimQuestionRatio(0), wordCount(0) |

**Result: NO instrument-verified increase (82 → 67.95).** The "improved" story
scored LOWER.

## Why — the honest finding (NOT a bug; the eval is mis-targeted)
The RICH version's **refrain** ("But Pip did not like the rain, not one little
bit." recurring + mutating at the climax — textbook picture-book craft) drove its
`repetitionScore` UP. But the LF2 corpus is **Project Gutenberg children's
CLASSICS** (Alice, Grimm, Oz, Wind in the Willows) — long-form PROSE NOVELS whose
`repetitionScore` distribution is ≈0 (p10=p50=p90=0). The two-sided-fit scorer
therefore reads any refrain/repetition as an out-of-distribution defect and
penalizes it. It also penalizes short word counts (corpus chunks are 300-word
novel segments; a real 32-page picture book is shorter).

So LF2 v1 measures **"how like a Gutenberg prose novel is this text"**, NOT
**"how good a read-aloud PICTURE BOOK is this"**. It penalizes exactly the
craft (refrains, repetition-as-device, brevity) that defines good picture books.
This also partly explains book3's honest 52.6 (terse spread_text + no refrain
hurt it twice over).

## The deeper problem (why it's not a quick knob)
A surface scorer can't easily tell a CRAFTED refrain ("But Pip did not like the
rain...") from DEGENERATE repetition ("Dog. Cat. Dog. Cat."). Both raise
repetitionScore. Naively rewarding repetition would let the degenerate fixture
(currently 33) climb. Distinguishing them needs structure-aware features
(a refrain = a multi-word phrase recurring at beat boundaries; degenerate =
short tokens repeating throughout) and/or a picture-book-appropriate corpus.

## Corrective direction (LF2 v2 — backlog, see loop goals)
1. CORPUS: replace/augment the Gutenberg-prose corpus with picture-book-shaped
   PD text (short fairy tales, cumulative tales, nursery refrains — e.g. segment
   on the TALE not a 300-word window; favor Mother Goose / Aesop single fables
   over Alice chapters).
2. FEATURES: make `refrainScore` one-sided-positive (more is better up to a cap),
   and replace the blanket `repetitionScore` penalty with a "structural refrain"
   detector that rewards a phrase recurring at beat boundaries while still
   flagging mindless token repetition (keep the degenerate fixture < 40).
3. Re-baseline the 8 example-books + book3 against v2; re-run this descent — a
   genuine read-aloud improvement should then raise the score.

## Meta (process)
The sanitizer (`d:\devbox\lane-extract.mjs`, built this session) made this result
TRUSTWORTHY — both lane outputs came back verdict=CLEAN with no hand-rolled
extraction. The prior whack-a-mole on `<think>`/preamble/truncation is fixed at
the loop level (coder-rules/global.md "LANE OUTPUT HYGIENE"). A descent that
honestly reports "the eval is wrong" is the LFD system working as intended.
