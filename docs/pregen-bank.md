# Pregen Bank — Storage, Manifest, Regeneration

## What this is

The pregen bank is the library of pre-generated, style-locked PNG assets that
the scenegrammar engine composes into spreads (see
`src/lib/services/scenegrammar/` — `BankManifestStore.ts`,
`CompositionPlanner.ts`). Three layers:

| Layer | Path convention | Key fields | Grid |
|---|---|---|---|
| A (plates) | `plateA/<locale>/<beatMood>/<styleId>.png` | locale × beatMood | 12 locales × 7 beats |
| B (poses) | `poseB/<archetypeId>/<poseClass>/<styleId>.png` | archetypeId × poseClass | 150 archetypes × 8 poses |
| C (props) | `propC/<propId>/<styleId>.png` | propId | 102 props |

Expected grid at one style (`flat-painted`): **1386 assets**. Every PNG has a
`<name>.png.json` sidecar that is already a valid `BankAssetEntry`.

## Storage ruling (2026-06-11 — do not re-litigate)

Full-resolution bank PNGs are **~1.1 GB and stay OUT of git**. The repo carries
only:

- `static/pregen-bank/manifest.json` — full `BankManifest` (version 1),
  validated by `loadBankManifest()` in
  `src/lib/services/scenegrammar/BankManifestStore.ts`. Entries point at
  **bank-relative paths** under `bankRoot: "scripts/pregen/.bank"`, plus a
  repo-only `thumb` field (BankManifestStore ignores unknown fields).
- `static/pregen-bank/thumbs/` — 256px JPEG q80 thumbnail per asset, keyed by
  assetId (`thumbs/<assetId>.jpg`). Small enough for git; good enough for
  pickers, QC review, and dev UI.
- This document.

## Where the full-res bank lives

- Host: lilaiputia (`claude.local` / `100.104.9.90`)
- Path: `~/devbox/storybook-workshop-codex-t5/scripts/pregen/.bank/`
  (the T5 `feat/pregen-bank-drivers` worktree)
- Layout: `plateA/`, `poseB/`, `propC/` + per-asset `.png.json` sidecars, plus
  the bank-local `manifest.json` / `coverage-report.json` written by
  `scripts/pregen/bank-manifest.mjs` (those two are bank-internal; the repo
  manifest below is the canonical one for the app).

Known bank anomaly: some pose ingests left nested duplicates
(`poseB/<a>/<pose>/flat-painted/flat-painted.png` alongside the canonical
`poseB/<a>/<pose>/flat-painted.png`, same assetId + seed). The repo manifest
builder dedupes these, preferring the canonical path.

## Regeneration runbook

Generation runs as tmux/queue lanes on lilaiputia. The lane workspace is
`/tmp/bb-imagegen-lanes-v2/` (per-lane HOME dirs under `homes/`, e.g.
`bb2-pose-p129-p130`, `bb2-plate-underwater`):

1. **Drivers** (committed in `scripts/pregen/`): `plate-gen.mjs`,
   `pose-gen.mjs` (`--taxonomy static/pillar-library-v2/taxonomy.json`, the
   150-archetype roster), `prop-gen.mjs`, `matting.mjs`, `qc-similarity.mjs`,
   plus `ingest-internal-imagegen.mjs` (T5 worktree) which normalizes raw lane
   output into the bank with sidecars.
2. **Lane scripts** (`/tmp/bb-imagegen-lanes-v2/`): `run_lane.sh`,
   `run_pose_lane.sh`, `bb-process-pose-asset.py`, `process_prop_asset.py`,
   per-lane `*.marker` / `*.status` files. The compound queue runner
   (`~/devbox/compound/bin/queue-loop.sh`) keeps lanes fed.
3. After lanes finish (or any bank change), rebuild the repo artifacts from the
   repo root:

   ```bash
   node scripts/pregen/build-manifest-from-bank.mjs \
     --bank ~/devbox/storybook-workshop-codex-t5/scripts/pregen/.bank \
     --expect-styles flat-painted
   python3 scripts/pregen/build-thumbs.py \
     --bank ~/devbox/storybook-workshop-codex-t5/scripts/pregen/.bank
   node scripts/pregen/validate-repo-manifest.mjs \
     --bank ~/devbox/storybook-workshop-codex-t5/scripts/pregen/.bank
   ```

   `validate-repo-manifest.mjs` loads the manifest through the real
   `BankManifestStore` (hard-fails on schema problems, duplicate assetIds,
   missing/orphan thumbs) and prints the coverage report. Coverage < 100% is
   non-fatal — it means lanes are still filling the grid; rebuild when done.

4. Commit the refreshed `static/pregen-bank/` (manifest + changed thumbs).

## Deploy note

Production does NOT serve full-res assets from git. Deploy = rsync the bank to
the CDN/static host so that `bankRoot` resolves, e.g.:

```bash
rsync -av --include='*/' --include='*.png' --exclude='*' \
  ~/devbox/storybook-workshop-codex-t5/scripts/pregen/.bank/ \
  <cdn-or-static-host>:/srv/storybook/pregen-bank/
```

and point the app's bank base URL at that host. The committed
`static/pregen-bank/manifest.json` + thumbs ship with the app build; only the
full-res binaries come from the synced bank.
