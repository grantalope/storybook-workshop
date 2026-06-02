# Goal: Storybook Workshop — Advanced Mode + Inspector Panels

**Wave:** 2 (depends on Wave 1 + UI shell goal #6)
**Branch:** `feat/storybook-workshop-advanced-mode`
**Worktree:** `~/devbox/pachinko-app-sw-advanced-mode/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §7.6
**Executor preference:** claude

---

## Why

Power-user surface. Standard mode is 95% of users. Advanced mode unlocks 3 new stations (Pedagogy Override, Render Direction, Wish Engineering) + 4 always-visible inspectors (Story Grammar, Vocabulary, Diff, Telemetry). Each control in Pedagogy Override shows its peer-reviewed citation underneath — educator-credibility surface. Marketing differentiator vs Wonderbly/Magic Story (closed-box products).

---

## Scope (files to create)

```
src/routes/dashboard/storybook-workshop/advanced/
├── AdvancedModeToggle.svelte                      # standard/advanced switch in workshop header
├── stations/
│   ├── Station1_5PedagogyOverride.svelte          # 10 evidence-knobs as direct controls + citations
│   ├── Station3_5WishEngineering.svelte           # multi-record + audio upload + custom inscription effects
│   └── Station5_5RenderDirection.svelte           # per-beat effect / camera / lighting / palette / sidekick position
├── inspectors/
│   ├── StoryGrammarInspector.svelte               # Stein-Glenn 6-elements pass/fail per beat
│   ├── VocabularyInspector.svelte                 # Tier-2 frequency map per spread + sub-target alerts
│   ├── DiffInspector.svelte                       # per-redo snapshots + side-by-side compare + rollback
│   └── TelemetryInspector.svelte                  # per-book pedagogy metadata view
└── services/
    ├── AdvancedOverrideStore.ts                   # IDB store of per-book locked-in overrides
    ├── DiffSnapshotStore.ts                       # IDB store of redo-snapshots (per-version)
    └── PedagogyTelemetryService.ts                # aggregates per-book pedagogy metadata
tests/storybook-workshop/advanced/
├── advanced-override-store.test.ts
├── diff-snapshot-store.test.ts
├── pedagogy-telemetry.test.ts
└── advanced-mode-orchestration.test.ts            # standard vs advanced flow, 7 vs 10 stations
e2e/storybook-workshop-advanced.spec.ts            # Playwright: advanced mode full path
```

## Out of scope

- ❌ No standard-mode stations — those live in goal #6 (companion goal).
- ❌ No researcher mode (raw LLM prompt exposure) — v2.
- ❌ No designer mode (custom style upload) — v2.
- ❌ No marketing-funnel integration — goal #11.

---

## Build sequence

### Phase 1 — Toggle + state
1. Read spec §7.6 in full.
2. `AdvancedModeToggle.svelte`: header switch, persists in IDB key `workshop.advanced_mode_enabled`.
3. Once enabled, orchestrator (from goal #6) routes through 10-station flow instead of 7 (interleaves S1.5 after S1, S3.5 after S3, S5.5 after S5). Coordinate with goal #6 via published store contract.

### Phase 2 — Station 1.5 Pedagogy Override
4. `Station1_5PedagogyOverride.svelte`:
   - Manual Ehri-phase override (skip self-assessment from S1).
   - Custom sentence-length cap slider (override age default).
   - Manual Tier-2 word list editor (lock specific words for this kid's series).
   - Rhyme density slider 0-100%.
   - Dialogic prompt density: dense / sparse / off, per-beat tunable.
   - Story-grammar enforcement: strict / loose / off.
   - Spacing/leading sliders w/ live typography preview.
   - Font picker (5 curated kid-friendly).
   - Each control shows its citation underneath:
     - *"Rhyme density — Bryant et al. 1990, sensitivity at 3y predicts reading at 6y"*
     - *"Sentence length — Brown 1973 MLU norms; 4yo ~5-8 words, 7yo ~10-14"*
     - *"Spacing — Marinus et al. 2016, spacing is the active ingredient (not OpenDyslexic font)"*
     - *"Dialogic prompts — Whitehurst 1988, medium-large oral-language effect"*
     - *"Vocab — Beck/McKeown/Kucan 2013 Tier-2 framework"*
     - *"Story grammar — Stein & Glenn 1979, structured narratives recalled better"*
     - *"Ehri phase — Ehri 2005, modern consensus reading-acquisition model"*
   - Persist to `AdvancedOverrideStore` per `(kidId, draftId)`.

### Phase 3 — Station 3.5 Wish Engineering
5. `Station3_5WishEngineering.svelte`:
   - Multi-recording slot (parent + grandma + sibling). Each ≤30s. Embedded as audio chapters in ePub.
   - Audio-track upload (parent's music file — public domain only acceptance disclaimer + file-size cap).
   - Custom inscription text with PreText effect picker (the dedication itself can animate).
   - Multi-author byline editor.
   - Carries: `{ multiRecordings, audioTrackBlob, customInscription, inscriptionEffect, multiAuthorByline }`.

### Phase 4 — Station 5.5 Render Direction
6. `Station5_5RenderDirection.svelte`:
   - Per-beat text effect override (12 PreText modes per beat).
   - Per-spread camera framing: establishing / pan / follow / tight-on-hero / reveal / wide-shot.
   - Per-spread lighting direction: warm-front / cool-side / dramatic-back / golden-hour / moonlight / firelit.
   - Pillar pose override per spread: sitting / running / reading / sleeping / dancing / climbing (passed to WB scene as pose-recipe ID).
   - Palette accent per beat: warm-gold / cool-blue / cinematic-teal-orange / muted-pastels / vivid-primary.
   - Sidekick settler positioning per spread: left / right / behind / off-page-narrating.
   - Persist overrides into draft state; pass to story-author + WB scene calls in Station 6 generation.

### Phase 5 — Story Grammar Inspector
7. `StoryGrammarInspector.svelte`: always-visible at S6 in advanced mode.
   - Shows Stein-Glenn 6-elements as table (rows = beats, cols = elements).
   - ✓ / ⚠ / ✗ per cell.
   - Click weak element → suggest strengthening prompt → triggers per-beat redo with corrective LLM call.
   - Consumes `StoryGrammarValidator` output from goal #3.

### Phase 6 — Vocabulary Inspector
8. `VocabularyInspector.svelte`: always-visible at S6 in advanced mode.
   - Lists each Tier-2 word with frequency map per spread.
   - Highlights words appearing < 2 contexts ("*'glimmer' appears once. Want it twice?*" → triggers targeted spread redo).
   - Shows total Tier-2 word count + spec target (3-5).
   - Word definition tooltip per word.

### Phase 7 — Diff Inspector
9. `DiffSnapshotStore.ts`: IDB stores snapshot per redo (SceneTree + WB PNG hashes + composite hashes).
10. `DiffInspector.svelte`: side-by-side compare any two snapshots. Roll back to any prior version.

### Phase 8 — Telemetry Inspector
11. `PedagogyTelemetryService.ts`: aggregates per-book metadata: Tier-2 words, sentence-length distribution, Ehri phase, rhyme density, dialogic count, story-grammar pass count, render timing breakdown.
12. `TelemetryInspector.svelte`: surfaces per-book + per-series view. Local-only counters. **No data leaves device.**

### Phase 9 — Tests
13. `advanced-override-store.test.ts`: CRUD per `(kidId, draftId)`, advanced-mode persistence.
14. `diff-snapshot-store.test.ts`: snapshot CRUD, rollback restores state.
15. `pedagogy-telemetry.test.ts`: aggregator correctness across multiple books, kid-cascade-delete.
16. `advanced-mode-orchestration.test.ts`: 7-station vs 10-station flow, S1.5 inserts after S1, etc.
17. Playwright `e2e/storybook-workshop-advanced.spec.ts`: full advanced-mode path with inspector usage.

### Phase 10 — Verification
18. `pnpm check` clean.
19. Lint clean.
20. Manual smoke: enable advanced mode, walk full 10-station flow, modify each pedagogy knob in S1.5, override 2 effects in S5.5, redo a scene + verify Diff Inspector shows both versions, roll back, complete to checkout.

---

## Done criteria
- ✅ All files created.
- ✅ ≥30 vitest tests + ≥4 Playwright steps green.
- ✅ Each pedagogy control shows its citation.
- ✅ Diff Inspector rollback works.
- ✅ Telemetry data stays on-device.
- ✅ implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 8 (codex hand-crafts override combinations to break generation)
- `/codex:rescue` on > 20min stuck

## Implementation-notes.md must document
- How Pedagogy Override interacts with story-author auto-tunes (override wins)
- Diff snapshot storage size + IDB-pruning strategy
- Citation hover-card UX
- 10-station ordering decision (why interleave 1.5/3.5/5.5)

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-advanced-mode -b feat/storybook-workshop-advanced-mode origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
