<!--
src/routes/(marketing)/+layout.svelte

Per-group layout for marketing-funnel pages (landing /marketing, research,
privacy, public read-along /r/<shortcode>). Intentionally distinct from
the workshop's root layout so:

  - Phase-B extraction to a standalone marketing app is a folder move,
    not a refactor (per goal section 11).
  - The workshop checkout flow (Station 6/7) does NOT inherit marketing
    typography / nav.
  - Public landing pages can use a lighter SSR-friendly shell.

ssr is enabled here (unlike +page.ts in the workshop root) — public
marketing pages should be crawlable + index-able.
-->
<script lang="ts">
	const { children } = $props<{ children?: import('svelte').Snippet }>();
</script>

<div class="marketing-shell">
	{#if children}
		{@render children()}
	{/if}
</div>

<style>
	.marketing-shell {
		min-height: 100vh;
		background: #fafaf9;
		color: #1f1d1a;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	}
</style>
