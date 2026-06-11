# T3 — Read-Aloud + Phonics + Educational Overlays

**Branch:** `feat/readaloud-phonics` · **Worktree:** `~/devbox/storybook-workshop-codex-t3`
**Protocol:** read `README-protocol.md` (same directory / `~/codex-tasks/`) for environment,
worktree setup, commit rules, PR sequence. Repo `~/devbox/storybook-workshop` on claude.local —
SvelteKit + Svelte 5 runes + TS strict + Vitest 4, `$lib` = `src/lib`, Node 22, pnpm.
Baseline ~1097 tests green — keep them green. **HARD RULE: NO microphone APIs anywhere**
(no `getUserMedia`, `MediaRecorder`, `SpeechRecognition`, `webkitSpeechRecognition`) — this is
a kids' product; we do not capture child audio. A grep-guard test enforces it (§5).

## 1. Objective

Turn the public read-along page into a 4-mode learn-to-read surface: **Listen** (TTS narration
with karaoke word highlight), **Read-along** (parent/kid paced, tap-to-hear words), **Phonics**
(tap a word → grapheme-colored sound-out), **Quiz** (3 template questions at the end). Backed by
a new `src/lib/services/readaloud/` service family: a `TtsProvider` boundary with a browser
implementation and a narrator-server client stub, a per-book `PhonicsMapper`, a
`Tier2Annotator`, a deterministic `QuizGenerator`, and a `ReadAloudBundleExtender` that carries
all of it through the existing bundle pipeline.

## 2. Why it matters

The book pipeline already plans Tier-2 vocabulary (`Tier2VocabPlanner`) and dialogic prompts
(`DialogicPromptGenerator`) — pedagogy is the product's spine — but the read-along page renders
none of it: it's a flat slideshow. This task closes the loop from "story engineered for
learning" to "screen that actually teaches", without any LLM at runtime and without any audio
capture.

## 3. Repo context — real paths (read BEFORE coding)

- `src/lib/services/assemble/types.ts` — `ReadAlongBundle` (`{ shortcode, manifest: { title,
  spreadCount, hasVoiceOver, hasDedicationAudio }, spreads: Array<{ index, framePng: Blob,
  animation: AnimationManifest, text: string }>, voiceOver?, dedicationAudio? }`). You extend
  this ADDITIVELY (optional `edu?` field).
- `src/lib/services/assemble/ReadAlongBundleBuilder.ts` — `buildReadAlongBundle(input)`;
  builder input has `bundle: BookAssetBundle, resolvedSpreadTexts: string[], ...`. Your
  extender runs AFTER this, it does not modify the builder.
- `src/lib/services/assemble/BookAssembler.ts` — step (f) calls the builder; wire the extender
  there behind an `AssembleOptions.eduOverlays?: { sceneTree: SceneTree }` optional input —
  when absent, output is byte-identical to today.
- `src/routes/api/book/[shortcode]/+server.ts` — serves the page's `BundleResponse`
  (`{ shortcode, title, spreads: { index, text, framePngBase64, effect }[], hasVoiceOver,
  hasDedicationAudio, emailGateRequired?, emailGateAfter? }`). Add additive optional `edu`
  passthrough. Respect the existing email-gate truncation (first 4 spreads): when gated, edu
  payload is truncated to the same spreads and the quiz is OMITTED.
- `src/routes/(marketing)/r/[shortcode]/+page.svelte` — the page (Svelte 5 runes:
  `$state`/`$derived`; see its current `fetchBundle()` for the response shape). Your UI lands here
  + new components under `src/lib/components/readaloud/`.
- `src/lib/services/author/types.ts` — `SceneTree`, `Beat` (`emotional_arc` string per beat),
  `DialogicPrompt` (`{ spreadIndex, type, text, peerFollowup? }`), `Tier2WordEntry`
  (`{ word, syllables, ageBandMin, definition_kid, themeAffinities }`).
- `src/lib/services/author/tier2-vocab-corpus.ts` — the word corpus with `definition_kid`.
  CHECK its actual export name and use it; do not duplicate definitions.
- Injectable-boundary exemplar: `src/lib/services/fulfillment/StripeCheckoutService.ts`
  (injected HTTP client) — mirror for the narrator client.
- UI test exemplars: `tests/ui/*.test.ts` (jsdom + `@testing-library/svelte` are devDeps).

## 4. Detailed scope — file-by-file

### 4a. `src/lib/services/readaloud/types.ts`

```ts
export interface WordTiming { word: string; startMs: number; endMs: number; charStart: number; charEnd: number }
export interface TtsSynthResult { audio: Blob | null; wordTimings: WordTiming[] }  // audio null = played live (browser path)
export interface TtsProvider {
  readonly name: string;
  synth(text: string, opts?: { voiceId?: string; rate?: number;
    onBoundary?: (t: WordTiming) => void }): Promise<TtsSynthResult>;
  isAvailable(): Promise<boolean>;
}
export interface GraphemeSegment { grapheme: string; phoneme: string;
  kind: 'consonant'|'short-vowel'|'long-vowel'|'digraph'|'vowel-team'|'silent'|'irregular' }
export type PhonicsMap = Record<string, GraphemeSegment[]>;  // key: lowercased word
export interface Tier2Annotation { word: string; spreadIndex: number; charStart: number;
  charEnd: number; definitionKid: string }
export interface QuizQuestion { type: 'recall'|'sequence'|'feeling'; prompt: string;
  options: [string, string, string]; correctIndex: 0|1|2 }
export interface EduOverlayBundle { wordTimings?: Record<number, WordTiming[]>;
  phonicsMap: PhonicsMap; tier2Annotations: Tier2Annotation[];
  dialogicPrompts: DialogicPrompt[]; quiz: QuizQuestion[] }
```

### 4b. `BrowserSpeechProvider.ts`

Wraps `speechSynthesis` + `SpeechSynthesisUtterance`. Constructor takes an injectable
`synthesis?: Pick<SpeechSynthesis, 'speak'|'cancel'|'getVoices'>` (tests inject a fake firing
scripted `boundary` events). `boundary` events (`event.charIndex`) → `WordTiming`s (endMs of
word k = startMs of word k+1; last word ends at utterance `end`). `audio: null` (live
playback). `isAvailable()` = `typeof speechSynthesis !== 'undefined'` or injected. Rate
clamped 0.5–1.5.

### 4c. `NarratorServerProvider.ts` — CLIENT STUB for a service still being built

A Tennessee-drawl narrator server is being developed separately; it will live at
`NARRATOR_SERVER_URL` (deployment target `http://100.101.215.25:8189` — never hardcode the IP;
env only, with the constructor accepting `baseUrl` + `fetchImpl` injections). Implement the
client against this contract (mocked in tests; NEVER hit the network in tests):

| endpoint | request | response |
|---|---|---|
| `GET /health` | — | `200 { ok: true }` |
| `GET /voices` | — | `200 { voices: [{ id, name, style }] }` |
| `POST /synthesize` | `{ text, voiceId, rate }` | `200 { audioBase64: <WAV>, wordTimings: [{ word, startMs, endMs, charStart, charEnd }] }` |

`isAvailable()`: env unset → `false`; `/health` non-200/timeout (AbortController, 1500 ms) →
`false` — never throws. `synth()`: decode base64 → `Blob` (`audio/wav`); malformed timings →
THROW a descriptive error (do not return empty timings silently — swallowed-error kickback).
Degradation rule for callers: prefer narrator when available, else browser provider — encode in
an exported `pickTtsProvider(providers: TtsProvider[]): Promise<TtsProvider | null>` helper.

### 4d. `PhonicsMapper.ts`

`buildPhonicsMap(words: string[]): PhonicsMap` — pure, deterministic, rule-based (NO LLM, no
network). Bundled rules applied in priority order: (1) exceptions dict (~40 common irregulars:
the, said, was, of, one, two, you, your, they, there, where, who, what, friend, again, …) →
`kind: 'irregular'` whole-word segment; (2) digraphs `sh ch th ph wh ck ng` → one segment,
`kind: 'digraph'`; (3) vowel teams `ai ay ea ee oa oo igh ie ou ow` → `kind: 'vowel-team'`;
(4) silent-e: C+V+C+`e` ending → mark the medial vowel `long-vowel`, the final `e`
`kind: 'silent'`; (5) remaining letters → consonant/short-vowel. Phoneme strings are simple
teaching codes (`/k/ /ā/ /sh/`), not strict IPA. A book has ~200 unique words — the per-book
map is computed once at assembly, not per render.

### 4e. `Tier2Annotator.ts`

`annotateTier2(resolvedSpreadTexts: string[], tier2Words: string[]): Tier2Annotation[]` —
case-insensitive whole-word match per spread (regex with word boundaries; escape input),
`definitionKid` from the corpus (word missing from corpus → annotation with empty definition,
plus a `console.warn`). No positions in dedication/title.

### 4f. `QuizGenerator.ts`

`generateQuiz(tree: SceneTree): QuizQuestion[]` — exactly 3, template-based, NO LLM:
**recall** (beat 2 catalyst: "What happened at the start of the adventure?" — correct option
derived from beat 2's first spread text, distractors from beats 5 and 7); **sequence** ("Which
happened first?" — events from beats 2 vs 6); **feeling** ("How did everyone feel at the
end?" — correct from beat 7 `emotional_arc` tail, distractors fixed contrasting feelings).
Options shuffled DETERMINISTICALLY by FNV-hash of the tree title (repo convention: no
`Math.random`). Texts truncated to ≤ 60 chars for option labels.

### 4g. `ReadAloudBundleExtender.ts` + type/pipeline wiring

`extendReadAlongBundle(bundle: ReadAlongBundle, args: { sceneTree: SceneTree; wordTimings?:
Record<number, WordTiming[]> }): ReadAlongBundle` — returns a copy with `edu: EduOverlayBundle`
(phonics map over the unique words of all spread texts; annotations; dialogic passthrough from
`sceneTree.dialogic_prompts ?? []`; quiz). Add `edu?: EduOverlayBundle` to `ReadAlongBundle` in
`src/lib/services/assemble/types.ts` (additive). Wire into `BookAssembler.assemble` step (f)
behind `AssembleOptions.eduOverlays` (absent → unchanged output). Extend
`/api/book/[shortcode]/+server.ts` to pass `edu` through (gated truncation per §3).

### 4h. UI — `src/routes/(marketing)/r/[shortcode]/+page.svelte` + `src/lib/components/readaloud/`

Components (Svelte 5 runes, no new deps): `ModeToggle.svelte` (Listen / Read-along / Phonics /
Quiz; hidden modes degrade gracefully when `bundle.edu` absent — page renders exactly as today),
`KaraokeText.svelte` (spread text as per-word `<span>`s; active word highlighted from
`WordTiming`s during Listen; in Read-along, tapping a word speaks just that word via the
provider), `PhonicsWord.svelte` (tap → modal/popover: word split into `GraphemeSegment` chips,
color by `kind` — silent = greyed, digraph/team = joined underline; tap chip speaks the
phoneme code via TTS), Tier-2 words get a sparkle-underline class in all modes + tap →
definition card (`definitionKid`), `DialogicBubble.svelte` (parent-facing margin bubble
rendered between beat boundaries from `dialogicPrompts` at matching `spreadIndex`),
`QuizPanel.svelte` (after last spread in Quiz mode; one question at a time; friendly
right/wrong feedback; no scores persisted anywhere). Provider selection: narrator if
`isAvailable()`, else browser TTS, else Listen mode hidden.

## 5. Test plan — `tests/readaloud/` (~20 tests)

- `browser-speech-provider.test.ts` (3): fake synthesis boundary events → correct WordTimings
  (charStart/end + monotonic ms); rate clamped; onBoundary streamed in order.
- `narrator-server-provider.test.ts` (4): mocked fetch happy path (base64 WAV → Blob, timings
  parsed); `/health` 500 → `isAvailable()` false without throwing; env unset → false;
  malformed timings → throws (message names the field).
- `phonics-mapper.test.ts` (6): silent-e (`cake` → c / a(long) / k / e(silent)); digraphs
  (`ship`, `chin`, `that`, `phone` each have one digraph segment); vowel teams (`rain`,
  `boat`); irregular dict (`the`, `said`); 200-word sample → every word mapped, no empty
  segment arrays; determinism (two runs deep-equal).
- `tier2-annotator.test.ts` (2): finds positions across spreads with correct definitionKid;
  word absent from all texts → zero annotations, no crash.
- `quiz-generator.test.ts` (3): 3 questions, one of each type, from a fixture SceneTree;
  every correctIndex valid + options unique; deterministic across runs.
- `bundle-extender.test.ts` (1): extended bundle carries phonicsMap + annotations + dialogic
  passthrough + quiz; original bundle object not mutated.
- `no-mic-guard.test.ts` (1): reads `src/lib/services/readaloud/**`,
  `src/lib/components/readaloud/**`, and the `[shortcode]` page source; asserts NONE contain
  `getUserMedia`, `MediaRecorder`, `SpeechRecognition`, `webkitSpeechRecognition`.

Existing suites that must stay green untouched: `tests/assemble/read-along-bundle-builder.test.ts`,
`tests/assemble/book-assembler.test.ts`, `tests/marketing/` (email gate).

## 6. Verification commands

```bash
cd ~/devbox/storybook-workshop-codex-t3
pnpm check && pnpm lint
npx vitest run tests/readaloud/ tests/assemble/   # new ~20 + assemble suite green
pnpm test                                          # full suite green
```

## 7. Done criteria

- [ ] Service files per §4a–4g; UI per §4h; all additive (no `edu` → page identical to today).
- [ ] ≥ 20 new tests green incl. the no-mic grep-guard; full suite ≥ baseline + 20; check+lint clean.
- [ ] No network calls in any test (mock fetch everywhere; narrator IP appears only in this
      task file, never in code).
- [ ] No new npm dependencies.
- [ ] Branch pushed; PR opened with `king:review` label, body includes test-count delta and a
      note on the narrator-server contract for the team building it.

## 8. Out of scope — do NOT

- Do NOT build the narrator server itself or any server-side TTS — client stub only.
- Do NOT add mic/recording/pronunciation-assessment features (HARD rule, guarded by test).
- Do NOT persist quiz results, analytics, or any kid data (no localStorage of answers).
- Do NOT touch `NameOverlayCompositor.ts`, `PdfBuilder.ts`, `EpubBuilder.ts`, or pricing/orders.
- Do NOT modify the email-gate logic — only mirror its truncation for the `edu` payload.
