<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { STATION_ORDER, type StationId } from '$lib/workshop/types';

	export let current: StationId | null;

	const dispatch = createEventDispatcher<{ back: void }>();

	// Skip kid-picker + library in the dot row; only s1..s7 show as dots.
	const DOT_STATIONS: StationId[] = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

	$: idx = current ? STATION_ORDER.indexOf(current) : -1;
	$: canBack = idx > 0 && current !== 'kid-picker';
</script>

<nav class="progress">
	<button class="back" disabled={!canBack} on:click={() => dispatch('back')}>← Back</button>
	<ol>
		{#each DOT_STATIONS as s, i}
			<li class:active={current === s} class:done={current !== s && DOT_STATIONS.indexOf(current ?? 's1') > i}>
				<span class="dot" />
				<small>{i + 1}</small>
			</li>
		{/each}
	</ol>
</nav>

<style>
	.progress {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0;
	}
	.back {
		padding: 0.4rem 0.85rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		background: #fff;
		cursor: pointer;
	}
	.back:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	ol {
		display: flex;
		gap: 0.5rem;
		list-style: none;
		padding: 0;
		margin: 0;
		flex: 1;
		justify-content: center;
	}
	li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
	}
	.dot {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #ddd;
	}
	li.active .dot {
		background: #2a6;
		box-shadow: 0 0 0 3px rgba(42, 102, 33, 0.2);
	}
	li.done .dot {
		background: #8c8;
	}
	li small {
		font-size: 0.7rem;
		color: #888;
	}
</style>
