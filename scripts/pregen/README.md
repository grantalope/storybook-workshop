# Pregen Asset Bank Drivers

These Node ESM scripts build the layered scene-grammar bank without running inside CI. Tests mock HTTP; real runs happen on the GPU box against ComfyUI.

## Layers

| layer | grid | phase 1 | full |
|---|---|---|---|
| A plates | 12 locales x 7 moods x styles | 336 @ 4-style set | 84 x N styles |
| B poses | 150 archetypes x 8 poses x styles | top-20 archetypes = 640 @ 4 styles | 4800 @ 4 styles |
| C props | ~100 props x styles | 400 @ 4 styles | 400+ |

Recommended order: A plates, then C props, then B poses in filtered archetype phases. On the RTX 4090 Lightning 4-step path, warm generation is roughly 11 seconds per image, so the phase-1 bank is about 4.2 hours before matting and QC.

## Commands

```bash
node scripts/pregen/plate-gen.mjs --server http://100.101.215.25:8188 --out scripts/pregen/.bank --styles flat-painted,ukiyo-e-woodblock --style-prompts /path/styles.json
node scripts/pregen/prop-gen.mjs --server http://100.101.215.25:8188 --out scripts/pregen/.bank --styles flat-painted,ukiyo-e-woodblock
node scripts/pregen/pose-gen.mjs --server http://100.101.215.25:8188 --out scripts/pregen/.bank --styles flat-painted --taxonomy D:/ai/pillar-library/taxonomy.json --filter 'p0(0[1-9]|1\\d|20)/'
node scripts/pregen/matting.mjs --in scripts/pregen/.bank --tolerance 48
node scripts/pregen/bank-manifest.mjs --bank scripts/pregen/.bank --expect-styles flat-painted,ukiyo-e-woodblock --taxonomy D:/ai/pillar-library/taxonomy.json
node scripts/pregen/qc-similarity.mjs --bank scripts/pregen/.bank --portraits D:/ai/pillar-library/portraits --threshold 0.75
```

Use `--dry-run` on any generation driver to print the full job list plus the first three prompts with no network calls. `--limit` and `--filter` are applied to asset IDs after the deterministic grid is built.

## Resume And QC

Drivers are sequential (`--concurrency` is capped at 1). Existing output PNGs are skipped and counted as resume hits; missing sidecars are recreated from the deterministic asset ID metadata.

Each generated PNG gets a sidecar JSON entry compatible with `BankManifest`. The manifest command scans those sidecars, writes `manifest.json` and `coverage-report.json`, and exits with code 1 unless coverage is complete for the expected styles and optional taxonomy.

QC compares every Layer-B sprite to `<portraits>/<archetypeId>.png` in the same CLIP space as `PillarVectorizerService` (`Xenova/clip-vit-base-patch32`). Entries below threshold are written to `regen-queue.json` with the original seed and a deterministic retry seed.
