# T4 — Art-History Style Packs (12 Packs as Data + Curation Guards)

**Branch:** `feat/art-history-styles` · **Worktree:** `~/devbox/storybook-workshop-codex-t4`
**Protocol:** read `README-protocol.md` (same directory / `~/codex-tasks/`) for environment,
worktree setup, commit rules, PR sequence. Repo `~/devbox/storybook-workshop` on claude.local —
SvelteKit + Svelte 5 runes + TS strict + Vitest 4, `$lib` = `src/lib`, Node 22, pnpm.
Baseline ~1097 tests green — keep them green.

## 1. Objective

Ship 12 art-history style packs AS DATA (you author the pack content too: prompt recipes +
kid-facing educational cards), a `StylePackRegistry` with hard curation guards (public-domain
only, culture-respect, pre-1955 era), prompt-composition integration at the imagegen boundary,
a Station-5 style grid driven by the registry, an optional "About this art style" backmatter
page in `BookAssembler`, and a final style card on the read-along page. New directory:
`src/lib/services/stylepacks/`.

## 2. Why it matters

Today there are exactly 3 renderer-mode styles (`octopath-hd2d`, `flat-painted`,
`pixel-pure` — `src/lib/workshop/types.ts:20`). Art-history packs turn every book into a
mini art lesson (the educational card is the differentiator vs every competitor's "pick a
filter") and the prompt recipes give the diffusion pipeline disciplined, legally-safe style
control. The curation guards are non-negotiable: a kids' product CANNOT ship "in the style of
<living illustrator>" — that's both a legal exposure and an ethics line. Guards must be
enforced by code + tests, not by docs.

## 3. Repo context — real paths (read BEFORE coding)

- `src/lib/workshop/types.ts` — `ArtStyle = 'octopath-hd2d' | 'flat-painted' | 'pixel-pure'`
  (line ~20) + `ART_STYLES` array. These 3 legacy ids MUST keep working everywhere they're
  used today (grep them; e.g. `src/lib/workshop/stations/Station5DressStory.svelte` has a
  per-style display map; `src/lib/workshop/advanced/stations/Station5_5RenderDirection.svelte`).
- `src/lib/services/imagegen/types.ts` — `ImageGenRequest` (`prompt`, `negativePrompt?`,
  `styleId?` — plain ids are provider-defined; `lora:<path>[@scale]` routes to LoRA pipeline).
  Your composer transforms requests; it does NOT touch providers.
- Find the actual prompt-assembly boundary: `grep -rn "\.generate(" src/lib --include='*.ts'`
  and `grep -rn "illustration_brief\|spreadPrompt\|WorkshopBookPipeline" src/lib src/routes`.
  Integrate `applyStylePackToRequest` at the single choke point where a spread's
  illustration brief becomes an `ImageGenRequest`. If no such production choke point exists
  yet (drafts may render via the HD-2D engine instead), export the helper from the barrel and
  wire it into `src/lib/services/imagegen/workflows.ts`'s style handling so both backends get
  it — state which you found in the PR body.
- `src/lib/services/assemble/BookAssembler.ts` — `assemble(bundle, options)`; `AssembleOptions`.
- `src/lib/services/assemble/PdfBuilder.ts` + `LuluPdfSpecValidator.ts` — READ BOTH before
  touching page composition: the interior **page-count parity / min-max logic must remain
  intact** (validator checks `interiorPageCount` vs format; assembler tests in
  `tests/assemble/` encode current behavior).
- `src/lib/services/assemble/types.ts` — `ReadAlongBundle.manifest` (additive optional
  `stylePackId?: string`).
- `src/routes/(marketing)/r/[shortcode]/+page.svelte` — read-along page (T3 also adds a
  section here on its own branch; keep your edit additive and small — merge note already in
  README-protocol §8).

## 4. The 12 packs (you author this data — quality bar: a parent reads it aloud and smiles)

| id | displayName | cultureTag | era | inspirations (all died ≥ 70y ago) |
|---|---|---|---|---|
| `ukiyo-e-woodblock` | Ukiyo-e Woodblock | japan | 1700–1860 | Hokusai (d. 1849), Hiroshige (d. 1858) |
| `impressionist-garden` | Impressionist Garden | — | 1870–1926 | Monet (d. 1926) |
| `post-impressionist-swirl` | Swirling Starlight | — | 1885–1905 | Van Gogh (d. 1890) |
| `cutout-collage` | Paper Cutout Collage | — | 1940–1954 | Matisse (d. 1954) |
| `watercolor-botanical` | Watercolor Botanical | — | 1880–1945 | Potter-era natural-history school (Beatrix Potter d. 1943) |
| `stained-glass` | Stained Glass Window | — | 1150–1500 | anonymous medieval glaziers (no named entry) |
| `illuminated-manuscript` | Illuminated Manuscript | — | 800–1500 | anonymous scriptoria |
| `persian-miniature` | Persian Miniature | persia | 1300–1600 | Behzād (d. ~1535) |
| `mexican-amate-folk` | Amate Folk Painting | mexico | pre-1900 tradition | anonymous folk tradition |
| `scandinavian-rosemaling` | Rosemaling | scandinavia | 1750–1900 | anonymous rural painters |
| `art-nouveau-poster` | Art Nouveau Poster | — | 1890–1939 | Mucha (d. 1939) |
| `bauhaus-geometric` | Bauhaus Shapes | — | 1919–1944 | Klee (d. 1940), Kandinsky (d. 1944) |

Each pack carries: `promptRecipe { positivePrefix, positiveSuffix, negativeAdditions,
palette: string[] /* 4-6 hex */ }` describing TECHNIQUE (flat perspective, visible woodgrain,
mineral-pigment, gold-leaf, leaded outlines, impasto swirls…) and `educationalCard
{ kidExplainer /* age 5-8 voice, 2-3 sentences */, funFact, lookFor, tryItYourself,
famousWorkDescription /* describe a public-domain work, don't embed images */ }`. Culture-tagged
packs additionally carry `respectNote` (1-2 sentences for parents on the tradition's origin).

## 5. Detailed scope — file-by-file (`src/lib/services/stylepacks/`, barrel `index.ts`)

### 5a. `types.ts`

```ts
export interface StylePack {
  id: string; displayName: string;
  legacy?: boolean;                       // true only for the 3 renderer-mode passthroughs
  era?: { start: number; end: number };   // REQUIRED unless legacy; end <= 1955
  cultureTag?: 'japan'|'persia'|'mexico'|'scandinavia';
  respectNote?: string;                   // REQUIRED when cultureTag set
  inspirations: Array<{ name: string; died: number }>;  // empty allowed (anonymous traditions)
  promptRecipe?: { positivePrefix: string; positiveSuffix: string;
    negativeAdditions: string; palette: string[] };     // REQUIRED unless legacy
  educationalCard?: { kidExplainer: string; funFact: string; lookFor: string;
    tryItYourself: string; famousWorkDescription: string };  // REQUIRED unless legacy
}
```

### 5b. `packs.ts` — the 12 packs from §4 + 3 legacy passthroughs
(`octopath-hd2d`, `flat-painted`, `pixel-pure` with `legacy: true`, no recipe/card — they keep
flowing to the renderer untouched).

### 5c. `StylePackRegistry.ts`

`validateStylePack(pack, currentYear = new Date().getFullYear())` throws descriptively on:
non-legacy without era/promptRecipe/educationalCard; `era.end > 1955`; any inspiration with
`died + 70 > currentYear`; cultureTag without respectNote; any educationalCard field empty;
palette entry not `#rrggbb`. `ALL_STYLE_PACKS` validated AT MODULE LOAD (bad data fails CI,
not production). API: `getStylePack(id): StylePack | null`, `listStylePacks(): StylePack[]`
(legacy first, then the 12 in §4 order), `isLegacyStyle(id)`.

### 5d. `applyStylePack.ts`

`applyStylePackToRequest(req: ImageGenRequest, packId: string): ImageGenRequest` — pure copy:
prompt = `positivePrefix + ', ' + req.prompt + ', ' + positiveSuffix`; negativePrompt =
existing + `, ` + negativeAdditions; legacy ids → request returned UNCHANGED (renderer modes,
not prompt styles); unknown id → throw `StylePackError` naming the id. Wire at the §3 choke
point.

### 5e. Curation guard data — `bannedNames.ts`

`BANNED_STYLE_REFERENCES` (case-insensitive): `Eric Carle, Oliver Jeffers, Jon Klassen,
Sophie Blackall, Mo Willems, Maurice Sendak, Dr. Seuss, Quentin Blake, Richard Scarry,
Mary Blair, Chris Van Allsburg, Shaun Tan, Beatrix Potter` *(the watercolor pack references the
era/school — the name "Beatrix Potter" must not appear in any PROMPT RECIPE; it may appear in
the educationalCard era attribution only — encode this split in the guard)*, `Miyazaki, Ghibli,
Disney, Pixar, Dreamworks`. Guard function `assertNoBannedReferences(packs)` scans every
promptRecipe string; called at module load alongside validation.

### 5f. Station 5 grid — `src/lib/workshop/stations/Station5DressStory.svelte`

Replace the hardcoded 3-style map with `listStylePacks()` (15 tiles): displayName, palette
swatch strip, `kidExplainer` as tooltip/short line for art-history packs. Selection writes the
pack id string into the existing draft-store field. Widen the type minimally: keep the
`ArtStyle` union export for back-compat, add `export type StyleSelectionId = string` where the
draft store stores it — verify `tests/ui/station-flow.test.ts` + `workshop-draft-store.test.ts`
still pass; default stays `octopath-hd2d`.

### 5g. Backmatter page — `BookAssembler` + `PdfBuilder`

`AssembleOptions.includeStyleCard?: boolean` (default **true**) + `AssembleOptions.stylePackId?:
string`. When ON and the pack is non-legacy: append an "About this art style" interior page
(pdf-lib `drawText` — title, kidExplainer, funFact, lookFor, tryItYourself, respectNote if
present; no images required). **Page-parity invariant:** read the existing parity/min-max logic
in `PdfBuilder`/`LuluPdfSpecValidator` first; if appending 1 page breaks the rule, append a
blank facing page; `validatePdf` must still pass. OFF or legacy/absent pack → output identical
to today (existing `tests/assemble/` prove it).

### 5h. Read-along final card

Additive `stylePackId?: string` on `ReadAlongBundle.manifest` (`assemble/types.ts`), threaded
through `/api/book/[shortcode]/+server.ts`, rendered after the last spread on
`src/routes/(marketing)/r/[shortcode]/+page.svelte` from `getStylePack(...)` — card shows
kidExplainer + lookFor + respectNote. Absent id → page identical to today.

## 6. Test plan — `tests/stylepacks/` (~14 tests)

- `registry-data.test.ts` (4): exactly 15 packs (3 legacy + 12 art-history, §4 ids verbatim);
  every non-legacy pack passes `validateStylePack(pack, 2026)`; every educationalCard field
  non-empty and kidExplainer ≤ 400 chars; every palette entry matches `/^#[0-9a-f]{6}$/i`.
- `curation-guards.test.ts` (5): inline fixture with `era.end = 1980` throws; fixture
  inspiration `died: 1991` throws (Seuss-shaped); cultureTag without respectNote throws; all 4
  culture-tagged shipping packs have respectNote + their promptRecipes contain NONE of
  `costume, ethnic, oriental, exotic` (technique-not-costume check); banned-names guard —
  `assertNoBannedReferences` passes on shipping packs AND throws on a fixture whose prefix
  says "in the style of Eric Carle".
- `apply-style-pack.test.ts` (2): prompt prefix/suffix + negative merge correct, request not
  mutated; legacy id → unchanged request; unknown id throws (3 asserts across 2 tests fine).
- `assembler-style-card.test.ts` (3): includeStyleCard ON + `ukiyo-e-woodblock` → page count
  grows AND `validatePdf` passes (parity preserved); explicit OFF → page count identical to a
  baseline run; default (option omitted) behaves as ON for non-legacy pack id, and as today
  when `stylePackId` absent. Reuse `tests/assemble/_fixtures.ts`.

## 7. Verification commands

```bash
cd ~/devbox/storybook-workshop-codex-t4
pnpm check && pnpm lint
npx vitest run tests/stylepacks/ tests/assemble/ tests/ui/   # new ~14 + neighbors green
pnpm test                                                     # full suite green
grep -rin "eric carle\|jeffers\|klassen\|blackall\|sendak\|seuss" src/lib/services/stylepacks/packs.ts && echo LEAK || echo CLEAN
```

## 8. Done criteria

- [ ] 15-pack registry validated at module load; all guards thrown-at-runtime, not comments.
- [ ] All 12 educational cards written in genuine age-5-8 voice (reviewer will read them).
- [ ] ≥ 14 new tests green; full suite ≥ baseline + 14; check + lint clean.
- [ ] Legacy 3 ids verified working: grep call sites, `tests/ui/` green untouched.
- [ ] Page-parity invariant proven by test in both flag states.
- [ ] Branch pushed; PR opened with `king:review` label; PR body names the prompt-assembly
      choke point you wired (§3) and the test-count delta.

## 9. Out of scope — do NOT

- Do NOT generate or commit any images; packs are text data only.
- Do NOT reference living artists or post-1955 movements anywhere, including test fixtures
  outside the deliberately-failing guard fixtures.
- Do NOT touch `LocalGpuProvider.ts` / `CloudProvider.ts` internals or LoRA routing.
- Do NOT restyle Station 5's layout/CSS beyond what the registry-driven grid needs.
- Do NOT add per-style fonts, textures, or asset files — prompt recipes + cards only.
