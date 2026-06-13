---
type: Service
title: StoryAuthorService
description: Orchestrates story generation — Tier-2 vocab planning, budget allocation, gated LLM loop with salvage, grammar/calibration/quality gates, and deterministic template fallback.
tags: [author, llm, grammar-gate, quality, template-fallback, safety]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/services/author/StoryAuthorService.ts
status: production
---

# Entry Point

```ts
export class StoryAuthorService {
  async author(input: StoryInput, opts: StoryAuthorOptions = {}): Promise<SceneTree>
}
export const storyAuthorService = new StoryAuthorService()
```

Constructor accepts injectable collaborators for tests: `Tier2VocabPlanner`, `StoryBudgetAllocator`, `StoryGrammarValidator`, `AgeBandCalibrator`, `DialogicPromptGenerator`.

---

# Pipeline (in execution order)

## Phase 1 — Vocab + Budget

```ts
const vocab = this.planner.pickWords(input)   // Tier2VocabPlanner: 3-5 age-appropriate words
const budget = this.allocator.allocate(input.targetSpreads)  // StoryBudgetAllocator: beat→spread map
```

Optional: if `STORY_GRAMMAR=1` env var set (or `opts.storyGrammar === true`), runs `collapseSkeleton(input, { seed })` → `renderBeatBriefs(...)` from `$lib/services/storygrammar`. The resulting `skeletonBriefs` are appended to every LLM user message, constraining the model's narrative structure.

## Phase 2 — LLM Gate Loop (`_runLlmGates`)

```ts
const _inf = createInferenceClient('storybook-workshop-author')  // module-scope singleton
```

Up to `maxLlmRetries` (default **2**) attempts. Each attempt:

1. Build `system` message via `buildSystemPrompt` + `appendSkeletonSection` (cached per kid profile; static context for prompt-cache layers).
2. Build `user` message via `buildUserMessage` (dynamic per call).
3. `createInferenceClient('storybook-workshop-author').chat(req)` — see [Inference / LLR](/architecture/inference-llr.md) for routing.
4. Parse JSON response → validate shape.
5. `KidsContentSafetyService.scan()` every spread text, title, blurb. Fail-fast on FAIL.
6. `privacyFilterService.scrub()` every scene brief (purpose `'scene_render'`); hero name replaced with `"the hero"` before scrub; `allowNames` from `castAllowNames(input)` (fictional names only).
7. `StoryGrammarValidator.validate(tree)` — Stein-Glenn 6-element check; retry once with corrective prompt on fail.
8. `AgeBandCalibrator.calibrate(tree, input)` — regen once if spreads overflow age-band caps (`AGE_BAND_CAPS`).

**Salvage mode**: if retries exhaust but a draft exists where all 6 Stein-Glenn elements are present (none at confidence 0), it ships instead of the template. `tree.meta.grammarGate.salvaged = true` records this. Rationale: real LLM prose beats a canned skeleton even when gate brittle.

## Phase 3 — Quality Gate (best-of-2)

```ts
const report = scoreSceneTree(tree, { ageBand, theme })  // StoryQualityScorer (pure rubric, 0-100)
if (report.total < threshold) {
  // ONE regeneration with rubric feedback as corrective addendum
  // keep the higher-scoring draft
}
```

Default `DEFAULT_QUALITY_THRESHOLD` (imported constant). Skip with `opts.skipQualityGate`. Score always recorded in telemetry regardless. `opts.qualityThreshold` overrides the bar.

## Phase 4 — Dialogic Prompts

If `input.dialogicPromptsEnabled`, runs `DialogicPromptGenerator.normalize()` (or generates fresh prompts) on every spread. These are parent–child discussion questions embedded in the spread.

## Phase 5 — Budget Validation

`StoryBudgetAllocator.validate(tree)` — if 2 LLM retries still miss the target spread budget, deterministic redistribution applies (no third LLM call).

## Phase 6 — Template Fallback

If gates-not-passed AND no salvageable draft:

```ts
return this._finalizeFallback(input, vocab.words, budget, meta, 'gates-not-passed')
// OR
return this._finalizeFallback(input, vocab.words, budget, meta, 'force-template')  // opts.forceTemplate
```

`synthesizeTemplateTree(input, vocab, budget)` in `src/lib/services/author/templateFallback.ts` — deterministic craft-rule skeleton; always produces a valid `SceneTree`. `meta.template_fallback = true`.

---

# Key Types (src/lib/services/author/types.ts)

```ts
interface StoryInput {
  kidName: string; ageBand: AgeBand; ehriPhase: EhriPhase;
  theme: StoryTheme; occasion: StoryOccasion;
  sidekickSettlerId: string; sidekickName?: string;
  fictionalCastNames?: string[]; supportingCast?: SupportingCastEntry[];
  localeBiome: LocaleBiome; targetSpreads: number;
  dedicationText: string;
  dialogicPromptsEnabled: boolean; easierReadingMode: boolean;
}

interface SceneTree {
  title: string; back_cover_blurb: string;
  beats: Beat[];  // Beat[].scenes[].spreads[].spread_text
  meta: SceneTreeMeta;
}

interface SceneTreeMeta {
  generated_at_iso: string;
  llm_retries: number; grammar_retries: number;
  calibration_retries: number; budget_redistributed: boolean;
  template_fallback: boolean;
  grammarGate?: GrammarGateTelemetry;  // { salvaged, avgScore, elementScores }
  quality_regenerated?: boolean;
}
```

---

# StoryAuthorOptions

| Option | Default | Purpose |
|---|---|---|
| `maxLlmRetries` | 2 | Hard cap; exceeded → template fallback |
| `forceTemplate` | false | Bypass LLM entirely |
| `chatOverride` | — | Inject deterministic LLM (tests) |
| `safetyOverride` | — | Inject KidsContentSafety (tests) |
| `qualityThreshold` | `DEFAULT_QUALITY_THRESHOLD` | Prose quality bar (0-100) |
| `skipQualityGate` | false | Score recorded but no regen triggered |
| `storyGrammar` | env `STORY_GRAMMAR=1` | Skeleton-collapse narrative structure |
| `skeletonSeed` | — | Deterministic seed for skeleton collapse |
| `sceneTreeCache` | in-memory | Per-instance `SceneTreeCacheStore` (by skeleton hash) |

---

# Safety + Privacy Gates

- **KidsContentSafety**: `globalThis.__kidsContentSafetyService` runtime injection preferred; module singleton fallback; permissive stub if neither available (fails-open until goal #2 ships — deliberate).
- **PrivacyFilter**: every scene brief scrubbed at `'scene_render'` purpose. Hero name replaced with `"the hero"` before scrub; fictional cast names added to `allowNames`. HARD categories block spread publishing; SOFT categories auto-redact.

---

# Related Concepts

- [Inference / LLR](/architecture/inference-llr.md) — `createInferenceClient` routing
- [No-Ollama-in-Browser Decision](/decisions/no-ollama-in-browser.md) — why the LLR shim throws in browser context
