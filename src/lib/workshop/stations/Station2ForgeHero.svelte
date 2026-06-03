<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import { currentOrchestrator } from '$lib/workshop/stores';

	export let orchestrator: WorkshopOrchestrator;
	const dispatch = createEventDispatcher<{ advance: void }>();

	// MVP: skip photo path entirely. 8 hardcoded placeholder pillars with
	// deterministic gradient colors. Real CLIP + pillar library land in the
	// pillar-library-pixal3d goal.
	const PILLARS = Array.from({ length: 8 }, (_, i) => ({
		id: `pillar-mvp-${i + 1}`,
		hue: (i * 360) / 8,
	}));

	let selected: string | null = orchestrator.draft.outputs.s2?.pillarId ?? null;

	async function next() {
		if (!selected) return;
		await orchestrator.saveOutput('s2', { pillarId: selected });
		currentOrchestrator.set(orchestrator);
		dispatch('advance');
	}
</script>

<section class="station">
	<h2>Forge your hero</h2>
	<p class="note">
		Photo + on-device CLIP match coming with the HD-2D pillar library. For now,
		pick a placeholder archetype below — every tile drives a fully working downstream
		render pipeline.
	</p>

	<div class="grid">
		{#each PILLARS as p (p.id)}
			<button
				class="pillar"
				class:selected={selected === p.id}
				style="--hue: {p.hue}"
				on:click={() => (selected = p.id)}
			>
				<div class="swatch" />
				<small>{p.id}</small>
			</button>
		{/each}
	</div>

	<button class="next" disabled={!selected} on:click={next}>Next →</button>
</section>

<style>
	.note {
		background: #fff7d6;
		padding: 0.75rem;
		border-radius: 8px;
		font-size: 0.9rem;
		color: #555;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.75rem;
		margin: 1.5rem 0;
	}
	.pillar {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: center;
		padding: 0.5rem;
		background: #fff;
		border: 2px solid #ddd;
		border-radius: 10px;
		cursor: pointer;
	}
	.pillar.selected {
		border-color: #2a6;
		background: #e8f5ed;
	}
	.swatch {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		background: conic-gradient(from 0deg, hsl(var(--hue), 70%, 60%), hsl(calc(var(--hue) + 60), 70%, 60%));
	}
	.next {
		display: block;
		margin: 1rem auto 0;
		padding: 0.75rem 2rem;
		background: #2a6;
		color: white;
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}
	.next:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
