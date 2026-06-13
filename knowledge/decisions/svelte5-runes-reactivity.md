---
type: Decision
title: Svelte 5 Runes — All Rendered Mutable State Must Be $state()
description: In a Svelte 5 runes component, plain `let` is NOT reactive; any mutable value that drives the DOM must be declared with $state().
tags: [svelte5, runes, reactivity, bug, ui]
timestamp: 2026-06-12T00:00:00Z
status: enforced
---

# Decision

In any Svelte 5 component that opts into the **runes API** (`$props`, `$state`, `$derived`, `$effect`), a plain `let` declaration is **not reactive**. Updates to a plain `let` variable do not schedule a DOM re-render.

**Rule**: Every piece of mutable state that is read in the template MUST be declared as `$state(...)`.

```svelte
<script>
  // WRONG — template reads phase but updates are invisible
  let phase = 'idle';

  // CORRECT
  let phase = $state('idle');
</script>
```

# Why This Rule Exists (Station7 Bug)

In the Station7 print flow, the component had:

```svelte
<script>
  let phase = 'idle';       // plain let
  let errorMsg = '';        // plain let

  async function startOrder() {
    phase = 'loading';      // update NOT propagated to DOM
    ...
    phase = 'success';
  }
</script>

{#if phase === 'loading'}<Spinner />{/if}
<button on:click={startOrder}>Print</button>
```

Result: the Print CTA appeared dead — clicking it ran the async function but the spinner and success states never rendered. The bug was invisible to TypeScript and to vitest (which tests logic, not rendering). It only surfaced in a real browser.

**Fix**: change both `let phase` and `let errorMsg` to `$state(...)`. One-line diff, immediately fixed the CTA.

# Why Svelte 5 Behaves This Way

Svelte 5's runes mode is an **explicit reactivity system**. Unlike Svelte 4 (where the compiler tracked any top-level `let` assignment as reactive), runes require you to declare intent. `$state()` wraps the value in a reactive signal; plain `let` is just a JavaScript variable with no tracking.

This is intentional: it makes reactivity auditable and avoids implicit surprises, but it means the Svelte 4 mental model is actively wrong in runes components.

# Checklist for New Components

- [ ] Does the component use `$props`? If yes, it's a runes component — every mutable template value needs `$state`.
- [ ] Are there any `let foo = ...` declarations that are reassigned in event handlers or async functions? Convert to `$state`.
- [ ] Are there derived values? Use `$derived(...)`, not a plain `let` with manual recalculation.
- [ ] Side effects that depend on state? Use `$effect(...)`, not reactive statements (`$:`).

# Alternative Rejected

**Lint rule to ban plain `let` in runes components**: considered, but too broad — not all `let` variables are rendered (loop counters, intermediate values). A targeted ESLint rule that flags `let` variables read in JSX/template expressions would be valuable but hasn't been authored yet.
