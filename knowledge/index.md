---
okf_version: "0.1"
title: Storybook Workshop — Knowledge Bundle
description: The agent-maintained digital brain for the storybook-workshop project (architecture, runbook, decisions).
---

This bundle is the source of truth for the **storybook-workshop** project: a KidPicker + 7-station wizardry for personalized children's picture books. The bundle documents the end-to-end architecture (create flow, book pipeline, services), operational runbooks (demo deployment, acceptance gates, Playwright patterns), design decisions (privacy, inference, auth), the Loss-Function Development methodology, and references on reading science and the OKF format itself.

**Read this bundle before deriving anything.** Update entries inline as the product evolves. The manifest and cross-links keep the brain coherent across sessions.

## Architecture

* [Workshop Create Flow (7-Station UX)](/architecture/create-flow.md) - The "New Hero" wizard — KidPicker then 7 ordered stations that collect all inputs needed to generate a personalised picture book.
* [WorkshopBookPipeline](/architecture/book-pipeline.md) - Orchestrates Station-6 generation — story authoring, scene rendering, and PDF/ePub assembly — from a completed WorkshopDraft.
* [StoryAuthorService](/architecture/story-author.md) - Orchestrates story generation — Tier-2 vocab planning, budget allocation, gated LLM loop with salvage, grammar/calibration/quality gates, and deterministic template fallback.
* [InferenceClient / LLR Shim](/architecture/inference-llr.md) - Canonical inference facade for the storybook-workshop standalone — wraps the kernel.connect path (no-op here) with LLR fallback that routes to the active StoryLLM provider (Ollama or Anthropic). Embedding is a stub. Ollama blocked in browser per policy.
* [Style Packs](/architecture/style-packs.md) - 15 curated art-history and legacy style packs that inject prompt recipes into image generation requests, surfaced at /styles and Station 5.
* [Image Generation](/architecture/imagegen.md) - Provider-switching image generation layer: mock (default/CI), local ComfyUI on the 4090, or cloud via fal.ai.
* [Pillar Library](/architecture/pillar-library.md) - 150 kid hero archetypes with CLIP embeddings; matched to a child's photo on-device for privacy-safe hero personalization.
* [Privacy](/architecture/privacy.md) - Privacy-by-default pillar: PII gate blocks HARD categories, CLIP embedding keeps photos on-device, no raw user data uploaded.
* [Fulfillment & Order Flow](/architecture/fulfillment-order.md) - Station7TakeHome.svelte multi-phase checkout: shipping quote -> order creation -> Stripe payment -> confirmation.
* [Route Map](/architecture/routes.md) - src/routes/ inventory with rendering mode (SSR vs client) and purpose of each route.

## Operations

* [Run the Demo Server](/operations/run-the-demo.md) - Build and restart the live demo at http://100.104.9.90:8790 from the storybook-workshop worktree.
* [Acceptance Gates](/operations/acceptance-gates.md) - 11-gate CI suite run via node scripts/gates/run-all.mjs; must pass before any demo deploy.
* [Playwright MCP Gotchas](/operations/playwright-gotchas.md) - Known flakiness patterns and workarounds for driving the storybook demo via Playwright MCP.
* [Plain HTTP Constraints (Non-Secure Context)](/operations/plain-http-constraints.md) - Tailscale demo runs plain HTTP — crypto.randomUUID and crypto.subtle are undefined; only getRandomValues available.

## Decisions

* [No Ollama in Browser (Production Inference = In-App Only)](/decisions/no-ollama-in-browser.md) - Production inference runs in-browser via WebGPU->WASM->stub chain; Ollama is hard-blocked in shipped/browser builds.
* [Pure-JS Hashing and UUID for Non-Secure Contexts](/decisions/pure-js-hashing-and-uuid.md) - SHA-256 and UUID generation degrade gracefully when running in a plain-HTTP (non-secure) context where crypto.subtle is unavailable.
* [Svelte 5 Runes — All Rendered Mutable State Must Be $state()](/decisions/svelte5-runes-reactivity.md) - In a Svelte 5 runes component, plain `let` is NOT reactive; any mutable value that drives the DOM must be declared with $state().
* [Demo Auth Bypass via STORYBOOK_DEV_BYPASS_AUTH](/decisions/demo-auth-bypass.md) - The demo has no login UI; order APIs accept the request body email when the bypass env var is set, with a hard production guard.
* [Never Use git add -A — Stage Explicit Paths Only](/decisions/git-add-A-hazard.md) - git add -A captured working-tree deletions into a commit, silently deleting src/routes/demo/+page.svelte and 17 tests. Explicit path staging is now mandatory.

## Loss-Function Development

* [Loss-Function Development (LFD)](/lfd/loss-function-development.md) - A methodology for descending toward a blind target scored by an instrument the agent cannot fake, rather than spec-compliance or self-reported quality.

## References

* [Science of Reading — Pedagogy Baked Into the Product](/references/science-of-reading.md) - The evidence-based reading science that informs the product's instructional design: orthographic mapping, systematic synthetic phonics, dialogic reading, Scarborough's Reading Rope, and Ehri's phases.
* [Open Knowledge Format (OKF) v0.1 — Specification](/references/okf-spec.md) - What this bundle is — Google's Open Knowledge Format for interlinked markdown concept files that form a machine-readable and human-readable digital brain.
