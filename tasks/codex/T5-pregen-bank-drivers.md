# T5 — Mass Pre-Gen Asset-Bank Drivers (Layers A/B/C + Manifest + QC)

**Branch:** `feat/pregen-bank-drivers` · **Worktree:** `~/devbox/storybook-workshop-codex-t5`
**Protocol:** read `README-protocol.md` (same directory / `~/codex-tasks/`) for environment,
worktree setup, commit rules, PR sequence. Repo `~/devbox/storybook-workshop` on claude.local —
Node 22, pnpm, Vitest 4. Baseline ~1097 tests green — keep them green.
**CRITICAL FRAMING:** you write repo-side DRIVER SCRIPTS + manifest tooling only. The actual
generation runs are executed later BY THE SUPERVISOR on the GPU box (Windows, RTX 4090,
ComfyUI at `http://100.101.215.25:8188`). Your tests mock ALL HTTP. Nothing you write may
contact a live server in CI.

## 1. Objective

Build `scripts/pregen/` — Node ESM (`.mjs`) drivers that mass-generate the layered asset
banks consumed by the scene-grammar compositor (T1): **Layer A** background plates
(locale × beatMood × style), **Layer B** character pose sprites (archetype × poseClass ×
style, solid chroma-key background), **Layer C** props, plus a color-key **matting** step, a
**bank-manifest builder** with coverage report, and an **embedding-similarity QC hook** that
flags off-model character sprites for regeneration.

## 2. Why it matters

Composing spreads from pre-generated banks turns a ~20 s/spread diffusion cost into a cheap
deterministic composite, and makes character consistency a LOOKUP instead of a per-spread
multi-ref gamble. The bank is thousands of images — it can only be built by resumable,
deterministic, phased batch drivers, never by hand.

## 3. Execution context (the GPU box — for prompt/doc accuracy; you never touch it)

ComfyUI queue API (verified live 2026-06-10):

| call | shape |
|---|---|
| `POST /prompt` | body `{ "prompt": <api-format graph JSON> }` → `{ "prompt_id": "..." }` |
| `GET /history/<prompt_id>` | poll until response JSON has `outputs` (contains `images: [{ filename, subfolder, type }]`) |
| `GET /view?filename=X&subfolder=Y&type=output` | fetch the PNG bytes |
| `POST /upload/image` | multipart, field `image` (not needed for T2I drivers) |
| `GET /system_stats` | health check before a run |

**Embed this PROVEN T2I split-loader graph as a template constant** (verified on the box;
Lightning low-step, cfg 1.0, euler/simple — the bulk-generation pipeline):

```json
{
  "37": { "class_type": "UNETLoader", "inputs": { "unet_name": "qwen_image_2512_fp8_e4m3fn.safetensors", "weight_dtype": "default" } },
  "70": { "class_type": "LoraLoaderModelOnly", "inputs": { "lora_name": "Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors", "strength_model": 1.0, "model": ["37", 0] } },
  "38": { "class_type": "CLIPLoader", "inputs": { "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image", "device": "default" } },
  "39": { "class_type": "VAELoader", "inputs": { "vae_name": "qwen_image_vae.safetensors" } },
  "66": { "class_type": "ModelSamplingAuraFlow", "inputs": { "shift": 3.1, "model": ["70", 0] } },
  "6":  { "class_type": "CLIPTextEncode", "inputs": { "text": "POSITIVE", "clip": ["38", 0] } },
  "7":  { "class_type": "CLIPTextEncode", "inputs": { "text": "NEGATIVE", "clip": ["38", 0] } },
  "58": { "class_type": "EmptySD3LatentImage", "inputs": { "width": 1328, "height": 1328, "batch_size": 1 } },
  "3":  { "class_type": "KSampler", "inputs": { "seed": 42, "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0, "model": ["66", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["58", 0] } },
  "8":  { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["39", 0] } },
  "60": { "class_type": "SaveImage", "inputs": { "filename_prefix": "PREFIX", "images": ["8", 0] } }
}
```

Steps/cfg/lora are flag-overridable (`--steps 8` etc. — an 8-step Lightning variant also runs
cfg 1.0) but DEFAULTS are exactly the verified constants above. Patch targets: node `6` text
(positive), `7` (negative), `58` width/height, `3` seed/steps, `60` filename_prefix.

**Archetype taxonomy** (Layer B input) lives ON THE GPU BOX at
`D:/ai/pillar-library/taxonomy.json` — the path is a REQUIRED `--taxonomy` flag (never
hardcode). Shape (150 archetypes):

```json
{ "_meta": { "...": "weights, guardrails" },
  "archetypes": [ { "id": "p001", "displayName": "curly-haired bookworm", "ageBand": "4-6",
    "gender": "girl", "skinTone": 4, "hair": { "color": "black", "texture": "curly",
    "length": "medium" }, "features": ["glasses"], "vibe": "cozy-corner bookworm",
    "dnaPrompt": "A young girl with warm tan-brown skin, ... Signature accessory: a well-loved picture book." } ] }
```

## 4. Repo context — real paths

- `src/lib/services/author/types.ts` — `LocaleBiome` (12: forest, seaside, mountain, desert,
  meadow, snowfield, jungle, urban, farm, underwater, space, imaginary) and `BeatName` (7:
  setup, catalyst, debate, midpoint, trial, climax, resolution). Drivers are `.mjs` and can't
  import TS — duplicate these two string lists as constants in `scripts/pregen/lib/grids.mjs`
  with a comment naming the TS source of truth, AND add one vitest that imports BOTH and
  asserts the lists are equal (drift guard).
- `BankManifest` JSON contract — identical to T1 (`src/lib/services/scenegrammar/types.ts`
  if `feat/wfc-scene-grammar` is merged; otherwise this shape verbatim):
  `{ version: 1, bankRoot, entries: [{ assetId, layer: 'A'|'B'|'C', styleId, locale?,
  beatMood?, archetypeId?, poseClass?, propId?, file, seed, qcSimilarity?, generatedAtIso }] }`.
  PoseClass (8): `standing-neutral, walking, running, sitting, reaching, pointing, hugging,
  sleeping`.
- `src/lib/services/PillarVectorizerService.ts` — the existing CLIP path
  (`Xenova/clip-vit-base-patch32` via `@xenova/transformers`, 512-dim). The QC hook must
  embed in THIS SAME space (use `@xenova/transformers` image pipeline directly in the script;
  it's already a devDependency).
- Tests in `tests/pregen/`.

## 5. Detailed scope — file-by-file (`scripts/pregen/`)

### 5a. `lib/comfy-client.mjs`
`createComfyClient({ serverUrl, fetchImpl = fetch, pollIntervalMs = 1500, timeoutMs =
180000 })` → `{ health(), queuePrompt(graph), awaitOutputs(promptId), fetchImage({ filename,
subfolder, type }), generateOne({ graph }) }`. Sequential by design — `generateOne` queues,
polls `/history`, downloads the first output PNG, returns `Uint8Array`. Timeout/non-200 →
thrown error with prompt_id + last status (NEVER swallowed).

### 5b. `lib/graph-templates.mjs`
`T2I_LIGHTNING_GRAPH` (the §3 constant, frozen), `patchGraph(graph, { positive, negative,
width, height, seed, steps, filenamePrefix })` → deep-cloned patched copy.

### 5c. `lib/seed.mjs` + `lib/cli.mjs`
`fnv1a(str): number` → deterministic seed per assetId (`seedFor(assetId)`).
`parseArgs(argv, spec)` — supports `--server`, `--out`, `--styles a,b,c`, `--taxonomy`,
`--limit N`, `--filter <regex on assetId>`, `--dry-run`, `--steps`, `--concurrency` (default 1,
max 1 enforced — sequential queue), with required-flag errors listing what's missing.

### 5d. `lib/grids.mjs` + `lib/props.mjs`
`LOCALES` (12), `BEAT_MOODS` (7), `POSE_CLASSES` (8) + drift-guard exports. `props.mjs`:
~100 prop entries `{ propId, label, localeAffinity: LocaleBiome[] }` (lantern, picture book,
red wagon, sandcastle, sled, kite, umbrella, teddy bear, fishing rod, telescope, …) — author
sensible kid-book props across all 12 locales.

### 5e. `plate-gen.mjs` (Layer A)
Grid: locale × beatMood × styles. assetId `plateA/<locale>/<mood>/<style>`. Positive prompt =
**"empty stage" negative-space composition**: style prefix (pack id passed through `--styles`;
prompt text per style provided via `--style-prompts <json file>` mapping styleId →
{ prefix, suffix, negative } so T4 packs can be exported to it) + locale scenery + mood
lighting + `"wide empty foreground, open negative space at center, no people, no characters,
no animals, no text"`. Negative always includes `"people, characters, faces, text, watermark,
border"`. 1328×1024.

### 5f. `pose-gen.mjs` (Layer B)
Reads `--taxonomy` JSON (§3 shape). Grid: archetype × POSE_CLASSES × styles. assetId
`poseB/<archetypeId>/<poseClass>/<style>`. Positive = archetype `dnaPrompt` + `", full body,
<poseClass description>, on a solid uniform chroma green background, no scenery, single
character, feet visible"` + style prefix/suffix. Negative includes `"background scenery,
landscape, text, multiple people, cropped limbs"`. `--filter 'p0(0[1-9]|1\d|20)/'`-style
regexes enable the phased top-20 run. 1024×1328 (portrait).

### 5g. `prop-gen.mjs` (Layer C)
Grid: props × styles. assetId `propC/<propId>/<style>`. Solid-key background like Layer B.
768×768.

### 5h. `matting.mjs`
`node scripts/pregen/matting.mjs --in <dir> --tolerance 48` — chroma-key: decode PNG, pixels
within Euclidean RGB tolerance of the dominant corner color → alpha 0, light edge feather
(1px), write `<name>.matted.png`, skip existing. Add **`pngjs`** as a devDependency (the ONLY
allowed new dep; pure-JS, no native build).

### 5i. `bank-manifest.mjs` + `lib/manifest.mjs`
Every gen driver writes a JSON sidecar per asset (`<file>.json` with the BankAssetEntry).
`bank-manifest.mjs --bank <dir> --expect-styles a,b,c [--taxonomy ...]` scans sidecars →
`manifest.json` (§4 shape) + coverage report: expected grid vs present, per-layer counts,
missing-entry list, `coverageRatio`. Exit code 1 when coverage < 1.0 (supervisor gates on it).

### 5j. `qc-similarity.mjs`
`--bank <dir> --portraits <dir> --threshold 0.75 [--embedder <module>]` — for each Layer-B
entry: CLIP-embed sprite + the archetype's portrait (`<portraits>/<archetypeId>.png`), cosine
similarity; `< threshold` → entry flagged (`qcSimilarity` written into sidecar + listed in
`regen-queue.json` with its original seed + a bumped retry seed). Embedder injectable
(`--embedder` dynamic-imports a module exporting `embedImage(path): Promise<Float32Array>`;
default impl uses `@xenova/transformers` clip-vit-base-patch32 — SAME space as
`PillarVectorizerService`). Tests inject a fake embedder; default impl never runs in CI.

### 5k. Shared driver behaviors (every gen driver — tested)
Sequential queue (one in-flight job); **resume-safe** (output file exists → skip, count as
`skipped`); deterministic seeds (`seedFor(assetId)` — re-running a deleted asset reproduces
the identical image); progress log lines `[pregen] 17/336 plateA/forest/setup/ukiyo-e seed=...
(elapsed Xs, eta Ys)`; `--dry-run` prints the full job list + first 3 full prompts and exits 0
without any HTTP.

## 6. Budget table (documented in `scripts/pregen/README.md` — write it)

| layer | grid | phase 1 | full |
|---|---|---|---|
| A plates | 12 locales × 7 moods × styles | 336 @ 4-style set | 84 × N styles |
| B poses | 150 archetypes × 8 poses × styles | top-20 archetypes = 640 @ 4 styles | 4800 @ 4 styles |
| C props | ~100 props × styles | 400 @ 4 styles | 400+ |

Plus run order (A → C → B phased), warm-gen cost note (~11 s/image Lightning 4-step on the
4090 → phase 1 ≈ 4.2 h), and the resume/QC/regen loop.

## 7. Test plan — `tests/pregen/` (~12 tests, ALL HTTP mocked)

- `cli.test.ts` (3): `--limit`/`--filter` shrink the job list correctly; missing required flag
  → error naming it; `--dry-run` performs zero fetch calls (inject counting fetch).
- `prompt-assembly.test.ts` (3): plate prompt contains "empty stage"/negative-space wording +
  locale + mood, negative contains "characters"; pose prompt contains dnaPrompt verbatim +
  pose description + "chroma green"; prop prompt solid-key + style prefix from a style-prompts
  fixture.
- `graph-patch.test.ts` (1): patchGraph sets nodes 6/7/58/3/60 correctly, original frozen
  template unmutated.
- `manifest.test.ts` (2): sidecar scan → manifest with correct per-layer counts; coverage
  report lists exact missing combos + ratio, exit-code contract.
- `qc-threshold.test.ts` (2): fake embedder forcing cosine 0.6 → flagged + in regen queue with
  bumped seed; 0.9 → pass, sidecar gets qcSimilarity.
- `resume-safe.test.ts` (1): pre-existing output file → driver skips (0 HTTP calls for that
  asset), logs `skipped`.
- Plus the grids drift-guard from §4 (counts toward the total if you prefer 13 — fine).

## 8. Verification commands

```bash
cd ~/devbox/storybook-workshop-codex-t5
pnpm check && pnpm lint && npx vitest run tests/pregen/   # ~12 green
pnpm test                                                  # full suite green
node scripts/pregen/plate-gen.mjs --dry-run --styles s1 --out /tmp/bank --server http://localhost:9 # exits 0, no network
```

## 9. Done criteria

- [ ] All scripts in §5 + `scripts/pregen/README.md` with the §6 budget table.
- [ ] ≥ 12 new tests green, full suite ≥ baseline + 12, check + lint clean.
- [ ] Only new dependency: `pngjs` (devDependency).
- [ ] `--dry-run` proven network-free by test; no test touches a live server.
- [ ] Deterministic: same assetId → same seed → same patched graph (tested).
- [ ] Branch pushed; PR opened with `king:review` label + test-count delta.

## 10. Out of scope — do NOT

- Do NOT execute any real generation run or call `100.101.215.25` from anywhere.
- Do NOT build the spread compositor (T1 owns planning; a future task owns compositing).
- Do NOT train LoRAs or touch `src/lib/services/imagegen/` providers.
- Do NOT add sharp/canvas or any native dependency (pngjs only).
- Do NOT commit generated images, sidecars, or manifests (gitignore `scripts/pregen/.bank/`).
