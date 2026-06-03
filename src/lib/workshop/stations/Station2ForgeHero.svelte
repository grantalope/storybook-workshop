<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import { currentOrchestrator } from '$lib/workshop/stores';
	import {
		fetchManifest,
		getCachedManifestSource,
		type Pillar,
		type PillarManifestSource,
	} from '$lib/services';

	export let orchestrator: WorkshopOrchestrator;
	const dispatch = createEventDispatcher<{ advance: void }>();

	// Pillar grid is populated from PillarManifestClient. Fallback chain
	// (primary → placeholder static → empty) is owned by the client; this
	// component only consumes the resolved array. Each tile shows the
	// pillar's preview asset URL via the manifest entry's per-pillar
	// `urls.preview` mapping (which we keep alongside the typed Pillar
	// shape on a parallel placeholder index — `urls` is dropped by
	// parseManifest, so we re-read the raw entries for asset paths).

	type PillarTile = Pillar & { previewUrl: string | null };

	let pillars: PillarTile[] = [];
	let source: PillarManifestSource | null = null;
	let loading = true;
	let loadError: string | null = null;
	let selected: string | null =
		orchestrator.draft.outputs.s2?.pillarId ?? null;

	// Hardcoded fallback tiles for the "library completely unavailable" UX.
	// 8 gradient swatches keep Station 2 usable even when both primary and
	// placeholder are down.
	const GRADIENT_TILES = Array.from({ length: 8 }, (_, i) => ({
		id: `pillar-mvp-${i + 1}`,
		hue: (i * 360) / 8,
	}));

	onMount(async () => {
		try {
			const arr = await fetchManifest();
			source = getCachedManifestSource();
			// Read placeholder URLs (only present on the placeholder static
			// shape — primary WB upstream historically omits `urls`).
			// We re-fetch the raw JSON only for the placeholder source so
			// we can paint preview thumbnails; for primary upstream we
			// fall back to a gradient swatch keyed by axes.
			const rawUrls = await _readPreviewUrlsIfPlaceholder(source);
			pillars = arr.map((p) => ({
				...p,
				previewUrl: rawUrls.get(p.pillarId) ?? null,
			}));
		} catch (err) {
			loadError = (err as Error).message ?? String(err);
		} finally {
			loading = false;
		}
	});

	async function _readPreviewUrlsIfPlaceholder(
		src: PillarManifestSource | null,
	): Promise<Map<number, string>> {
		const map = new Map<number, string>();
		if (src !== 'placeholder') return map;
		try {
			const res = await fetch('/pillar-library-v1-placeholder/manifest.json');
			if (!res.ok) return map;
			const arr = (await res.json()) as Array<{
				pillarId: number;
				urls?: Record<string, string>;
			}>;
			for (const e of arr) {
				if (typeof e.pillarId === 'number' && e.urls?.preview) {
					map.set(e.pillarId, e.urls.preview);
				}
			}
		} catch {
			/* no-op — leave map empty */
		}
		return map;
	}

	function gradientHueFor(pillar: Pillar): number {
		// stable gradient hue from pillarId so tiles look distinct even
		// when the preview image is unavailable.
		return (pillar.pillarId * 137) % 360;
	}

	function pillarLabel(p: Pillar): string {
		return `${p.axes.ageBand} · ${p.axes.hair} · ${p.axes.skinTone} · ${p.axes.clothingVibe}`;
	}

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
		{#if source === 'primary'}
			Pick an archetype from the live World Builder pillar library.
		{:else if source === 'placeholder'}
			Pick an archetype below. (Showing the v1 placeholder library — the
			real Pixal3D-baked roster lands soon.)
		{:else if loading}
			Loading pillar library…
		{:else}
			Pillar library unavailable. Showing fallback archetypes — every tile
			still drives the full downstream render pipeline.
		{/if}
	</p>

	{#if loading}
		<p class="loading">Loading…</p>
	{:else if pillars.length > 0}
		<div class="grid" data-test-id="pillar-grid" data-test-source={source}>
			{#each pillars as p (p.pillarId)}
				<button
					class="pillar"
					class:selected={selected === String(p.pillarId)}
					style="--hue: {gradientHueFor(p)}"
					title={pillarLabel(p)}
					aria-label={pillarLabel(p)}
					on:click={() => (selected = String(p.pillarId))}
				>
					{#if p.previewUrl}
						<img src={p.previewUrl} alt="" width="80" height="80" />
					{:else}
						<div class="swatch"></div>
					{/if}
					<small>#{p.pillarId}</small>
				</button>
			{/each}
		</div>
	{:else}
		<div class="grid" data-test-id="pillar-grid-fallback">
			{#each GRADIENT_TILES as t (t.id)}
				<button
					class="pillar"
					class:selected={selected === t.id}
					style="--hue: {t.hue}"
					on:click={() => (selected = t.id)}
				>
					<div class="swatch"></div>
					<small>{t.id}</small>
				</button>
			{/each}
		</div>
	{/if}

	{#if loadError}
		<p class="error">Pillar library error: {loadError}</p>
	{/if}

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
	.loading {
		color: #888;
		text-align: center;
		font-style: italic;
	}
	.error {
		background: #fde0e0;
		color: #802020;
		padding: 0.5rem;
		border-radius: 6px;
		font-size: 0.85rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 0.75rem;
		margin: 1.5rem 0;
		max-height: 520px;
		overflow-y: auto;
		padding: 0.25rem;
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
	.pillar img {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		object-fit: cover;
		background: #f4f4f4;
	}
	.swatch {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		background: conic-gradient(
			from 0deg,
			hsl(var(--hue), 70%, 60%),
			hsl(calc(var(--hue) + 60), 70%, 60%)
		);
	}
	.pillar small {
		font-family: monospace;
		font-size: 0.7rem;
		color: #555;
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
