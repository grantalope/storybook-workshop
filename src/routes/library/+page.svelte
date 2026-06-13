<script lang="ts">
	import { onMount } from 'svelte';
	import { getKidProfileStore } from '$lib/workshop/services/KidProfileStore';
	import { getWorkshopDraftStore } from '$lib/workshop/services/WorkshopDraftStore';
	import type { KidProfile, WorkshopDraft } from '$lib/workshop/types';

	let kids: KidProfile[] = [];
	let draftsByKid = new Map<string, WorkshopDraft[]>();
	let loading = true;

	async function refresh() {
		kids = await getKidProfileStore().list();
		const all = await getWorkshopDraftStore().listAll();
		const m = new Map<string, WorkshopDraft[]>();
		for (const d of all) {
			const list = m.get(d.kidId) ?? [];
			list.push(d);
			m.set(d.kidId, list);
		}
		draftsByKid = m;
	}

	onMount(async () => {
		await refresh();
		loading = false;
	});

	async function deleteKid(kid: KidProfile) {
		if (!confirm(`Delete ${kid.name} and all their books? This cannot be undone.`)) return;
		await getKidProfileStore().deleteKid(kid.kidId);
		await refresh();
	}

	async function deleteDraft(d: WorkshopDraft) {
		if (!confirm('Delete this draft?')) return;
		await getWorkshopDraftStore().delete(d.draftId);
		await refresh();
	}

	function fmtDate(ms: number): string {
		return new Date(ms).toLocaleDateString();
	}

	function statusOf(d: WorkshopDraft): string {
		if (d.outputs.s6) return 'Sealed';
		if (d.currentStation === 'kid-picker') return 'Just started';
		return `In flight — ${d.currentStation}`;
	}
</script>

<svelte:head><title>Your Library — Storybook Workshop</title></svelte:head>

<main class="library">
	<header>
		<a href="/" class="home">← Workshop</a>
		<h1>Your library</h1>
	</header>

	{#if loading}
		<p>Loading…</p>
	{:else if kids.length === 0}
		<p class="empty">
			No kids in your roster yet. <a href="/">Start a book</a> to add one.
		</p>
	{:else}
		{#each kids as kid (kid.kidId)}
			<section class="kid">
				<header>
					<h2>{kid.name}</h2>
					<small>{kid.ageBand}</small>
					<button class="delete-kid" on:click={() => deleteKid(kid)}>
						Delete kid & all books
					</button>
				</header>
				{#if (draftsByKid.get(kid.kidId) ?? []).length === 0}
					<p class="empty">No books yet. <a href="/">Make one →</a></p>
				{:else}
					<ul class="drafts">
						{#each draftsByKid.get(kid.kidId) ?? [] as d (d.draftId)}
							<li>
								<a href={`/?draftId=${d.draftId}`}>
									<strong>{d.outputs.s1?.theme ?? 'Untitled'}</strong>
									<small>{statusOf(d)}</small>
									<small>updated {fmtDate(d.updatedAt)}</small>
								</a>
								<button class="rm" on:click={() => deleteDraft(d)}>✕</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	{/if}
</main>

<style>
	.library {
		max-width: 960px;
		margin: 0 auto;
		padding: 2rem 1rem;
		font-family: system-ui, sans-serif;
	}
	.home {
		color: #2a6;
	}
	.kid {
		margin: 2rem 0;
		padding: 1rem;
		background: #fafafa;
		border-radius: 12px;
	}
	.kid header {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.delete-kid {
		margin-left: auto;
		padding: 0.4rem 0.85rem;
		background: #fff;
		border: 1px solid #b00;
		color: #b00;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.drafts {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.drafts li {
		display: flex;
		align-items: center;
		padding: 0.75rem;
		background: white;
		border: 1px solid #ddd;
		border-radius: 8px;
	}
	.drafts a {
		flex: 1;
		display: flex;
		flex-direction: column;
		text-decoration: none;
		color: inherit;
		gap: 0.15rem;
	}
	.rm {
		background: transparent;
		border: 0;
		color: #b00;
		cursor: pointer;
	}
	.empty {
		color: #777;
		font-style: italic;
	}
</style>
