<script lang="ts">
	import type { DialogicPrompt } from '$lib/services/author/types';

	let { prompt }: { prompt: DialogicPrompt } = $props();
</script>

<aside class="dialogic-bubble" data-type={prompt.type}>
	<p>{prompt.text}</p>
	{#if prompt.peerFollowup}
		<small>{prompt.peerFollowup}</small>
	{/if}
</aside>

<style>
	.dialogic-bubble {
		margin: 12px 0 0;
		padding: 10px 12px;
		border-left: 4px solid #2f855a;
		border-radius: 8px;
		background: #eef8f1;
		color: #1f3f2d;
	}
	p {
		margin: 0;
		font-weight: 700;
	}
	small {
		display: block;
		margin-top: 4px;
		color: #486654;
	}
</style>
