---
type: Service
title: Image Generation
description: Provider-switching image generation layer: mock (default/CI), local ComfyUI on the 4090, or cloud via fal.ai.
tags: [imagegen, comfyui, fal-ai, providers, gpu]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/services/imagegen/
status: active
---

# Image Generation

Single entry point `resolveImageGenProvider(env)` selects a provider at startup. All providers share the same `ImageGenProvider` interface.

## Source Layout

- `src/lib/services/imagegen/index.ts` — `resolveImageGenProvider(env)`
- `src/lib/services/imagegen/MockProvider.ts` — returns 1×1 PNG stub
- `src/lib/services/imagegen/LocalGpuProvider.ts` — ComfyUI HTTP client
- `src/lib/services/imagegen/CloudProvider.ts` — fal.ai client
- `src/lib/services/imagegen/workflows.ts` — ComfyUI graph templates

## Provider Resolution

```
IMAGE_GEN_PROVIDER env var
  │
  ├─ unset / "mock"  →  MockProvider   (1×1 png, zero latency)
  ├─ "local"         →  LocalGpuProvider
  └─ "cloud"         →  CloudProvider
```

> `process.env` absent in browser/CI -> mock fires automatically. No config needed for test runs.

## Providers

### MockProvider

- Returns 1×1 transparent PNG data URL
- Used in: browser dev, vitest, CI pipelines
- No external calls

### LocalGpuProvider

- Target: ComfyUI at `http://100.101.215.25:8188` (4090 box over Tailscale)
- Submits workflow JSON from `workflows.ts` via `/prompt` endpoint
- Polls `/history/<prompt_id>` until complete
- Requires Tailscale connectivity + ComfyUI running on the box
- Env: `IMAGE_GEN_PROVIDER=local` (no API key needed — Tailscale auth)

### CloudProvider

- Target: fal.ai API
- Env: `IMAGE_GEN_PROVIDER=cloud`, `IMAGE_GEN_CLOUD_API_KEY=<key>`
- Wraps fal.ai model endpoints; model slug configurable

## workflows.ts

ComfyUI graph templates as JSON. Each workflow is a keyed object mapping node IDs to node configs. `LocalGpuProvider` selects workflow by style pack id or falls back to default SD workflow.

## Integration

- Style pack prompt recipe applied before dispatch → [style packs](/architecture/style-packs.md)
- Called from book generation pipeline → [book pipeline](/architecture/book-pipeline.md)
- Pillar archetype portrait generation uses same provider → [pillar library](/architecture/pillar-library.md)

## Examples

```bash
# local dev against 4090
IMAGE_GEN_PROVIDER=local pnpm dev

# cloud
IMAGE_GEN_PROVIDER=cloud IMAGE_GEN_CLOUD_API_KEY=xxx pnpm dev

# default (mock, no env needed)
pnpm dev
```
