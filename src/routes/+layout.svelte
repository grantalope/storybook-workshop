<script lang="ts">
	import { page } from '$app/stores';
	let { children } = $props();
	const path = $derived($page.url.pathname);
	const onExamples = $derived(path.startsWith('/examples'));
	const onApproach = $derived(path.startsWith('/approach'));
	const onStyles = $derived(path.startsWith('/styles'));
</script>

<nav class="corner-pills" aria-label="Quick links">
	{#if !onExamples}
		<a class="pill examples" href="/examples" aria-label="See example storybooks">📖 Examples</a>
	{/if}
	{#if !onApproach}
		<a class="pill science" href="/approach" aria-label="The science behind it">🔬 The Science</a>
	{/if}
	{#if !onStyles}
		<a class="pill styles" href="/styles" aria-label="See the art styles">🎨 Art Styles</a>
	{/if}
</nav>

<div class="app-content">
	{@render children()}
</div>

<style>
	.corner-pills {
		position: fixed;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 1000;
		display: flex;
		gap: 0.5rem;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		color: #fff;
		font-weight: 700;
		font-size: 0.9rem;
		text-decoration: none;
		box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
		transition: transform 0.12s ease, box-shadow 0.12s ease;
	}
	.pill.examples { background: #ff8a5b; }
	.pill.science { background: #5b8def; }
	.pill.styles { background: #b5651d; }
	.pill:hover {
		transform: translateY(-1px);
		box-shadow: 0 5px 14px rgba(0, 0, 0, 0.24);
	}
	@media (prefers-reduced-motion: reduce) {
		.pill { transition: none; }
	}
	@media (max-width: 480px) {
		.pill { font-size: 0.78rem; padding: 0.4rem 0.7rem; }
	}

	.app-content { padding-top: 0; }
	@media (max-width: 600px) {
		/* clear the fixed top-right nav pills so page headings are not occluded */
		.app-content { padding-top: 3rem; }
	}
</style>
