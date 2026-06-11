# T1 — WFC Scene Grammar Engine

**Branch:** `feat/wfc-scene-grammar` · **Worktree:** `~/devbox/storybook-workshop-codex-t1`
**Protocol:** read `README-protocol.md` (same directory as this file / `~/codex-tasks/`) for
environment, worktree setup, commit rules, and PR sequence. Repo: `~/devbox/storybook-workshop`
on claude.local — SvelteKit + Svelte 5 + TS strict + Vitest 4, `$lib` = `src/lib`, Node 22
(`source ~/.nvm/nvm.sh && nvm use 22`), pnpm. Baseline ~1097 tests green — keep them green.

## 1. Objective

Build a Wave-Function-Collapse-style, slot-based constraint layout engine that turns
`(bookId, spreadIndex, beatName, sceneBrief, cast, locale, styleId)` into a deterministic
`CollapsedLayout` for a 2-page picture-book spread, then into a `CompositionPlan` that either
references pre-generated bank assets (background plate + character sprites + props) or flags
fallback to direct one-shot image generation. New directory: `src/lib/services/scenegrammar/`.

## 2. Why it matters

Today every spread is a single monolithic image-gen prompt (see
`src/lib/services/imagegen/types.ts` — `ImageGenRequest.prompt` + up to 3 `characterRefs`,
`MAX_CHARACTER_REFS = 3`). That gives no layout control: text gets painted over focal action,
characters face the wrong way across a page turn, and every spread costs a full diffusion run.
A constraint-collapsed layout lets us (a) compose spreads from a pre-generated asset bank
(T5 builds the generation drivers) at near-zero marginal GPU cost, and (b) when we DO direct-gen,
serialize the layout into a far more controllable prompt.

## 3. Repo context — real paths (verify each exists before citing in code)

- `src/lib/services/author/types.ts` — import, do NOT redefine: `BeatName`
  (`'setup'|'catalyst'|'debate'|'midpoint'|'trial'|'climax'|'resolution'`), `LocaleBiome`
  (12 biomes: `forest, seaside, mountain, desert, meadow, snowfield, jungle, urban, farm,
  underwater, space, imaginary`), `Spread` (has `text_focus: 'left'|'right'|'wraps'|'spot'`
  and optional `illustration_brief`), `Scene`, `Beat`, `SceneTree`.
- `src/lib/services/imagegen/types.ts` — `ImageGenRequest`, `ImageGenProvider`. Your
  `PromptSerializer` emits strings destined for `ImageGenRequest.prompt` — do not call
  providers yourself.
- `src/lib/services/fulfillment/StripeCheckoutService.ts` — injectable-boundary exemplar.
- Existing tests live under `tests/` — put yours in `tests/scenegrammar/`.
- There is NO existing `scenegrammar`, `BankManifest`, or layout code — greenfield directory,
  but the types you export here are the canonical home (T5's pre-gen drivers and a future
  compositor will import them).

## 4. Detailed scope — file-by-file

All files under `src/lib/services/scenegrammar/`. Export everything via an `index.ts` barrel.

### 4a. `types.ts`

```ts
export type SlotId = 'heroSlot' | 'sidekickSlot' | 'focalPropSlot' | 'backgroundPlate'
  | 'skyband' | 'textZone';
export type Facing = 'left' | 'right' | 'forward';
export interface Rect { x: number; y: number; w: number; h: number } // fractions 0..1 of full spread (both pages)
export interface SlotSpec {
  id: SlotId;
  required: boolean;
  /** candidate placements the collapser may choose from (superposition domain) */
  candidates: Array<{ rect: Rect; facing?: Facing; scale: number }>;
  zIndex: number;            // backgroundPlate=0, skyband=1, props=2, characters=3, textZone=4
}
export interface ConstraintRule {
  id: string;
  description: string;       // used verbatim in unsatisfiable-error messages
  /** returns violation message or null */
  check(partial: Partial<Record<SlotId, CollapsedSlot>>, ctx: CollapseContext): string | null;
}
export interface GrammarTemplate {
  beatName: BeatName;        // from $lib/services/author/types
  shot: 'wide-establishing' | 'medium' | 'medium-dynamic' | 'tense-medium' | 'tight-dramatic' | 'warm-wide';
  slots: SlotSpec[];
  constraints: ConstraintRule[];   // template-specific, appended to GLOBAL_CONSTRAINTS
}
export interface CollapsedSlot { slotId: SlotId; rect: Rect; facing: Facing; scale: number; assetQuery?: BankAssetQuery }
export interface CollapseContext {
  bookId: string; spreadIndex: number; beatName: BeatName; locale: LocaleBiome;
  styleId: string; castArchetypeIds: string[]; focalPropId?: string;
  pageTurnDirection: 'ltr' | 'rtl';      // default 'ltr'
}
export interface CollapsedLayout {
  seedUsed: number; ctx: CollapseContext; slots: CollapsedSlot[];
  backtracks: number;                      // observability for tests
}
export interface CompositionPlan {
  layout: CollapsedLayout;
  mode: 'bank-composite' | 'direct-gen';
  resolvedAssets: Array<{ slotId: SlotId; assetId: string; file: string }>;
  missingAssets: BankAssetQuery[];         // why we fell back, when mode==='direct-gen'
  fallbackToDirectGen: boolean;            // true iff any REQUIRED slot unresolved
}
// ── Bank manifest (shared contract with the T5 pre-gen drivers — keep field names EXACT) ──
export type PoseClass = 'standing-neutral' | 'walking' | 'running' | 'sitting'
  | 'reaching' | 'pointing' | 'hugging' | 'sleeping';
export interface BankAssetQuery { layer: 'A'|'B'|'C'; styleId: string; locale?: LocaleBiome;
  beatMood?: BeatName; archetypeId?: string; poseClass?: PoseClass; propId?: string }
export interface BankAssetEntry { assetId: string; layer: 'A'|'B'|'C'; styleId: string;
  locale?: LocaleBiome; beatMood?: BeatName; archetypeId?: string; poseClass?: PoseClass;
  propId?: string; file: string; seed: number; qcSimilarity?: number; generatedAtIso: string }
export interface BankManifest { version: 1; bankRoot: string; entries: BankAssetEntry[] }
```

### 4b. `seededRng.ts`

Deterministic PRNG: `hashSeed(...parts: (string|number)[]): number` (FNV-1a or xmur3) +
`mulberry32(seed)` returning `() => number`. ALL collapse randomness flows from
`hashSeed(bookId, spreadIndex)`. No `Math.random`, no `Date.now` (repo convention #3).

### 4c. `GrammarTemplates.ts`

Seven `GrammarTemplate` constants, one per beat, with this beat→shot mapping (a table in code,
exported as `BEAT_SHOT_MAP` so tests assert it):

| beat | shot | layout intent |
|---|---|---|
| setup | wide-establishing | small hero, big plate+skyband, textZone generous |
| catalyst | medium | hero+sidekick mid-frame, focal prop visible |
| debate | medium | two characters facing EACH OTHER |
| midpoint | medium-dynamic | diagonal energy: hero rect offset vertically from sidekick |
| trial | tense-medium | tight candidate rects, prop between characters |
| climax | tight-dramatic | hero scale ≥ 0.45, minimal skyband, textZone small + corner |
| resolution | warm-wide | symmetric wide, characters adjacent, warm = generous margins |

Every template includes all 6 slots; `sidekickSlot`/`focalPropSlot` are `required: false` in
setup/resolution, required elsewhere. Give each slot 3–6 candidates so the collapser has a
real domain. `skyband` is always the top band (y=0, h ≤ 0.25).

### 4d. `LayoutCollapser.ts`

`collapseLayout(ctx: CollapseContext): CollapsedLayout`:

1. Seed = `hashSeed(ctx.bookId, ctx.spreadIndex)` — deterministic per (book, spread).
2. Pick the template by `ctx.beatName`; order slots by `required desc, candidates.length asc`
   (most-constrained-first).
3. For each slot, shuffle candidates with the seeded rng, take the first candidate passing
   ALL constraints against the partial assignment; on dead end, backtrack (bounded:
   `MAX_BACKTRACKS = 64`); count into `layout.backtracks`.
4. Exhausted domain → throw `UnsatisfiableLayoutError` whose message lists the slot, the
   constraint `description`s that rejected each candidate, and the ctx — descriptive, not generic.
5. Attach `assetQuery` per collapsed slot: backgroundPlate → `{layer:'A', styleId, locale,
   beatMood: beatName}`; hero/sidekick → `{layer:'B', styleId, archetypeId, poseClass}` (pose
   chosen by shot: wide→standing-neutral/walking, dynamic→running/reaching, dramatic→
   pointing/reaching, warm→hugging/sitting — encode as an exported `SHOT_POSE_POOL` table);
   focalProp → `{layer:'C', styleId, propId}`. textZone/skyband carry no query.

`GLOBAL_CONSTRAINTS` (exported array, each with stable `id`):

| id | rule |
|---|---|
| `text-no-overlap-focal` | textZone rect must not intersect heroSlot/sidekickSlot/focalPropSlot rects (HARD — this is the headline invariant) |
| `facing-page-turn` | heroSlot facing must equal reading direction (`ltr`→`right`) on beats 1–5; debate overrides to face sidekick |
| `prop-locale-compat` | focalProp must be allowed in locale per `PROP_LOCALE_COMPAT` matrix (define ~10 props × 12 locales; e.g. `lantern` everywhere, `sandcastle` only seaside/desert, `sled` only snowfield/mountain) |
| `slots-in-bounds` | every rect within 0..1 both axes |
| `characters-no-overlap` | hero/sidekick rects intersect < 15% of the smaller rect's area |

### 4e. `BankManifestStore.ts`

`loadBankManifest(json: unknown): BankManifest` — structural validation, throws with the
offending path on malformed input (no `any` escape hatches);
`findAsset(manifest, query: BankAssetQuery): BankAssetEntry | null` (exact-match on every
defined query field); `coverageReport(manifest, queries: BankAssetQuery[]): { covered: number;
missing: BankAssetQuery[]; coverageRatio: number }`.

### 4f. `CompositionPlanner.ts`

`planComposition(layout: CollapsedLayout, manifest: BankManifest | null): CompositionPlan` —
resolve each slot's `assetQuery` via `findAsset`. Null manifest or any REQUIRED-slot miss →
`mode: 'direct-gen'`, `fallbackToDirectGen: true`, with every miss recorded in
`missingAssets`. Optional-slot misses just drop the slot from `resolvedAssets`.

### 4g. `PromptSerializer.ts`

- `serializeDirectGenPrompt(layout, sceneBrief: string): string` — deterministic English
  composition prompt: shot type, per-slot placement ("hero on the right third, facing right,
  large"), locale, then the sceneBrief verbatim, then `"clear empty area at <textZone position>
  for text"`. Same layout+brief → identical string.
- `serializeBankPreGenPrompts(query: BankAssetQuery, dnaPrompt?: string): { positive: string;
  negative: string }` — Layer A: "empty stage" wording, explicit negative-space composition,
  `negative` includes `"people, characters, text, watermark"`; Layer B: dnaPrompt + poseClass
  on a solid flat chroma-key background (`"solid uniform green background"`); Layer C: prop
  on solid key background.

## 5. Test plan — `tests/scenegrammar/` (~25 tests)

- `seeded-rng.test.ts` (3): same parts → same hash; different spreadIndex → different seed;
  mulberry32 sequence golden (first 5 values for seed 1 vs hardcoded expectation).
- `grammar-templates.test.ts` (4): exactly 7 templates keyed by all 7 BeatNames;
  `BEAT_SHOT_MAP` matches the table above; every template has all 6 SlotIds; skyband
  candidates all have y=0 and h ≤ 0.25.
- `layout-collapser.test.ts` (8): determinism — `collapseLayout(ctx)` twice → deep-equal incl.
  `seedUsed` (2 beats); different `spreadIndex` → different layout for ≥1 slot; property test —
  for 50 seeded ctx variants × all 7 beats, assert NO textZone/focal intersection and all rects
  in bounds (loop, not fast-check dep); facing-follows-page-turn on setup ltr and rtl; debate
  facing-each-other; `prop-locale-compat` rejection (sled in desert → either re-collapse to a
  compatible prop candidate or, with a single-candidate ctx, throw); UnsatisfiableLayoutError
  message contains slot id + constraint description (construct an impossible template inline).
- `bank-manifest.test.ts` (5): valid manifest loads; malformed (missing `entries[0].file`)
  throws with path; findAsset exact match + null miss; coverageReport ratio math.
- `composition-planner.test.ts` (3): full manifest → `bank-composite` with all required slots
  resolved; missing hero sprite → `direct-gen` + that query in `missingAssets`; null manifest →
  `direct-gen`.
- `prompt-serializer.test.ts` (2): direct-gen prompt deterministic + contains shot, facing,
  textZone clause, sceneBrief; Layer-A pre-gen prompt contains "empty stage" + negative
  contains "characters".

## 6. Verification commands

```bash
cd ~/devbox/storybook-workshop-codex-t1
pnpm check && pnpm lint
pnpm test                                # full suite: baseline + new, all green
npx vitest run tests/scenegrammar/      # ~25 tests, all green
```

## 7. Done criteria

- [ ] All files in §4 exist under `src/lib/services/scenegrammar/` with `index.ts` barrel.
- [ ] `npx vitest run tests/scenegrammar/` ≥ 25 passing tests, none vacuous.
- [ ] Full `pnpm test` ≥ baseline + 25, zero failures; `pnpm check` + `pnpm lint` clean.
- [ ] Zero `Math.random` / `Date.now` in `src/lib/services/scenegrammar/` (grep proves it).
- [ ] No edits outside `src/lib/services/scenegrammar/` + `tests/scenegrammar/`.
- [ ] Branch pushed; PR opened with `king:review` label, body includes test-count delta.

## 8. Out of scope — do NOT

- Do NOT call any ImageGenProvider, ComfyUI, or network endpoint (pure data + logic only).
- Do NOT implement actual image compositing (canvas/sharp) — `CompositionPlan` is the output.
- Do NOT modify `src/lib/services/author/`, `imagegen/`, or `assemble/`.
- Do NOT add dependencies (no fast-check; hand-rolled property loops).
- Do NOT generate bank assets — T5 owns the drivers; you own the types they'll import.
