---
type: Decision
title: No Ollama in Browser (Production Inference = In-App Only)
description: Production inference runs in-browser via WebGPU->WASM->stub chain; Ollama is hard-blocked in shipped/browser builds.
tags: [inference, ollama, webgpu, production, security]
timestamp: 2026-06-12T00:00:00Z
status: enforced
---

# Decision

Production inference is **in-browser / in-app only**. The fallback chain is:

```
WebGPU (LLR runtime) → WASM → stub
```

The Ollama hop (`localhost:11434`) is **hard-blocked in any browser context**.

# Why

When a user runs the app from a remote demo URL, `localhost:11434` resolves to the **user's own machine**, not the server. This means:

- The user would need Ollama installed and running locally — an unreasonable assumption.
- In the worst case, a pre-existing local Ollama instance belonging to the user would silently serve requests, leaking prompt context to an unintended endpoint.
- Privacy guarantee breaks: the product's privacy-by-default story depends on inference staying inside the browser sandbox.

# Implementation

**File**: `src/lib/llr/index.ts`

Ollama provider is rejected synchronously when `window` is defined:

```ts
if (provider.name === 'ollama' && typeof window !== 'undefined') {
  throw new Error(
    '[LLR] Ollama provider is disabled in browser contexts. ' +
    'Production inference uses WebGPU->WASM->stub chain only.'
  );
}
```

This fires at provider-selection time, before any network call is attempted.

# Alternative Rejected

**Runtime URL check** (fail on fetch, not on init): rejected because it produces a silent latency penalty and confusing error messages rather than an immediate, auditable failure at configuration time.

**Feature flag** to toggle Ollama in browser: rejected because any flag that can be flipped in a shipped build is a liability. The block must be unconditional in browser contexts.

# Ollama Stays as Dev / CI Failsafe

Ollama remains the legitimate fallback in **Node environments** (vitest, CI, agent batch scripts, headless Playwright) where `window` is undefined. The [PrivacyFilterService](/architecture/privacy.md) and embedding services follow the same probe order:

```
WebGPU backend → WASM backend → Ollama backend (Node only) → stub
```

See also the kernel inference migration notes in CLAUDE.md §Browser-OS Kernel for the full `kernel.connect('inference.generate')` path that supersedes direct LLR imports in post-Stage-17 production builds.
