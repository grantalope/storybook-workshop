# Goal: Storybook Workshop — PreText BookSpreadSurfaceAdapter + Emotional Effects

**Wave:** 1 (parallel)
**Branch:** `feat/storybook-workshop-pretext-book-adapter`
**Worktree:** `~/devbox/pachinko-app-sw-pretext-book-adapter/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §3.8, §7.5
**Existing reference:** `services/lilaiputia/PretextCompositor.ts`, `PretextFlowEngine.ts`, `PretextEffectEngine.ts`, `components/PretextTextCanvas.svelte`
**Existing surface adapters:** FeedSurfaceAdapter, CommuneSurfaceAdapter, QuestSurfaceAdapter, ProfileSurfaceAdapter — match this pattern.
**Executor preference:** codex (animation/typography-heavy)

---

## Why

Every book spread's text is composited through PretextCompositor — not flat PDF text. Per-beat default emotional-typography effect (12 modes); text wraps around the WB-rendered scene's focal point; hand-set typography per Ehri reading phase; Tier-2 words subtly emphasized; dialogic prompts in margin. Digital read-along = live animated per-char physics. Print PDF = static frame captured at the visually-strongest animation moment. This is the surface the marketing line "every page reads like a Pixar short" points at.

---

## Scope (files to create)

```
src/routes/dashboard/services/storybook-workshop/render/
├── BookSpreadSurfaceAdapter.ts        # main: SceneTree spread → PretextCompositor frame
├── EmotionalEffectMap.ts              # beat → default PreText effect mode mapping
├── EhriPhaseTypography.ts             # per-phase font, size, leading, kerning settings
├── Tier2EmphasisHighlighter.ts        # subtle color/weight for target words
├── DialogicPromptRenderer.ts          # margin Speech element layout
├── StaticFrameExporter.ts             # capture strongest animation moment as static PNG for print PDF
├── types.ts                           # BookSpreadComposite, BookSpreadRenderOpts shapes
└── index.ts
src/routes/dashboard/components/storybook-workshop/
└── BookSpreadCanvas.svelte            # live-animated digital read-along spread component
tests/storybook-workshop/render/
├── book-spread-surface-adapter.test.ts
├── emotional-effect-map.test.ts
├── ehri-phase-typography.test.ts
├── tier2-emphasis-highlighter.test.ts
└── static-frame-exporter.test.ts
e2e/storybook-workshop-pretext.spec.ts # Playwright: animated read-along renders + frame export works
```

## Out of scope

- ❌ No new PreText effects — use the existing 12 (wave, gravity, bounce, rise, scatter, orbit, magnetic, glitch, vortex, parting-water, dragon, flow). Extending PretextEffectEngine is OUT of scope.
- ❌ No new font assets — use ~5 curated kid-friendly system fonts (document list).
- ❌ No PDF assembly — that's goal #5.
- ❌ No story author — that's goal #3.

---

## Build sequence

### Phase 1 — Types
1. Read spec §3.8, §7.5 + `services/lilaiputia/PretextCompositor.ts` + existing surface adapter patterns in full.
2. Create `types.ts`:
   - `EmotionalEffect = 'flow' | 'bounce' | 'wave' | 'magnetic' | 'glitch' | 'dragon' | 'vortex' | 'rise' | 'scatter' | 'orbit' | 'gravity' | 'parting-water'`
   - `BookSpreadComposite = { spreadIndex, effects: EmotionalEffect, elements: PretextElement[], focalPointFromScene: { x: number, y: number, radius: number }, fonts: EhriPhaseTypography, exportedStaticFrame?: { png: Blob, capturedAtMs: number } }`
   - `BookSpreadRenderOpts = { scenePngWidth, scenePngHeight, dpi: 300|72, easierReadingMode: boolean, dialogicPromptsEnabled: boolean }`

### Phase 2 — EmotionalEffectMap
3. `EmotionalEffectMap.ts`:
   - Default per beat (per spec §7.5): setup=flow, catalyst=bounce, debate=wave, midpoint=magnetic, trial=glitch, climax=dragon (alt: vortex), resolution=rise.
   - `getDefaultEffect(beatId: BeatId): EmotionalEffect` — returns default.
   - `overrideEffect(map: Partial<Record<BeatId, EmotionalEffect>>): EmotionalEffect[]` — applied by advanced-mode (goal #7) override.

### Phase 3 — EhriPhaseTypography
4. `EhriPhaseTypography.ts`:
   - Per phase: font (default + alt), size, leading, kerning, tracking, max-line-length.
   - `pre-alphabetic`: huge chunky 28pt, generous tracking, sans-serif (curated list — Atkinson Hyperlegible, Lexend), 1 short line per "thought".
   - `partial-alphabetic`: 22pt, slightly tighter.
   - `full-alphabetic`: 18pt, traditional kid-book leading.
   - `consolidated-alphabetic`: 14-16pt, paragraph blocks, classic kid-book.
   - `easierReadingMode`: bump leading +20%, line-length -15%, sans-serif default — per Marinus 2016 evidence-based.

### Phase 4 — Tier-2 emphasis
5. `Tier2EmphasisHighlighter.ts`:
   - `highlight(spreadText: string, tier2Words: string[]): TextRun[]` — splits text into runs, marks Tier-2 word runs with `emphasis: 'tier2'` flag.
   - Visual treatment: subtle color shift OR italic OR weight bump (configurable; default = +1 font weight).
   - Don't over-highlight; if too many Tier-2 words in one spread, cap emphasis at 2 per spread to avoid clutter.

### Phase 5 — Dialogic prompt renderer
6. `DialogicPromptRenderer.ts`:
   - `render(prompts: DialogicPrompt[], spreadIndex: number): PretextElement[]` — each prompt rendered as PreText `Speech` element in margin.
   - Layout: bottom-right margin for spreads 1-2, top-left for 3-4, alternating (avoids feeling formulaic).
   - Digital: scatter-in animation on page-enter.
   - Print: italic side-note below spread.

### Phase 6 — BookSpreadSurfaceAdapter
7. `BookSpreadSurfaceAdapter.ts`:
   - Extends existing surface adapter pattern.
   - `composite(spread: Spread, beat: Beat, sceneFocal: FocalPoint, opts: BookSpreadRenderOpts): BookSpreadComposite`.
   - Pipeline:
     a. Apply EmotionalEffectMap → resolve effect for spread's beat.
     b. Apply EhriPhaseTypography → resolve font config.
     c. Apply Tier2EmphasisHighlighter → run-aware text.
     d. Apply text-flow around `sceneFocal` via PretextFlowEngine (existing infra).
     e. Apply DialogicPromptRenderer for margin notes.
     f. Build PretextCompositor element tree (GridBlock/Prose/Label/Speech).
   - Output is consumed by `BookSpreadCanvas.svelte` (digital) + `StaticFrameExporter` (print).

### Phase 7 — StaticFrameExporter
8. `StaticFrameExporter.ts`:
   - `capturePeakFrame(composite: BookSpreadComposite, animationDurationMs: number): Promise<Blob>` — runs the animation to its visually-strongest moment (per-effect: typically 60-75% through cycle for `bounce`/`rise`, immediately post-impact for `dragon`).
   - Per-effect peak-time mapping: `flow=50%, bounce=70%, wave=33%, magnetic=80%, glitch=65%, dragon=75%, vortex=50%, rise=65%, ...`.
   - Renders off-screen canvas at 300dpi, returns PNG blob.
   - Used by BookAssembler (goal #5) for print PDF spread overlays.

### Phase 8 — Svelte component
9. `BookSpreadCanvas.svelte`:
   - Mount BookSpreadComposite via existing PretextTextCanvas infra.
   - Live animation loop, respects `prefers-reduced-motion`.
   - Page-turn animation on next-spread navigation.
   - Voice-over playback hook (parent recording from Wish Moment) — autoplay opt-in.

### Phase 9 — Tests
10. `book-spread-surface-adapter.test.ts`: composite produces valid element tree; effect map applied; focal point respected (text doesn't overlap focal-point bbox); 12+ cases.
11. `emotional-effect-map.test.ts`: 7 beats × default effect mapping; overrides applied correctly; 10+ cases.
12. `ehri-phase-typography.test.ts`: per-phase config returned correctly; easierReadingMode boosts leading + sets sans; 8+ cases.
13. `tier2-emphasis-highlighter.test.ts`: word boundaries respected, emphasis cap, multiple words in one spread, 10+ cases.
14. `static-frame-exporter.test.ts`: per-effect peak time, canvas size = scenePngWidth × scenePngHeight × dpi, PNG blob returned, 7 effects × 1 case minimum = 7+.
15. Playwright `e2e/storybook-workshop-pretext.spec.ts`:
    - Mount BookSpreadCanvas with a test composite.
    - Verify animation runs (`prefers-reduced-motion: no-preference`).
    - Verify focal-point bbox is not text-overlapped.
    - Verify StaticFrameExporter produces a non-empty PNG.

### Phase 10 — Verification
16. `npx vitest run tests/storybook-workshop/render/` → green.
17. `pnpm check` clean.
18. `pnpm playwright test e2e/storybook-workshop-pretext.spec.ts` → green.
19. Manual smoke: dev server, navigate to `/dashboard/debug/storybook-workshop-pretext-preview` (new dev page, optional) → mounts BookSpreadCanvas with sample composites for each beat → visually inspect 7 effect modes render correctly.

---

## Done criteria
- ✅ All files created.
- ✅ ≥45 vitest tests + 3+ Playwright specs green.
- ✅ Visually inspected animations render.
- ✅ Static frame export produces print-quality PNG.
- ✅ implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 6 — codex tries to break flow with degenerate focal points
- `/codex:rescue` on > 20min stuck (especially around StaticFrameExporter timing)

## Implementation-notes.md must document
- Per-effect peak-frame timings
- Font choices + rationale (Atkinson Hyperlegible vs Lexend vs system default)
- Tier-2 emphasis visual treatment chosen + reasoning
- Dialogic prompt margin layout rule
- Print-DPI vs screen-DPI rendering path divergence

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-pretext-book-adapter -b feat/storybook-workshop-pretext-book-adapter origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
