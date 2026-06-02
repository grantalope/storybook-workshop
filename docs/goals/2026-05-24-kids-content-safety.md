# Goal: Storybook Workshop — KidsContentSafetyService + Kernel Manifest

**Wave:** 1 (parallel)
**Branch:** `feat/storybook-workshop-kids-content-safety`
**Worktree:** `~/devbox/pachinko-app-sw-kids-content-safety/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §4.1, §4.2, §7.2
**Executor preference:** claude

---

## Why

Every LLM call from the workshop (story-author, vocab planner, dialogic prompts, dedications, cover-badge text) MUST pass through a content-safety gate. The gate enforces 7 categories: violence, fear-permanent, sexual-adult, substance, religious-political, scary-unresolved, bigotry. Without this, we ship a privacy-pure product that fails kids-safety the first time an LLM hallucinates a scary scene.

---

## Scope (files to create)

```
src/routes/dashboard/services/kids-content-safety/
├── KidsContentSafetyService.ts        # public API: scan(text, opts), warmup, isReady, activeBackend
├── backends/
│   ├── KidsContentSafetyBackendStub.ts       # regex+keyword baseline, always available
│   ├── KidsContentSafetyBackendWASM.ts       # DistilBERT ONNX classifier, fine-tuned (loaded from CDN)
│   ├── KidsContentSafetyBackendWebGPU.ts     # WebGPU variant
│   └── KidsContentSafetyBackendOllama.ts     # local Ollama variant (dev-only fallback)
├── KidsContentSafetyAudit.ts          # ring buffer 1000 entries, local-only
├── types.ts                           # ScanReport, SafetyCategory, ScanResult shapes
└── index.ts                           # barrel + singleton export
src/kernel/kids-content-safety/
├── contracts.ts                       # KidsContentSafetyPort, KIDS_CONTENT_SAFETY_CONTRACTS, requirableBy allowlist
└── manifests.ts                       # kidsContentSafetyManifest (colocated, background, volatile)
src/routes/dashboard/debug/kids-content-safety/+page.svelte   # local audit viewer (dev-only)
tests/storybook-workshop/
├── kids-content-safety-stub.test.ts            # regex baseline catches obvious cases
├── kids-content-safety-categories.test.ts      # 7 categories x ~5 cases each
├── kids-content-safety-audit.test.ts           # ring buffer correctness
└── kids-content-safety-kernel-wiring.test.ts   # cap published, callers allowlisted, port works
```

## Out of scope

- ❌ No story-author / prompt integration — wired in goal #3 `story-author`.
- ❌ No AppOrchestrator registration — Wave 2's `ui-shell` registers (this goal exports the manifest).
- ❌ No DistilBERT model training — ship the ONNX bundle as a fixed asset URL; training is offline / not in this goal.

---

## Build sequence

### Phase 1 — Types + categories
1. Read spec §4.1, §7.2 in full.
2. Create `types.ts`:
   - `SafetyCategory = 'violence' | 'fear_permanent' | 'sexual_adult' | 'substance' | 'religious_political' | 'scary_unresolved' | 'bigotry'`
   - `ScanReport = { category: SafetyCategory, confidence: number, span?: [start, end] }`
   - `ScanResult = { passed: boolean, reports: ScanReport[], scanLatencyMs: number, backend: BackendName }`
   - `BackendName = 'webgpu' | 'wasm' | 'ollama' | 'stub'`
   - `ScanOpts = { ageBand?: AgeBand, source: 'story_author' | 'dedication' | 'voice_transcript' | 'scene_brief' | 'cover_badge', strict?: boolean }`

### Phase 2 — Backends
3. `KidsContentSafetyBackendStub.ts` — regex + keyword baseline. Ship a curated word list per category (~300 keywords). Returns `ScanReport[]` with `confidence: 1.0` on keyword match, `0.0` otherwise. Always available, no warmup.
4. `KidsContentSafetyBackendWASM.ts` — load DistilBERT ONNX classifier via `onnxruntime-web` WASM backend. Model URL: TODO (placeholder, document in implementation-notes that this asset must be deployed pre-launch). ~30 MB bundle. Sigmoid output per category → threshold (configurable, default 0.5) → report.
5. `KidsContentSafetyBackendWebGPU.ts` — same model via `onnxruntime-web` WebGPU backend. Fall through to WASM on init failure.
6. `KidsContentSafetyBackendOllama.ts` — POST to `http://localhost:11434/api/generate` with model `kid-safety` (registers as needed model in spec; document Ollama setup). For dev/vitest only.
7. Backend interface: `warmup(): Promise<void>`, `scan(text: string, opts: ScanOpts): Promise<ScanReport[]>`, `isReady(): boolean`.

### Phase 3 — Service facade + probe order
8. `KidsContentSafetyService.ts` — singleton, lazy probe order: webgpu → wasm → ollama → stub.
9. Public API: `scan(text, opts): Promise<ScanResult>`, `warmup(): Promise<void>`, `isReady(): boolean`, `activeBackend(): BackendName`, `_setProbeOrderForTests(order)` (test-only).
10. Default policy: `passed = reports.every(r => r.confidence < threshold)`. `strict: true` lowers threshold to 0.3.
11. Latency measurement: `performance.now()` around the active backend's `scan` call.

### Phase 4 — Audit
12. `KidsContentSafetyAudit.ts` — fixed-capacity ring buffer (1000 entries), local-only. `record({ source, result, textHash, ts })` (hash, not raw text). `recent(n)` for the debug page. No network egress.

### Phase 5 — Kernel manifest + contract
13. `src/kernel/kids-content-safety/contracts.ts`:
    - `KidsContentSafetyPort` with method `scan(text: string, opts: ScanOpts): Promise<ScanResult>`.
    - `KIDS_CONTENT_SAFETY_CONTRACTS = [{ name: 'kids-content.scan', port: ..., requirableBy: ['storybook-workshop-*', 'caller-*'] }]`.
14. `src/kernel/kids-content-safety/manifests.ts`:
    - `kidsContentSafetyManifest` — placement: `colocated`, priority: `background`, state: `volatile`, module factory returns `() => kidsContentSafetyService` (singleton import).

### Phase 6 — Debug page
15. `src/routes/dashboard/debug/kids-content-safety/+page.svelte`:
    - Live view of audit ring buffer.
    - Per-category counts.
    - Test input box: type text, see scan result inline.
    - Active backend + warmup state indicator.

### Phase 7 — Tests
16. `kids-content-safety-stub.test.ts`: 20+ cases (obvious violent text caught, neutral kid-content passes, ambiguity flagged at low confidence).
17. `kids-content-safety-categories.test.ts`: 7 categories × ≥5 cases = 35+ cases. Use real picture-book example sentences (positive + negative).
18. `kids-content-safety-audit.test.ts`: ring buffer fills, evicts FIFO, hash-only no raw text.
19. `kids-content-safety-kernel-wiring.test.ts`: contract published, caller `storybook-workshop-author` allowlisted, port `scan` works end-to-end via kernel.connect.

### Phase 8 — Verification
20. From worktree: `cd src/routes/dashboard && npx vitest run ../../../../../tests/storybook-workshop/kids-content-safety-*.test.ts` → all green.
21. `pnpm check` clean.
22. Lint invariants clean.
23. Manual smoke: open dev server → `/dashboard/debug/kids-content-safety` → paste 10 kid-book-appropriate sentences (all should pass) + 5 borderline (mix of pass/fail per category) + 3 obvious fails (all flagged).

---

## Done criteria
- ✅ All files created.
- ✅ ≥65 new tests green across 4 vitest files.
- ✅ Kernel contract published + caller allowlist correct.
- ✅ Debug page renders + audit ring buffer populates.
- ✅ Stub backend ships day 1 (no external asset needed); WASM backend documented as TODO-asset.
- ✅ implementation-notes.md per CLAUDE.md Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review --base main` after every commit
- `/codex:adversarial-review` after Phase 3 (codex tries jailbreak prompts to find category gaps)
- `/codex:rescue` on > 20min stuck

## Implementation-notes.md must document
- Why DistilBERT over BERT/RoBERTa (size + WASM perf)
- Threshold values per category + reasoning
- Stub keyword list source / curation method
- ONNX bundle deployment plan (where to host the model file)
- Why ring buffer 1000 entries (not more / less)

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-kids-content-safety -b feat/storybook-workshop-kids-content-safety origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
