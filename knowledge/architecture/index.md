# Architecture

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
