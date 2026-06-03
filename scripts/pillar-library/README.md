# scripts/pillar-library

MVP placeholder pillar-library generator. Produces 50 SVG-derived kid
avatars, per-pillar PNGs, and a manifest JSON consumed by
`PillarManifestClient` as a local fallback when the World Builder pillar
endpoint is unreachable.

## Why this exists

Real Pixal3D-baked 4-view sprite sheets are deferred per ADR-0044 and
[`docs/goals/2026-05-25-pillar-library-pixal3d.md`](../../docs/goals/2026-05-25-pillar-library-pixal3d.md).
The workshop UI still needs Station 2 to render today; this script is
the deterministic placeholder pillar source until the real Pixal3D bake
lands.

## Run

```bash
node scripts/pillar-library/generate-placeholders.mjs
```

Output (`static/pillar-library-v1-placeholder/`):

- `manifest.json` — 50 entries; each carries `{ pillarId, axes,
  embedding (512-dim Float32, L2-normalized), urls }`.
- `{pillarId}/{preview,front,back,left,right}.png` — single-view PNG used
  for all 4 sides (MVP). Real multi-view bake replaces these.

Output is byte-stable across runs (SHA-256-seeded deterministic PRNG).

## Stratification

- 8 hair × 6 skin × 4 eye × 3 age × 5 vibe = 2880 candidate combos.
- Stratified-random samples 50 such that every value of every axis is
  present in ≥1 entry. Tests at
  `tests/pillar-library-placeholder.test.ts` enforce this.

## PNG rasterizer

Uses [`@resvg/resvg-js`](https://www.npmjs.com/package/@resvg/resvg-js)
(a devDependency) when available. If the import fails (CI / minimal-deps
env), the script writes `.svg` siblings instead and the manifest's
`urls.{view}` paths point at `.svg` — the workshop UI loads SVG via
`<img>` natively, so the asset path remains usable.

## Determinism

Seed lives at `SEED_HEX = 'b00ba100'` in the script. Embeddings are
SHA-256-seeded 64-bit → SplitMix64 → 512 floats → L2-normalize. Same
axes → same embedding across hosts and runs.
