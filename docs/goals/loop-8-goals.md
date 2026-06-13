# Loop-8 Goals — LFD Foundation: LF2 Story-Quality Blind Eval

Base: d9c6f89
Obj: Build the FIRST loss-function instrument (story quality) as a BLIND,
deterministic, un-fakeable scorer; run the first descent pass. The moat = the
private blind eval. CODEX-FREE (no image gen); all codegen → free-cloud/local
lanes, orchestrator judges. Ref: docs/LFD-OPERATING-MODEL.md.

## Loop-7 Results (retro — instrument-verified)
LANDED on origin/main (d9c6f89; verified 11/11 gates, 1384 tests green):
- **Goal 3 FULLY MET**: probe-regression test (e579054 → merge d9c6f89). 15/15.
  EXTENDED the corpus C1→C8 (added money-invariants, absorbing-FSM-state,
  broken-import). Anti-cheat verification of the harness itself — the instrument
  the orchestrator cannot fake.
- **8 real example-books on main** (p002/p005/p006/p011/p024/p065/p083/p089):
  56 real jpgs (~400–600KB each), 8 stories. The "render real books" spirit
  OVER-delivered via the codex example-book pipeline (not the single book3 path).
- ALL 11 gates PASS; G11 logic-gaps: none.

REAL BUT UNPRESERVED (verified on disk this loop):
- book3 "Why Do Stars Blink?" rendered END-TO-END via **ComfyUI 4090** (NOT codex):
  7-beat story.json + 6 harmonized ComfyUI spreads (~2MB each) + a **21.7MB
  print-ready PDF** (`book3-why-do-stars-blink.pdf`, sha a79c62b6, Lulu spec PASS,
  vision score 8.5/10). Lives ONLY on ephemeral Windows disk
  (`D:/devbox/storybook-real-book-3`), uncommitted. This is the strongest
  end-to-end product proof (photo→story→render→harmonize→print-PDF). → Goal 0
  preserves it (lightweight data to git + out-of-git binary manifest).
  KNOWN CAVEAT (D4 human taste-call): scene-6 climax (Van Gogh Starry Night style)
  has identity contamination — a spurious 3rd child figure harmonization missed.

ABANDONED (the code-merge trap):
- The `feat/book3-story` BRANCH merge: STALE (forked pre-validation-harness); a
  wholesale merge would REVERT 1946 lines incl the 7 probes + corpus + G11. Leave
  the branch; do not merge. (book3's real OUTPUT is preserved via Goal 0 instead —
  distinct from this poisoned branch.)

## Goal 0 [P1] Preserve the verified book3 product proof (lightweight + manifest)
Target: book3's reproducible DATA on main + an integrity manifest for the heavy
binaries (kept out-of-git, pregen-bank pattern). Do NOT commit the 109MB of
PDF/PNG to git.
Action:
- Commit `docs/samples/book3/{story.json, read-along-bundle.json, book-schema.json,
  render-manifest.json}` to main (data only, ~30KB).
- `render-manifest.json` lists the PDF + 6 harmonized PNGs with bytes + sha256,
  the ComfyUI render provenance, Lulu PASS, the 8.5 score, the scene-6 caveat, and
  the Windows source path. Operator wires binaries to LFS/CDN before launch.
Gate: `git ls-tree origin/main docs/samples/book3/story.json` exits 0;
`node -e 'process.exit(JSON.parse(require("fs").readFileSync("docs/samples/book3/story.json","utf8")).beats.length===7?0:1)'`;
render-manifest lists ≥7 artifacts each with a sha256.

ROLLED FORWARD:
- Goal 4 (identity/style-bleed, self-scored 7/10) IS LFD **LF3** (character
  consistency) → LOOP-10.
- Story quality (self-scored 74/100) IS LFD **LF2** → **THIS loop**.

EVENT: operator stopped storybook codex mid-loop (image lanes off, 2026-06-13).
Loop-8 is codex-free BY DESIGN (eval+scorer = corpus/deterministic-NLP, no image
gen) — unaffected.

## The LFD shift (why this loop is the durable work)
Loops 1–7 were spec-driven (gates green = done). Story quality has been
SELF-SCORED at 74/100 by the producing agent — exactly the cheap path LFD
forbids. Loop-8 builds the BLIND instrument that COMPUTES the number so no agent
can fake it. Spec gates (G1–G11) stay for binary correctness; LFD layers on top
for the quality descent target.

## Goal 1 [P0] Build the LF2 blind corpus (public-domain kids-lit)
Target: ~100 public-domain children's stories (Project Gutenberg children's
bookshelf) fetched + normalized into a private corpus the story-PRODUCING agent
never reads.
Action (codegen → FREE-CLOUD lane; orchestrator reviews):
- `scripts/lfd/fetch-kidlit-corpus.mjs`: pull ~100 PD kids stories, strip
  boilerplate, segment into page-turn units → `static/lfd/kidlit-corpus/`
  (raw out-of-git if large; manifest + sha256 in git).
- Derive rubric feature DISTRIBUTIONS (deterministic, NO LLM): read-aloud cadence
  (syllables/sentence dist), page-turn hook coverage, refrain presence +
  climax-mutation, age-band vocab (Dale-Chall / AoA), show-not-tell ratio,
  concrete-noun density → `static/lfd/kidlit-features.json`.
Blind-eval-path: `static/lfd/kidlit-corpus/` — the answer key; story-producing
agents MUST NOT read it.
Wall-clock: 90 min. Entropy-rule: if corpus features collapse (all stories score
alike), corpus too small/biased → widen the source list.
Gate (self-validatable):
- `ls static/lfd/kidlit-corpus/*.txt | wc -l` ≥ 80
- `node -e 'process.exit(JSON.parse(require("fs").readFileSync("static/lfd/kidlit-features.json")).features.length>=6?0:1)'`
- corpus manifest committed; raw corpus gitignored or LFS.

## Goal 2 [P0] Build the deterministic StoryQualityScorer + `pnpm score:story`
Target: a PURE (no LLM-judge) scorer mapping a story.json's
distance-to-corpus-distribution → 0..100.
Action (codegen → FREE-CLOUD lane; orchestrator reviews the scoring MATH for
gameability):
- `src/lib/lfd/StoryQualityScorer.ts`: load kidlit-features.json; score a
  story.json per rubric feature as percentile-fit to the corpus distribution;
  weighted aggregate → 0..100. DETERMINISTIC (same input → same output; no
  randomness, no network).
- `scripts/lfd/score-story.mjs` + package.json `"score:story"`.
- `tests/lfd/story-quality-scorer.test.ts`: (a) deterministic (same in→same out,
  2 runs byte-identical), (b) a known-good PD story scores high, (c) a degenerate
  story (one-word sentences, no refrain) scores low, (d) ZERO network/LLM
  (assert no fetch).
Scoring-CLI: `pnpm score:story <path>`. Wall-clock: 90 min.
Entropy-rule: if scorer rewards length/keyword-stuffing, it's gameable → add an
anti-gaming fixture + re-weight.
Gate:
- `pnpm score:story <PD-corpus-story>` ≥ 85; `<degenerate-fixture>` ≤ 40.
- `tests/lfd/story-quality-scorer.test.ts` green; deterministic across 2 runs.
- scorer makes zero network calls (test asserts).

## Goal 3 [P1] Score the 8 example-book stories + ONE descent step
Target: run `pnpm score:story` on all 8 example-books' story.json; record the
BLIND scores (not self-scored). Establish the honest baseline (expect below the
old self-scored 74 — that's the reckoning LFD exists to surface).
Action:
- `scripts/lfd/score-all-books.mjs` → `tasks/lfd/story-scores.json`
  `{bookId, score, weakestFeatures[]}`.
- For the lowest-scoring book: identify its weakest rubric feature, regenerate
  that story via a FREE-CLOUD lane with a corpus-DERIVED hint (NOT the corpus
  itself), re-score. ONE descent step.
Wall-clock: 60 min. Entropy-rule: overfit reflection — if the regen only improved
by memorizing one feature, note it; next step targets a different feature.
Gate:
- `tasks/lfd/story-scores.json` has 8 entries, each instrument-computed.
- the descended book's score STRICTLY increases vs its baseline (instrument-
  verified, not self-claimed).

## Done Definition (ALL required, instrument-verified)
1. `static/lfd/kidlit-features.json` on main — ≥6 features, from ≥80 PD stories.
2. `src/lib/lfd/StoryQualityScorer.ts` + `pnpm score:story` on main; deterministic;
   zero network.
3. `tests/lfd/story-quality-scorer.test.ts` green (in G1); gate count stays 11
   (a G12-story-quality gate is OPTIONAL — only add if it doesn't game G2).
4. `tasks/lfd/story-scores.json` — 8 books scored by the INSTRUMENT.
5. One descent step → instrument-verified score increase.
6. ALL existing 11 gates still PASS on origin/main.

## Queued (explicit — NOT this loop)
- **LOOP-9 = LF1** photo→archetype real-CLIP eval (the CORE mechanic; fixes B1
  placeholder-hash embeddings). Labeled (photo→ideal-archetype) BLIND pairs +
  recall@3 CLI (`pnpm score:match`). Descend recall@3 → ≥0.9. Cap archetype count
  so enumeration can't win.
- **LOOP-10 = LF3** character consistency (absorbs loop-7 Goal 4). embedding-cosine
  of hero across spreads vs the character sheet (`pnpm score:consistency`),
  DETERMINISTIC, NOT an LLM-judge. Flag any spread below threshold.

## Delegation plan (token discipline — operator mandate)
- Corpus fetch + scorer codegen + test codegen → **FREE-CLOUD lanes** (P1, no
  secrets): nvidia kimi-k2.6 / deepseek-v4 / cerebras gpt-oss-120b via the smart
  queue (`d:\devbox\llm-queue`). NOT the 4090 (free-cloud > local for non-secret
  code). Route by SENSITIVITY: this is generic tooling, no secrets → P1.
- Orchestrator (me, main-loop): the scoring MATH design + gameability review +
  accept/reject diffs + merges + the descent-step ruling. Judgment only.
- Workflow phase agents (if used) = FOREMEN driving lane jobs, not typists
  (haiku=mechanical orchestration, sonnet=diff review/judgment).
- NO codex (images off; loop is codex-free regardless).

## Human-only items (unchanged)
D1: Narrator voice ear-pick (docs/VOICE-PICK.md — READY).
D2: Stripe + Lulu sandbox credentials.
D3/D4: book + demo eyeball; host decision; first print order.

## Verification commands
```bash
# corpus + features
ls static/lfd/kidlit-corpus/*.txt | wc -l                       # >= 80
node -e 'const f=JSON.parse(require("fs").readFileSync("static/lfd/kidlit-features.json","utf8")); process.exit(f.features.length>=6?0:1)'

# scorer deterministic + bracketed
pnpm score:story static/lfd/kidlit-corpus/$(ls static/lfd/kidlit-corpus | head -1)  # >= 85
A=$(pnpm -s score:story tests/lfd/fixtures/degenerate-story.json); echo "$A"        # <= 40
pnpm test tests/lfd/story-quality-scorer.test.ts                # green

# 8 books scored by the instrument
node scripts/lfd/score-all-books.mjs && node -e 'const s=JSON.parse(require("fs").readFileSync("tasks/lfd/story-scores.json","utf8")); process.exit(s.length===8?0:1)'

# gates still green
node scripts/gates/run-all.mjs                                  # ALL GATES PASS (11/11)
```
