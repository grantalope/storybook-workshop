---
type: Service
title: KidProfileStore
description: IndexedDB-backed store for KidProfile records (name, birthday/ageBand, one-line-about) created at KidPicker.
tags: [storage, indexeddb, kid-profile]
timestamp: 2026-06-13T00:00:00Z
path: src/lib/workshop/services/KidProfileStore.ts
status: production
---

Persists `KidProfile` records to IndexedDB. A profile is created/selected at the KidPicker step of the [create flow](/architecture/create-flow.md) and unlocks Station 1. Fields: `id`, `name`, `birthdayIso` (derives `ageBand`), `oneLineAbout`. IDs use the secure-context-safe uuid helper (see [pure-JS hashing & uuid](/decisions/pure-js-hashing-and-uuid.md) — plain HTTP has no `crypto.randomUUID`). The kid `ageBand` feeds the reading-level gates in the [book pipeline](/architecture/book-pipeline.md).
