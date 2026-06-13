---
type: Decision
title: Pure-JS Hashing and UUID for Non-Secure Contexts
description: SHA-256 and UUID generation degrade gracefully when running in a plain-HTTP (non-secure) context where crypto.subtle is unavailable.
tags: [crypto, uuid, sha256, non-secure-context, util]
timestamp: 2026-06-12T00:00:00Z
status: enforced
path: src/lib/util/
---

# Decision

Provide two utility modules that work across **both secure (HTTPS) and non-secure (HTTP)** browser contexts, and in Node:

- `src/lib/util/uuid.ts` — UUID v4 generation
- `src/lib/util/sha256.ts` — SHA-256 digest

# Why

The demo and local-dev server may be served over plain HTTP (e.g., `http://localhost:5173`). In a non-secure context:

- `crypto.randomUUID()` — **not available**
- `crypto.getRandomValues()` — **not available** (throws `SecurityError`)
- `crypto.subtle.digest()` — **not available**

Any code that unconditionally calls `crypto.subtle` or `crypto.randomUUID` will throw at runtime, breaking the app silently on the first UUID or hash operation.

# Implementation

## `src/lib/util/uuid.ts`

Fallback priority:

```
crypto.randomUUID()  →  crypto.getRandomValues()  →  Math.random()
```

The `Math.random()` path is explicitly not cryptographically secure but produces valid UUID v4 format strings sufficient for non-security-critical IDs (feed item keys, recipe IDs, etc.).

## `src/lib/util/sha256.ts`

Fallback priority:

```
crypto.subtle.digest('SHA-256', ...)  →  pure-JS FIPS-180-4 implementation
```

The pure-JS path produces **identical digests** to `crypto.subtle` — both conform to FIPS 180-4. This means content-addressed IDs generated in HTTP dev will match IDs generated in HTTPS production.

# Security Gate Note

The G7 security review recognizes `crypto.getRandomValues()` as an acceptable cryptographic fallback for UUID generation (as opposed to `Math.random()` which is the last resort). The gate does not block `getRandomValues`-based UUID generation.

# Alternative Rejected

**Require HTTPS unconditionally**: rejected because it breaks the local dev workflow (`pnpm dev` on HTTP) and the demo URL may not always have TLS provisioned at first launch.

**Node `crypto` module polyfill**: rejected because it bloats the browser bundle and introduces a polyfill maintenance burden. The pure-JS fallback is smaller and auditable.

# Related

- Any service that generates content-addressed IDs (RecipeSystem, IngredientPool, PredictionNFTService) should import from these utils, not call `crypto.*` directly.
