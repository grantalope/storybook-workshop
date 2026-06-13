<script lang="ts">
	import { onMount } from 'svelte';
	import HeroBanner from '$lib/components/HeroBanner.svelte';
	import { getWorkshopDraftStore } from '$lib/workshop/services/WorkshopDraftStore';
	import { getKidProfileStore } from '$lib/workshop/services/KidProfileStore';
	import { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import { currentOrchestrator, currentStation, draftStore } from '$lib/workshop/stores';
	import KidPicker from '$lib/workshop/stations/KidPicker.svelte';
	import Station1ChooseStory from '$lib/workshop/stations/Station1ChooseStory.svelte';
	import Station2ForgeHero from '$lib/workshop/stations/Station2ForgeHero.svelte';
	import Station3WishMoment from '$lib/workshop/stations/Station3WishMoment.svelte';
	import Station4NameCast from '$lib/workshop/stations/Station4NameCast.svelte';
	import Station5DressStory from '$lib/workshop/stations/Station5DressStory.svelte';
	import Station6Seal from '$lib/workshop/stations/Station6Seal.svelte';
	import Station7TakeHome from '$lib/workshop/stations/Station7TakeHome.svelte';
	import StationProgress from '$lib/workshop/components/StationProgress.svelte';
	import SettlerHostBanner from '$lib/workshop/components/SettlerHostBanner.svelte';

	export let data: { draftId: string | null };

	let booting = true;
	let bootError = '';

	onMount(async () => {
		try {
			const draftStoreLocal = getWorkshopDraftStore();
			if (data.draftId) {
				const draft = await draftStoreLocal.get(data.draftId);
				if (draft) {
					currentOrchestrator.set(new WorkshopOrchestrator(draftStoreLocal, draft));
				} else {
					bootError = `Draft ${data.draftId} not found or expired.`;
				}
			}
		} catch (e) {
			bootError = (e as Error).message;
		} finally {
			booting = false;
		}
	});

	async function onKidChosen(ev: CustomEvent<{ kidId: string }>) {
		const ds = getWorkshopDraftStore();
		const draft = await ds.create({ kidId: ev.detail.kidId });
		const orch = new WorkshopOrchestrator(ds, draft);
		currentOrchestrator.set(orch);
		await orch.advance(); // kid-picker → s1
		currentOrchestrator.set(orch);
	}

	async function nav(direction: 'advance' | 'back') {
		const o = $currentOrchestrator;
		if (!o) return;
		try {
			if (direction === 'advance') await o.advance();
			else await o.back();
			currentOrchestrator.set(o);
		} catch (e) {
			alert((e as Error).message);
		}
	}
</script>

<svelte:head>
	<title>Storybook Workshop</title>
</svelte:head>

<HeroBanner />

<main class="workshop">
	{#if booting}
		<p class="boot">Loading workshop…</p>
	{:else if bootError}
		<p class="boot error">{bootError}</p>
	{:else if !$currentOrchestrator}
		<KidPicker on:chosen={onKidChosen} />
	{:else}
		<SettlerHostBanner station={$currentStation} />
		<StationProgress current={$currentStation} on:back={() => nav('back')} />

		{#if $currentStation === 's1'}
			<Station1ChooseStory orchestrator={$currentOrchestrator} on:advance={() => nav('advance')} />
		{:else if $currentStation === 's2'}
			<Station2ForgeHero orchestrator={$currentOrchestrator} on:advance={() => nav('advance')} />
		{:else if $currentStation === 's3'}
			<Station3WishMoment orchestrator={$currentOrchestrator} on:advance={() => nav('advance')} />
		{:else if $currentStation === 's4'}
			<Station4NameCast orchestrator={$currentOrchestrator} on:advance={() => nav('advance')} />
		{:else if $currentStation === 's5'}
			<Station5DressStory orchestrator={$currentOrchestrator} on:advance={() => nav('advance')} />
		{:else if $currentStation === 's6'}
			<Station6Seal orchestrator={$currentOrchestrator} on:advance={() => nav('advance')} />
		{:else if $currentStation === 's7'}
			<Station7TakeHome orchestrator={$currentOrchestrator} on:done={() => nav('advance')} />
		{:else if $currentStation === 'library'}
			<a class="lib-link" href="/library">Visit your library →</a>
		{/if}
	{/if}
</main>

<style>
	.workshop {
		max-width: 960px;
		margin: 0 auto;
		padding: 2rem 1rem;
		font-family: system-ui, sans-serif;
	}
	.boot {
		text-align: center;
		padding: 4rem;
		color: #666;
	}
	.boot.error {
		color: #b00;
	}
	.lib-link {
		display: block;
		text-align: center;
		padding: 2rem;
		color: #2a6;
	}
</style>
