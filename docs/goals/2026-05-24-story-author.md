# Goal: Storybook Workshop — Story Author + Pedagogy Pipeline

**Wave:** 1 (parallel)
**Branch:** `feat/storybook-workshop-story-author`
**Worktree:** `~/devbox/pachinko-app-sw-story-author/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §3.5, §3.6, §7.1, §7.3, §7.4, §7.5
**Executor preference:** claude

---

## Why

The brain of the workshop. Given parent inputs (theme, occasion, length, kid name, age, Ehri phase, sidekick, locale), produce a Pixar 7-beat scene tree with: Stein-Glenn story-grammar enforcement, Tier-2 vocab targeting (10-encounter rule), age-band sentence-length calibration (Brown 1973), rhyme/alliteration density for ≤5y readers, dialogic margin prompts (PEER/CROWD), KidsContentSafety + PrivacyFilter on every output. Single LLM call via kernel `inference.generate`. Citation-backed; everything ties to a peer-reviewed paper.

---

## Scope (files to create)

```
src/routes/dashboard/services/storybook-workshop/author/
├── StoryAuthorService.ts              # main: input → scene tree
├── Tier2VocabPlanner.ts               # picks 3-5 target words per book
├── AgeBandCalibrator.ts               # Flesch-Kincaid pass + regen-on-overflow
├── StoryGrammarValidator.ts           # Stein-Glenn 6-element check per beat
├── StoryBudgetAllocator.ts            # distribute spreads across beats per page_budget
├── DialogicPromptGenerator.ts         # PEER/CROWD prompts per beat
├── tier2-vocab-corpus.ts              # 500 curated kid-appropriate Tier-2 words
├── prompts/
│   ├── system-prompt-template.ts      # cached per-kid prompt (Stage 7+ LLM compression)
│   └── user-message-template.ts       # dynamic per-call
└── types.ts                           # StoryInput, SceneTree, Beat, Scene, Spread shapes
tests/storybook-workshop/author/
├── story-author-pipeline.test.ts      # end-to-end with mocked LLM
├── tier2-vocab-planner.test.ts
├── age-band-calibrator.test.ts
├── story-grammar-validator.test.ts
├── story-budget-allocator.test.ts
└── dialogic-prompt-generator.test.ts
```

## Out of scope

- ❌ No WB scene-rendering — that's goal #12 + the assembler.
- ❌ No PreText typography compositing — that's goal #4.
- ❌ No PDF assembly — that's goal #5.
- ❌ No UI wiring — that's goal #6.
- ❌ No new ONNX classifier — KidsContentSafety is goal #2.

---

## Build sequence

### Phase 1 — Types
1. Read spec §3.5-§3.6, §7.1-§7.5 in full + research synthesis embedded in spec §7.1.
2. Create `types.ts`:
   - `StoryInput = { kidName, ageBand, ehriPhase, theme, occasion, sidekickSettlerId, supportingCast, localeBiome, targetSpreads, dedicationText, dialogicPromptsEnabled, easierReadingMode }`
   - `Spread = { spreadIndex: number, spread_text: string, text_focus: 'left'|'right'|'wraps'|'spot' }`
   - `Scene = { sceneId: string, spreadCount: 1|2|3|4|5, sceneBrief: string, spreads: Spread[] }`
   - `Beat = { id: 1..7, beat_name: 'setup'|'catalyst'|'debate'|'midpoint'|'trial'|'climax'|'resolution', emotional_arc: string, scenes: Scene[] }`
   - `SceneTree = { title: string, back_cover_blurb: string, page_budget: number, beats: Beat[7], tier2_words: string[], dialogic_prompts?: DialogicPrompt[] }`
   - `EhriPhase = 'pre-alphabetic' | 'partial-alphabetic' | 'full-alphabetic' | 'consolidated-alphabetic'`

### Phase 2 — Tier-2 vocab corpus + planner
3. `tier2-vocab-corpus.ts`: curated 500 Tier-2 words. Each entry: `{ word: string, syllables: number, ageBandMin: AgeBand, definition_kid: string, themeAffinities: string[] }`. Sourced from Beck/McKeown/Kucan Tier-2 lists + age-appropriate filtering.
4. `Tier2VocabPlanner.ts`:
   - `pickWords(input: StoryInput, priorBooksWords: string[]): string[]` — 3-5 target words.
   - Weights: theme relevance (high), age-band match (mandatory), anti-repetition vs prior series books (high).
   - Series-level spaced exposure: words from prior books reweighted to reappear 2-3 books later (~10-encounter rule).

### Phase 3 — Budget allocator
5. `StoryBudgetAllocator.ts`:
   - `allocate(targetSpreads: number): Record<BeatId, number>` — distribute spreads across 7 beats with default weights: setup 12%, catalyst 6%, debate 12%, midpoint 22%, trial 18%, climax 18%, resolution 12%.
   - Round to whole spreads, ensure sum == targetSpreads ± 0, no beat gets 0 spreads.
   - `validate(beats: Beat[]): boolean` — checks LLM output spread sum matches budget.

### Phase 4 — Story grammar validator
6. `StoryGrammarValidator.ts`:
   - Stein-Glenn 6 elements: setting, initiating_event, internal_response, attempt, consequence, reaction.
   - Map to beats: setup=setting, catalyst=initiating_event, debate=internal_response, midpoint+trial=attempts+consequences, climax=major_consequence, resolution=reaction.
   - `validate(tree: SceneTree): { passed: boolean, missing: StoryGrammarElement[], beatGaps: Map<BeatId, string[]> }`.
   - Simple keyword + structural-check pass. (Not LLM-based to keep deterministic.)

### Phase 5 — Age-band calibrator
7. `AgeBandCalibrator.ts`:
   - Per-band caps (sentence length, syllables, paragraph length) per spec §3.6.
   - `calibrate(tree: SceneTree, input: StoryInput): { passed: boolean, overflows: { spreadIndex, metric, actual, cap }[] }`.
   - Optional: regenerate-on-overflow via callback to caller (story-author orchestrates).
   - Flesch-Kincaid via `text-readability` pkg (or inlined formula if pkg unavailable on Windows).

### Phase 6 — Dialogic prompt generator
8. `DialogicPromptGenerator.ts`:
   - Per-beat default prompt type: setup=Wh, catalyst=Open-ended, debate=Distancing, midpoint=Recall, trial=Completion, climax=Open-ended, resolution=Distancing.
   - `generate(tree: SceneTree, input: StoryInput): DialogicPrompt[]` — 1-2 prompts per spread.
   - Currently LLM-generated as part of main author call (see Phase 7); this module wraps + types the prompts.

### Phase 7 — StoryAuthorService (main orchestrator)
9. `StoryAuthorService.ts`:
   - `author(input: StoryInput): Promise<SceneTree>` — single entry point.
   - Step 1: Tier2VocabPlanner picks words. StoryBudgetAllocator computes budget map.
   - Step 2: build LLM payload — system prompt = cached per kid profile (compressed per Stage 7+ rules); user prompt carries dynamic inputs + budget map + Tier-2 word list.
   - Step 3: `kernel.connect('inference.generate', 'storybook-workshop-author').chat({ messages, schema: SceneTreeJSON })`. Fall back to direct LLR if pre-boot.
   - Step 4: `KidsContentSafetyService.scan(every-spread-text)` — fail-fast on any unsafe output.
   - Step 5: `privacyFilterService.scrub(every-scene-brief)` — strip any leaked PII.
   - Step 6: `StoryGrammarValidator.validate(tree)` — retry once with corrective prompt if missing elements.
   - Step 7: `AgeBandCalibrator.calibrate(tree, input)` — regen 1× for overflowing spreads.
   - Step 8: `DialogicPromptGenerator.generate(...)` if `dialogicPromptsEnabled`.
   - Step 9: budget validator — if sum mismatch after 2 LLM retries, deterministic redistribute via allocator.
   - Step 10: 2-retry final → template fallback via `literarySpineBank` (existing infra). Telemetry counter for fallback.
10. System prompt template references:
    - Ehri-phase decoding match (skip phonics-tricky words in pre-alphabetic)
    - Brown's MLU sentence-length caps
    - Tier-2 word usage requirements (each word ≥2 times across varied contexts)
    - Stein-Glenn structural mandate
    - KidsContentSafety policy summary
    - PreText typography effect hints per beat
    - Rhyme/alliteration emphasis if `ageBand <= preschool`

### Phase 8 — kernel allowlist + caller registration
11. Extend `src/kernel/inference/contracts.ts` `inference.generate.requirableBy` with: `storybook-workshop-author`, `storybook-workshop-vocab`, `storybook-workshop-prompts`. Single targeted edit. (No other contract changes.)

### Phase 9 — Tests
12. `story-author-pipeline.test.ts` (vitest, mocked LLM):
    - Happy path: returns valid SceneTree matching schema, spread sum == targetSpreads, all 7 beats present, ≥3 Tier-2 words used.
    - LLM returns unsafe text → retry with corrective prompt → fallback to template after 2 fails.
    - LLM returns wrong budget → deterministic redistribute.
    - LLM returns missing Stein-Glenn element → retry with corrective.
    - Length-overflow regen.
13. `tier2-vocab-planner.test.ts`: theme-relevant words picked, age-band gate works, prior-book words deprioritized, spaced-exposure logic.
14. `age-band-calibrator.test.ts`: toddler band rejects 12-word sentences, grade-school accepts; syllable cap; regen-callback.
15. `story-grammar-validator.test.ts`: 7-beat tree with all elements passes; missing internal_response fails with correct gap report; ambiguous edge cases.
16. `story-budget-allocator.test.ts`: 24-spread, 16-spread, 32-spread, 48-spread distributions all sum correctly, no beat zero, percentages held.
17. `dialogic-prompt-generator.test.ts`: per-beat default types, 1-2 prompts per spread, dialogic-disabled path returns empty.
18. ≥50 new tests across these files.

### Phase 10 — Verification
19. `cd src/routes/dashboard && npx vitest run ../../../../../tests/storybook-workshop/author/` → all green.
20. `pnpm check` clean.
21. Lint invariants clean.
22. Manual smoke (pending Wave 2 UI to drive end-to-end): export `storyAuthorService` to `globalThis.__sw_storyAuthor`, in browser console:
    ```js
    const tree = await window.__sw_storyAuthor.author({
      kidName: 'Eli', ageBand: 'preschool', ehriPhase: 'partial-alphabetic',
      theme: 'overcoming-fear', occasion: 'first-day-of-school',
      sidekickSettlerId: window.__agentRegistryService.getAll()[0].id,
      supportingCast: [], localeBiome: 'forest',
      targetSpreads: 24, dedicationText: '', dialogicPromptsEnabled: true, easierReadingMode: false,
    });
    console.log(tree.title, tree.beats.length, tree.tier2_words);
    ```

---

## Done criteria
- ✅ All files created.
- ✅ ≥50 vitest tests green.
- ✅ `pnpm check` clean.
- ✅ Manual browser smoke produces valid SceneTree.
- ✅ Kernel allowlist updated.
- ✅ implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 7 (codex tries to coerce unsafe output)
- `/codex:adversarial-review` after Phase 9 (codex hand-crafts edge-case StoryInputs)
- `/codex:rescue` on > 20min stuck

## Implementation-notes.md must document
- LLM call shape (single-call vs multi-call, json-mode, etc.)
- Tier-2 corpus curation criteria
- Budget weights (12/6/12/22/18/18/12) + reasoning
- Retry budgets per validator
- Template-fallback escape hatch behavior
- Citations baked into system prompt

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-story-author -b feat/storybook-workshop-story-author origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
