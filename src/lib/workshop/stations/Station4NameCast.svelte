<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import { currentOrchestrator } from '$lib/workshop/stores';
	import { getKidProfileStore } from '$lib/workshop/services/KidProfileStore';
	import type { LocaleBiome, SupportingCastEntry } from '$lib/services/author/types';

	export let orchestrator: WorkshopOrchestrator;
	const dispatch = createEventDispatcher<{ advance: void }>();

	// `name` is the story-internal display name — it flows into
	// Station4Output.sidekickName → StoryInput.sidekickName → PrivacyFilter
	// allowNames so the sidekick's name survives brief scrubs.
	const SIDEKICKS = [
		{ id: 'ada', label: 'Ada (curious)', name: 'Ada' },
		{ id: 'rumi', label: 'Rumi (gentle)', name: 'Rumi' },
		{ id: 'jules', label: 'Jules (silly)', name: 'Jules' },
		{ id: 'nico', label: 'Nico (brave)', name: 'Nico' },
	];

	const BIOMES: LocaleBiome[] = [
		'forest',
		'seaside',
		'mountain',
		'meadow',
		'farm',
		'urban',
		'snowfield',
		'imaginary',
	];

	let heroName = orchestrator.draft.outputs.s4?.heroName ?? '';
	let sidekickSettlerId = orchestrator.draft.outputs.s4?.sidekickSettlerId ?? '';
	let localeBiome: LocaleBiome = orchestrator.draft.outputs.s4?.localeBiome ?? 'forest';
	let castEntries: SupportingCastEntry[] = orchestrator.draft.outputs.s4?.supportingCast ?? [];
	let newCastName = '';
	let newCastRole = '';

	onMount(async () => {
		if (!heroName) {
			const kid = await getKidProfileStore().get(orchestrator.draft.kidId);
			if (kid) heroName = kid.name;
		}
	});

	function addCast() {
		if (!newCastName.trim() || !newCastRole.trim()) return;
		castEntries = [
			...castEntries,
			{
				id: `cast-${crypto.randomUUID().slice(0, 8)}`,
				role: `${newCastRole} (${newCastName})`,
				// Explicit name field — the ONLY cast-name source the privacy
				// allowlist consumes (role free-text is never parsed).
				name: newCastName.trim(),
			},
		];
		newCastName = '';
		newCastRole = '';
	}

	function removeCast(id: string) {
		castEntries = castEntries.filter((c) => c.id !== id);
	}

	async function next() {
		if (!heroName.trim() || !sidekickSettlerId) return;
		await orchestrator.saveOutput('s4', {
			heroName,
			sidekickSettlerId,
			sidekickName: SIDEKICKS.find((s) => s.id === sidekickSettlerId)?.name,
			supportingCast: castEntries,
			localeBiome,
		});
		currentOrchestrator.set(orchestrator);
		dispatch('advance');
	}
</script>

<section class="station">
	<h2>Name your cast</h2>

	<label class="field">
		Hero name
		<input bind:value={heroName} />
	</label>

	<label class="field">
		Sidekick settler
		<select bind:value={sidekickSettlerId}>
			<option value="" disabled>Pick a friend…</option>
			{#each SIDEKICKS as s (s.id)}
				<option value={s.id}>{s.label}</option>
			{/each}
		</select>
	</label>

	<label class="field">
		Where the story happens
		<select bind:value={localeBiome}>
			{#each BIOMES as b (b)}
				<option value={b}>{b}</option>
			{/each}
		</select>
	</label>

	<div class="field">
		<h3>Supporting cast (pets, siblings, friends)</h3>
		<ul>
			{#each castEntries as c (c.id)}
				<li>
					{c.role}
					<button class="rm" on:click={() => removeCast(c.id)}>✕</button>
				</li>
			{/each}
		</ul>
		<div class="cast-add">
			<input bind:value={newCastName} placeholder="Name (Otis)" />
			<input bind:value={newCastRole} placeholder="Role (dog, sister, friend)" />
			<button on:click={addCast}>+ Add</button>
		</div>
	</div>

	<button class="next" disabled={!heroName.trim() || !sidekickSettlerId} on:click={next}>
		Next →
	</button>
</section>

<style>
	.field {
		display: block;
		margin: 1rem 0;
	}
	.field input,
	.field select {
		display: block;
		width: 100%;
		padding: 0.5rem;
		font-size: 1rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		margin-top: 0.25rem;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		display: flex;
		justify-content: space-between;
		padding: 0.25rem 0;
	}
	.rm {
		background: transparent;
		border: 0;
		cursor: pointer;
		color: #b00;
	}
	.cast-add {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.cast-add input {
		flex: 1;
		min-width: 100px;
	}
	.next {
		display: block;
		margin: 1.5rem auto 0;
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
