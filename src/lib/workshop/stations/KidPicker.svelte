<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import { getKidProfileStore } from '$lib/workshop/services/KidProfileStore';
	import type { KidProfile } from '$lib/workshop/types';

	const dispatch = createEventDispatcher<{ chosen: { kidId: string } }>();

	let kids: KidProfile[] = [];
	let loading = true;
	let creating = false;
	let newName = '';
	let newBirthday = '';
	let newAbout = '';

	onMount(async () => {
		kids = await getKidProfileStore().list();
		loading = false;
	});

	async function createKid() {
		if (!newName.trim() || !newBirthday) return;
		const store = getKidProfileStore();
		const k = await store.create({
			name: newName,
			birthdayIso: newBirthday,
			oneLineAbout: newAbout,
		});
		kids = [...kids, k];
		creating = false;
		newName = '';
		newBirthday = '';
		newAbout = '';
		dispatch('chosen', { kidId: k.kidId });
	}

	function chooseKid(kidId: string) {
		dispatch('chosen', { kidId });
	}
</script>

<section class="kid-picker">
	<h1>Who's the hero today?</h1>
	{#if loading}
		<p>Loading roster…</p>
	{:else}
		<div class="grid">
			{#each kids as kid (kid.kidId)}
				<button class="kid-card" on:click={() => chooseKid(kid.kidId)}>
					<strong>{kid.name}</strong>
					<small>{kid.ageBand}</small>
					{#if kid.oneLineAbout}
						<em>{kid.oneLineAbout}</em>
					{/if}
				</button>
			{/each}
			<button class="kid-card add" on:click={() => (creating = true)}>+ New Hero</button>
		</div>

		{#if creating}
			<form class="new-kid" on:submit|preventDefault={createKid}>
				<label>
					Name
					<input bind:value={newName} required />
				</label>
				<label>
					Birthday
					<input type="date" bind:value={newBirthday} required />
				</label>
				<label>
					One line about them
					<input bind:value={newAbout} placeholder="loves trains" />
				</label>
				<button type="submit">Add hero</button>
				<button type="button" on:click={() => (creating = false)}>Cancel</button>
			</form>
		{/if}
	{/if}
</section>

<style>
	.kid-picker {
		text-align: center;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 1rem;
		margin-top: 1.5rem;
	}
	.kid-card {
		padding: 1rem;
		border: 2px solid #ddd;
		border-radius: 12px;
		background: #fff;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.kid-card.add {
		border-style: dashed;
		color: #2a6;
	}
	.new-kid {
		margin-top: 1.5rem;
		display: grid;
		gap: 0.75rem;
		text-align: left;
		max-width: 400px;
		margin-inline: auto;
	}
	.new-kid label {
		display: grid;
		gap: 0.25rem;
	}
	.new-kid input {
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 6px;
	}
</style>
