---
type: Service
title: WorkshopDraftStore
description: IndexedDB-backed store for the in-progress WorkshopDraft (per-station outputs s1..s7) with a 30-day TTL.
tags: [storage, indexeddb, draft]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/workshop/services/WorkshopDraftStore.ts
status: production
---

Persists the `WorkshopDraft` (kidId + `outputs.sN` per-station data + currentStation) to IndexedDB so the [create flow](/architecture/create-flow.md) survives reloads. `update(key, value)` is called by `WorkshopOrchestrator.saveOutput`. Draft IDs use the secure-context-safe uuid helper ([pure-JS hashing & uuid](/decisions/pure-js-hashing-and-uuid.md)). TTL `DRAFT_TTL_MS` = 30 days. NOTE: the generated book blobs (PDF/ePub) are NOT persisted here — they live in `generatedBookStore` for the Station 6 -> 7 handoff only.
