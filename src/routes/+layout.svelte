<script lang="ts">
	import { page } from '$app/stores';
	let { children } = $props();
	const onExamples = $derived($page.url.pathname.startsWith('/examples'));
</script>

{#if !onExamples}
	<a class="examples-pill" href="/examples" aria-label="See example storybooks">📖 Examples</a>
{/if}

{@render children()}

<style>
	.examples-pill {
		position: fixed;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 1000;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: #ff8a5b;
		color: #fff;
		font-weight: 700;
		font-size: 0.95rem;
		text-decoration: none;
		box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
		transition: transform 0.12s ease, box-shadow 0.12s ease;
	}
	.examples-pill:hover {
		transform: translateY(-1px);
		box-shadow: 0 5px 14px rgba(0, 0, 0, 0.24);
	}
	@media (prefers-reduced-motion: reduce) {
		.examples-pill { transition: none; }
	}
</style>
