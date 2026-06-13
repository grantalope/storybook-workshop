---
type: Service
title: Privacy
description: Privacy-by-default pillar: PII gate blocks HARD categories, CLIP embedding keeps photos on-device, no raw user data uploaded.
tags: [privacy, pii, clip, gdpr, on-device]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/privacy/PrivacyFilterService.ts
status: active
---

# Privacy

Privacy-by-default is a product pillar. Two enforcement points: PII text gate + on-device photo embedding.

## PII Gate — PrivacyFilterService

`src/lib/privacy/PrivacyFilterService.ts`

### Categories

| Category | Type | Action |
|---|---|---|
| `name` | HARD | Block — reject publish |
| `address` | HARD | Block |
| `email` | HARD | Block |
| `phone` | HARD | Block |
| `secret` | HARD | Block |
| `url` | SOFT | Auto-redact + flag |
| `date` | SOFT | Auto-redact + flag |

HARD -> call fails, user sees error. SOFT -> text scrubbed, proceeds.

### API

```ts
await privacyFilter.scrub(text, { source: 'free_text' })
// returns { clean: string, blocked: boolean, findings: Finding[] }
```

Backend probe order: WebGPU classifier → WASM → Ollama (`privacy-filter` model, dev/test only) → regex stub.

## Photo Privacy — On-Device CLIP

```
User uploads photo
  -> CLIP encode runs in-browser (WebGPU/WASM)
  -> 512-dim embedding extracted
  -> raw photo NEVER sent to server
  -> embedding used for pillar matching → [pillar library](/architecture/pillar-library.md)
```

Even embedding not stored server-side post-match; discarded after archetype resolution.

## Product Pillar Statement

> "Works offline after first load. Your child's face stays on your device."

Design choices that enforce this:
- No server-side photo upload endpoint exists
- CLIP model bundled/cached client-side
- `assertNoBannedReferences()` in [style packs](/architecture/style-packs.md) prevents named-person prompt leaks
- PII gate runs before any text reaches imagegen or book pipeline

## Relations

- Photo embedding flow → [pillar library](/architecture/pillar-library.md)
- PII scrub called before image gen prompts → [imagegen](/architecture/imagegen.md)
- Style pack banned-names guard complements PII gate → [style packs](/architecture/style-packs.md)
