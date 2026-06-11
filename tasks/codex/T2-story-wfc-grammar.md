# T2 — Story-WFC Grammar (Narrative Constraint Collapse)

**Branch:** `feat/story-wfc-grammar` · **Worktree:** `~/devbox/storybook-workshop-codex-t2`
**Protocol:** read `README-protocol.md` (same directory / `~/codex-tasks/`) for environment,
worktree setup, commit rules, PR sequence. Repo `~/devbox/storybook-workshop` on claude.local —
SvelteKit + Svelte 5 + TS strict + Vitest 4, `$lib` = `src/lib`, Node 22
(`source ~/.nvm/nvm.sh && nvm use 22`), pnpm. Baseline ~1097 tests green — keep them green.

## 1. Objective

Add a constraint-collapse layer for NARRATIVE structure: a seeded `SkeletonCollapser` resolves
story slots (conflict class, stakes, setting arc, refrain pattern, beat/scene counts, sidekick
role, emotional arc, ending type) into a `StorySkeleton`; a `BeatBriefRenderer` turns the
skeleton into 7 per-beat structured briefs. Wire two consumption modes into the EXISTING
`StoryAuthorService`: (a) skeleton-enriched monolithic prompt behind a `STORY_GRAMMAR=1` flag,
and (b) a new per-beat authoring path (`authorPerBeat`) that makes 7 small LLM calls — sized
to fit Apple's 4K-token on-device context — with per-beat retry and a `(skeletonHash →
SceneTree)` cache behind an injectable store. New directory: `src/lib/services/storygrammar/`.

## 2. Why it matters

`docs/specs/2026-06-10-iphone-on-device-companion.md` (read §1–§3, §6 M1): iOS 27 Foundation
Models give free on-device SceneTree generation but with a **4K-token context** (8K newest),
while today's monolithic system prompt is ~3K tokens — the whole-tree single call doesn't fit.
Per-beat sessions are the spec's M1 answer. Separately, the LLM today invents structure
freely; a collapsed skeleton pins the craft decisions (stakes appropriate to age, refrain that
mutates at the climax, hero — never sidekick — resolving the problem) so the LLM only writes
prose inside guardrails, which raises floor quality and makes retries cheap and local.

## 3. Repo context — real paths (read these BEFORE writing code)

- `src/lib/services/author/StoryAuthorService.ts` (682 lines) — the orchestrator.
  `author(input: StoryInput, opts: StoryAuthorOptions): Promise<SceneTree>` at ~line 133.
  `StoryAuthorOptions` already has `chatOverride?: (req: ChatRequest) => Promise<ChatResponse>`
  (your test seam), `forceTemplate`, `safetyOverride`, `maxLlmRetries`. Pipeline doc-comment at
  top lists the 11 gate steps — your per-beat path must reuse the same gates where stated below.
- `src/lib/services/author/prompts/system-prompt-template.ts` (`buildSystemPrompt`) and
  `prompts/user-message-template.ts` (`buildUserMessage`) — mode (a) injects an extra section
  into the USER message; do not rewrite these files, add an exported append-helper.
- `src/lib/services/author/types.ts` — import, never redefine: `StoryInput` (fields:
  `kidName, ageBand, ehriPhase, theme, occasion, sidekickSettlerId, supportingCast,
  localeBiome, targetSpreads (16|24|32|48), dedicationText, dialogicPromptsEnabled,
  easierReadingMode, priorBooksWords?`), `AgeBand ('toddler'|'preschool'|'grade-school')`,
  `StoryTheme` (12), `LocaleBiome` (12), `BeatId 1..7`, `BeatName`, `Beat`, `Scene`
  (`spreadCount: 1|2|3|4|5`), `Spread`, `SceneTree`, `SceneTreeMeta`.
- `src/lib/services/author/StoryBudgetAllocator.ts` — `storyBudgetAllocator` computes the
  per-beat spread budget (`BeatBudgetMap`). REUSE it for beat budgets; your collapser only
  splits each beat's budget into 1..3 scenes.
- `src/lib/services/author/Tier2VocabPlanner.ts` — `tier2VocabPlanner` picks 3–5 words; your
  brief renderer ASSIGNS those words to beats, it does not pick words.
- `src/lib/services/author/StoryGrammarValidator.ts`, `StoryQualityScorer.ts` — existing gates.
- Privacy rule (mirrors `Spread.illustration_brief` doc in types.ts): beat briefs may leave
  the device — they must say "the hero", NEVER `input.kidName`.

## 4. Detailed scope — file-by-file

New files under `src/lib/services/storygrammar/` + minimal wiring edits in
`StoryAuthorService.ts`. Barrel `index.ts`.

### 4a. `types.ts`

```ts
export type ConflictClass = 'lost-thing'|'new-experience'|'friendship-rift'|'fear-to-face'|'big-task';
export type StakesLevel = 'comfort-object'|'routine-change'|'social-bond'|'self-mastery'|'community';
export type SidekickRole = 'helper'|'comic'|'conscience';            // 'rescuer' must not exist anywhere
export type EndingType = 'circular-callback'|'quiet-warmth'|'lesson-named'|'joke-button'|'gift-forward';
export interface RefrainPattern { line: string; minWords: number; maxWords: number;
  placementBeats: BeatId[]; climaxMutation: { beat: BeatId; swapWordIndex: number } }
export interface SettingArc { start: LocaleBiome; excursion: LocaleBiome; return: LocaleBiome } // return===start for circular themes
export interface StorySkeleton {
  seedUsed: number; theme: StoryTheme; conflictClass: ConflictClass; stakes: StakesLevel;
  settingArc: SettingArc; refrain: RefrainPattern; sidekickRole: SidekickRole;
  endingType: EndingType;
  beatSceneCounts: Record<BeatId, number>;            // each 1..3
  beatSpreadBudgets: Record<BeatId, number>;          // sums to targetSpreads
  emotionalArc: Record<BeatId, number>;               // valence -1..1
}
export interface BeatBrief { beatId: BeatId; beatName: BeatName; valence: number;
  sceneCount: number; spreadBudget: number; conflictFocus: string; refrainLine?: string;
  refrainIsMutated?: boolean; tier2Words: string[]; sidekickNote: string; settingNote: string;
  brief: string }
export interface SceneTreeCacheStore { get(hash: string): Promise<SceneTree | null>;
  put(hash: string, tree: SceneTree): Promise<void> }
```

### 4b. `constraintTables.ts` — exported constants (tests assert them)

| table | content |
|---|---|
| `CONFLICT_THEME_COMPAT: Record<ConflictClass, StoryTheme[]>` | lost-thing→[lost-and-found,bedtime,silly-quest]; new-experience→[first-day,new-baby-arrives,saying-goodbye,curiosity]; friendship-rift→[friendship,sibling-rivalry,kindness]; fear-to-face→[overcoming-fear,first-day,bedtime]; big-task→[adventure,silly-quest,curiosity,kindness]. Every one of the 12 StoryThemes must appear in ≥1 list. |
| `MAX_STAKES_BY_AGE: Record<AgeBand, StakesLevel>` | toddler→routine-change; preschool→social-bond; grade-school→community. Ladder order = the StakesLevel union order. |
| `REFRAIN_WORD_RANGE_BY_AGE` | toddler 4–6 words; preschool 6–9; grade-school 8–12 |
| `EMOTIONAL_ARC_RULES` | beat1 ≥ 0; min(beats 4–6) ≤ beat1 − 0.3 (the pre-climax dip); beat7 ≥ +0.5; valence non-decreasing from the dip beat through beat 7 |

### 4c. `seededRng.ts` — same pattern as repo convention #3: `hashSeed(...parts)` (FNV-1a) +
`mulberry32`. No Math.random / Date.now anywhere in this directory.

### 4d. `SkeletonCollapser.ts`

`collapseSkeleton(input: StoryInput, opts?: { seed?: number }): StorySkeleton`.
Seed default: `hashSeed(input.theme, input.ageBand, input.targetSpreads,
input.sidekickSettlerId, input.localeBiome)` — NEVER from `kidName` (PII) or wall-clock.
Collapse order (most-constrained first): conflictClass (filtered by `CONFLICT_THEME_COMPAT`
for `input.theme` — if no class lists the theme, that's a table bug; throw descriptively),
stakes (≤ `MAX_STAKES_BY_AGE[input.ageBand]`), settingArc (start = `input.localeBiome`,
excursion = seeded pick ≠ start, return = start for theme ∈ {bedtime, lost-and-found,
saying-goodbye} else seeded), sidekickRole, endingType, refrain (template line built from
theme + within age word range; `placementBeats` always includes 1 and 7 plus one mid beat;
`climaxMutation.beat` = 6), emotionalArc (seeded jitter ±0.1 around a base curve satisfying
`EMOTIONAL_ARC_RULES` — clamp so rules hold by construction), beatSceneCounts +
beatSpreadBudgets (call `storyBudgetAllocator` for the beat budget; split each beat's budget
into 1..3 scenes; scene count must allow `Scene.spreadCount` 1..5 per scene; sum invariant ==
`input.targetSpreads`).

### 4e. `SkeletonHash.ts`

`skeletonHash(skeleton: StorySkeleton): string` — canonical JSON (sorted keys, recursively)
→ FNV-1a 64-bit hex string. Insensitive to object key insertion order; sensitive to every
field value. Pure.

### 4f. `BeatBriefRenderer.ts`

`renderBeatBriefs(skeleton: StorySkeleton, input: StoryInput, tier2Words: string[]):
BeatBrief[]` (length 7). Rules: tier2Words distributed round-robin across beats 2–6, every
word assigned ≥1 beat; refrainLine present on `placementBeats` and the climax-beat copy has
the mutated word + `refrainIsMutated: true`; climax (beat 6) brief MUST contain the literal
sentence `"The hero, not the sidekick, resolves the problem."` (hero-agency guard — sidekick
is helper/comic/conscience, NEVER rescuer); `brief` strings refer to "the hero" — assert no
`kidName` leakage; settingNote follows the SettingArc (beats 1–2 start, 3–5 excursion, 6–7
return leg). Output is deterministic (no rng here at all).

### 4g. Wiring — `StoryAuthorService.ts` (surgical, flag-gated)

- Add to `StoryAuthorOptions`: `storyGrammar?: boolean; skeletonSeed?: number;
  sceneTreeCache?: SceneTreeCacheStore`.
- Flag helper `isStoryGrammarEnabled(opts)`: `opts.storyGrammar` if defined, else
  `process.env.STORY_GRAMMAR === '1'` guarded for non-Node (`globalThis.process?.env`).
- **Mode (a)** inside `author()`: when enabled, collapse skeleton + render briefs and append a
  `## Story skeleton (follow exactly)` section to the user message via a new exported helper
  `appendSkeletonSection(userMsg: string, briefs: BeatBrief[]): string` (new file
  `src/lib/services/author/prompts/skeleton-section.ts`). **Flag OFF → byte-identical user
  message to today** (tests prove it). Nothing else in the pipeline changes.
- **Mode (b)** new method `authorPerBeat(input: StoryInput, opts?: StoryAuthorOptions):
  Promise<SceneTree>`: collapse skeleton → `skeletonHash` → cache `get` (hit returns cached
  tree, zero LLM calls) → else 7 sequential LLM calls (use `opts.chatOverride` when provided,
  else the existing inference client), each with a COMPRESSED system prompt (persona + output
  JSON schema for ONE `Beat` only) + that beat's `BeatBrief` as user message; per-beat parse
  failure → 1 retry with a corrective suffix, then throw. Assemble `SceneTree` (title/blurb
  from a final cheap call OR derived from theme + refrain — derive deterministically, do not
  add an 8th call), then run the EXISTING gates: safety scan (`opts.safetyOverride` honored),
  `storyGrammarValidator.validate`, budget sum check; set `meta.generated_at_iso` and a new
  optional `meta.per_beat: true` (additive optional field on `SceneTreeMeta`). Cache `put` on
  success. **Context budget**: per-beat system+user combined < 8000 chars (~2K tokens) —
  enforce with a thrown error and cover with a test.

## 5. Test plan — `tests/storygrammar/` (~22 tests)

- `skeleton-collapser.test.ts` (8): determinism (same input+seed → deep-equal twice);
  different seed → different skeleton; conflictClass ∈ compat list for all 12 themes (loop);
  stakes never exceed age cap for all 3 bands (loop); beatSpreadBudgets sum === targetSpreads
  for 16/24/32/48; every beatSceneCounts value in 1..3; emotionalArc satisfies all 4
  `EMOTIONAL_ARC_RULES` over 50 seeded variants (property loop); settingArc.return === start
  for bedtime.
- `skeleton-hash.test.ts` (3): key-order insensitivity (manually shuffled object); any field
  change → different hash; stable golden for a fixed skeleton.
- `beat-brief-renderer.test.ts` (6): 7 briefs in beat order; tier2 words all assigned;
  refrain on placement beats + mutated exactly at beat 6; hero-agency sentence in beat-6
  brief; no kidName in any brief (use kidName "Zephyrina" — must not appear); deterministic
  (two runs deep-equal).
- `author-wiring.test.ts` (5): flag OFF → user message captured via `chatOverride` is
  byte-identical to a run without any T2 code touched (capture both, strictEqual); flag ON →
  user message contains `## Story skeleton`; `authorPerBeat` happy path — `chatOverride`
  called exactly 7 times, valid SceneTree (beats 1..7, budget sum ok); per-beat retry — beat 3
  malformed once → 8 total calls, tree still valid; cache hit — second `authorPerBeat` with
  same input+seed and a shared in-memory `SceneTreeCacheStore` → 0 LLM calls, same tree.
  (Per-beat char-budget violation test may live here or in renderer file — either way it exists.)

`tests/author/` (existing suite) MUST pass untouched — the flag-off byte-identical test is
your insurance.

## 6. Verification commands

```bash
cd ~/devbox/storybook-workshop-codex-t2
pnpm check && pnpm lint
npx vitest run tests/storygrammar/ tests/author/   # new ~22 + existing author suite green
pnpm test                                           # full suite green
```

## 7. Done criteria

- [ ] `src/lib/services/storygrammar/` complete per §4 with barrel; wiring edits confined to
      `StoryAuthorService.ts`, `author/types.ts` (additive `SceneTreeMeta.per_beat?`), and new
      `author/prompts/skeleton-section.ts`.
- [ ] ≥ 22 new tests green; full suite ≥ baseline + 22; check + lint clean.
- [ ] Flag OFF behavior byte-identical (test exists and passes).
- [ ] Zero `Math.random`/`Date.now` in `src/lib/services/storygrammar/` (`meta.generated_at_iso`
      set in StoryAuthorService, which already owns wall-clock).
- [ ] No kidName in any skeleton/brief/cached artifact.
- [ ] Branch pushed; PR opened with `king:review` label, body includes test-count delta.

## 8. Out of scope — do NOT

- Do NOT change default `author()` behavior with the flag off — not one byte of the prompt.
- Do NOT modify `templateFallback.ts`, `StoryQualityScorer.ts`, `AgeBandCalibrator.ts`.
- Do NOT implement IDB/persistent cache backends — in-memory default + injectable interface only.
- Do NOT add Swift/iOS code; the 4K-context fit is expressed only as the per-beat char budget.
- Do NOT import anything from `scenegrammar/` (T1) — separate subsystems, no coupling.
