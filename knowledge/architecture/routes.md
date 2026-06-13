---
type: Reference
title: Route Map
description: src/routes/ inventory with rendering mode (SSR vs client) and purpose of each route.
tags: [routes, sveltekit, ssr, client, navigation]
timestamp: 2026-06-13T00:00:00Z
---

# Routes Map

`src/routes/` inventory. Rendering mode matters for verification: `curl` shows SSR HTML; client-rendered routes return shell only (content in JS bundle).

## Route Table

| Route | Rendering | Purpose |
|---|---|---|
| `/` | **CLIENT** | 7-station workshop (`Station1` … `Station7TakeHome`) — full interactive book creation flow |
| `/examples` | **CLIENT** | Gallery of example books |
| `/examples/[id]` | **CLIENT** | Read-along reader: Web Speech API karaoke + tap-to-sound-out phonics |
| `/styles` | **SSR** | 15 art styles showcase |
| `/approach` | **SSR** | Science/pedagogy page |
| `/demo` | **SSR** | CLIP archetype matcher + gallery + FAQ + 17 tests |
| `/library` | SSR | User's saved books |
| `/gift` | SSR | Gift flow |
| `/series/[seriesId]` | SSR | Book series landing |
| `/r/[shortcode]` | SSR | Short-link redirect |
| Marketing routes (`/about`, `/pricing`, etc.) | SSR | Static marketing pages under `(marketing)/` route group |

## Rendering Mode Details

### Client-rendered (`load` runs in browser)
- `/` — station state machine, Stripe Elements, PDF preview all require browser APIs
- `/examples` + `/examples/[id]` — Web Speech API only available in browser; karaoke/phonics non-functional in SSR
- `curl https://host/` returns HTML shell + `<script>` tags, no book content

### SSR (`load` runs on server, HTML in initial response)
- `/styles`, `/approach`, `/demo` etc. — `curl` returns full rendered HTML
- Useful for: SEO verification, smoke-testing deploys without a browser

## Critical: src/app.html Title Rule

`src/app.html` **must NOT contain a hardcoded `<title>` tag**.

- Each route sets its own title via `<svelte:head><title>...</title></svelte:head>`
- Stray static title in `app.html` -> double `<title>` in DOM -> browser uses first one -> wrong title on all pages
- `app.html` should have `%sveltekit.head%` placeholder only; no `<title>` element

## Special Routes

### /demo
Hosts:
- CLIP-based archetype matcher (classifies user-uploaded image to art style)
- Book gallery
- FAQ section
- 17 automated tests (visible in `/demo` UI)

### /examples/[id] — Read-Along Reader
- Web Speech API drives word-by-word karaoke highlighting
- Tap-to-sound-out: click any word -> phonetic breakdown + audio
- Fully client-rendered; degrades gracefully when Web Speech unavailable

### /r/[shortcode] — Short Links
Redirect layer. `shortcode` maps to a full book/gift/series URL in DB.

## Related

- [Run the demo](/operations/run-the-demo.md) — how to start dev server + verify routes
- [Fulfillment order flow](/architecture/fulfillment-order.md) — Station7 checkout detail (lives at `/`)
- [Create flow architecture](/architecture/create-flow.md) — 7-station flow detail
