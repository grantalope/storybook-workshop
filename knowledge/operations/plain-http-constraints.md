---
type: Concept
title: Plain HTTP Constraints (Non-Secure Context)
description: Tailscale demo runs plain HTTP — crypto.randomUUID and crypto.subtle are undefined; only getRandomValues available.
tags: [security, crypto, browser, http, constraints, bugs]
timestamp: 2026-06-13T00:00:00Z
affected_url: http://100.104.9.90:8790
---

# Plain HTTP Constraints

Demo at `http://100.104.9.90:8790` = plain HTTP on Tailscale IP = **non-secure browser context**.

This class of bug has already killed two features:
- **Create-flow broken**: `crypto.randomUUID()` -> `undefined` -> crash
- **Seal/book step broken**: `crypto.subtle` + `node:crypto` hashing -> `undefined` -> crash

## Secure-Context API Availability

| API | Plain HTTP | HTTPS |
|-----|-----------|-------|
| `crypto.getRandomValues(buf)` | ✅ Available | ✅ Available |
| `crypto.randomUUID()` | ❌ `undefined` | ✅ Available |
| `crypto.subtle.*` (digest, sign, etc.) | ❌ `undefined` | ✅ Available |
| `node:crypto` | ❌ Browser has no Node modules | N/A |

## Fix Pattern

Never call `crypto.randomUUID()` or `crypto.subtle` directly in browser code that runs on the demo. Use pure-JS fallbacks:

- `src/lib/util/uuid.ts` — UUID v4 via `getRandomValues` (works on plain HTTP)
- `src/lib/util/sha256.ts` — pure-JS SHA-256 (no `crypto.subtle`)

```typescript
// uuid.ts pattern
export function generateUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0,4).join(''),
    hex.slice(4,6).join(''),
    hex.slice(6,8).join(''),
    hex.slice(8,10).join(''),
    hex.slice(10,16).join(''),
  ].join('-');
}
```

## Detection

G7 security gate ([acceptance gates](/operations/acceptance-gates.md)) flags `Math.random()` in id/token/key context. But it does NOT automatically catch `crypto.randomUUID()` usage in non-secure contexts — that's a runtime failure, not a static pattern. Test by loading the create-flow on the actual demo URL.

## Rule

Any browser code that generates IDs, tokens, hashes, or signatures must use only:
1. `crypto.getRandomValues()` — for random bytes
2. Pure-JS hash impl (`src/lib/util/sha256.ts`) — for digests
3. Never `crypto.subtle`, `crypto.randomUUID()`, or `node:crypto` in browser paths

## Related

- [Pure-JS Hashing and UUID Decision](/decisions/pure-js-hashing-and-uuid.md)
- [Acceptance Gates](/operations/acceptance-gates.md)
- [Run the Demo](/operations/run-the-demo.md)
- [Playwright Gotchas](/operations/playwright-gotchas.md)
