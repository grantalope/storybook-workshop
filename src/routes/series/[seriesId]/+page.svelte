<!--
	src/routes/storybook-workshop/series/[seriesId]/+page.svelte

	Series timeline view (per kid). Shows the 12 themed slots from the named
	series + their delivery status (delivered / pending / autopilot-draft).

	MVP: pulls from SeriesThemeRegistry; live subscription state is stubbed
	(no persistent store yet).
-->
<script lang="ts">
	import { page } from '$app/stores';
	import {
		getSeries,
		type SeriesTheme
	} from '$lib/services/subscription';

	const seriesId = $derived($page.params.seriesId);
	const series = $derived<SeriesTheme | undefined>(getSeries(seriesId));
</script>

<svelte:head>
	<title>{series?.name ?? 'Series'} — Storybook Workshop</title>
</svelte:head>

<main class="series-page">
	{#if !series}
		<h1>Series not found</h1>
		<p>No series with id <code>{seriesId}</code>.</p>
	{:else}
		<header>
			<h1>{series.name}</h1>
			<p>{series.description}</p>
		</header>
		<ol class="theme-timeline">
			{#each series.themes as themeId, i (themeId)}
				<li>
					<span class="slot-number">Book {i + 1}</span>
					<span class="theme-id">{themeId}</span>
				</li>
			{/each}
		</ol>
	{/if}
</main>

<style>
	.series-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem;
	}
	header {
		margin-bottom: 2rem;
	}
	.theme-timeline {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.theme-timeline li {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: #fff8f0;
		border-left: 4px solid #1a73e8;
		border-radius: 4px;
	}
	.slot-number {
		font-weight: bold;
		min-width: 4rem;
	}
	.theme-id {
		font-family: monospace;
		color: #555;
	}
</style>
