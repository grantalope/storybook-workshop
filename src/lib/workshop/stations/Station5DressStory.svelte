<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { listStylePacks } from '$lib/services/stylepacks';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import { currentOrchestrator } from '$lib/workshop/stores';
	import type { ArtStyle, StyleSelectionId } from '$lib/workshop/types';

	export let orchestrator: WorkshopOrchestrator;
	const dispatch = createEventDispatcher<{ advance: void }>();

	const STYLE_PACKS = listStylePacks();
	const STYLE_PREVIEW: Record<ArtStyle, { label: string; blurb: string; gradient: string }> = {
		'octopath-hd2d': {
			label: 'Octopath HD-2D',
			blurb: 'Real 3D buildings, lit sprites, tilt-shift bloom',
			gradient: 'linear-gradient(135deg, #fde68a, #f59e0b 60%, #92400e)',
		},
		'flat-painted': {
			label: 'Flat painted',
			blurb: 'Soft watercolor, no postFX — quiet bedtime feel',
			gradient: 'linear-gradient(135deg, #fce7f3, #93c5fd 60%, #1e3a8a)',
		},
		'pixel-pure': {
			label: 'Pixel pure',
			blurb: 'Hard-edge 32-bit, retro arcade vibe',
			gradient: 'linear-gradient(135deg, #d1fae5, #10b981 60%, #064e3b)',
		},
	};

	let artStyle: StyleSelectionId = orchestrator.draft.outputs.s5?.artStyle ?? 'octopath-hd2d';
	let authorByline = orchestrator.draft.outputs.s5?.authorByline ?? '';
	let easierReadingMode = orchestrator.draft.outputs.s5?.easierReadingMode ?? false;
	let dialogicPromptsEnabled = orchestrator.draft.outputs.s5?.dialogicPromptsEnabled ?? true;

	function legacyPreview(id: string) {
		return STYLE_PREVIEW[id as ArtStyle];
	}

	async function next() {
		await orchestrator.saveOutput('s5', {
			artStyle,
			authorByline: authorByline.trim() || undefined,
			easierReadingMode,
			dialogicPromptsEnabled,
		});
		currentOrchestrator.set(orchestrator);
		dispatch('advance');
	}
</script>

<section class="station">
	<h2>Dress your story</h2>

	<h3>Art style</h3>
	<div class="grid">
		{#each STYLE_PACKS as pack (pack.id)}
			<button
				class="style"
				class:selected={artStyle === pack.id}
				on:click={() => (artStyle = pack.id)}
				style:--g={legacyPreview(pack.id)?.gradient}
				title={pack.educationalCard?.kidExplainer ?? legacyPreview(pack.id)?.blurb}
			>
				{#if pack.promptRecipe}
					<div class="palette" aria-hidden="true">
						{#each pack.promptRecipe.palette as color}
							<span class="swatch" style:background={color}></span>
						{/each}
					</div>
				{:else}
					<div class="preview" />
				{/if}
				<strong>{pack.displayName}</strong>
				<small>{pack.educationalCard?.kidExplainer ?? legacyPreview(pack.id)?.blurb}</small>
			</button>
		{/each}
	</div>

	<h3>Extras</h3>
	<label class="check">
		<input type="checkbox" bind:checked={dialogicPromptsEnabled} />
		Dialogic prompts in the margins (recommended)
	</label>
	<label class="check">
		<input type="checkbox" bind:checked={easierReadingMode} />
		Easier-reading mode (larger sans-serif, more leading)
	</label>
	<label class="field">
		Author byline (optional)
		<input bind:value={authorByline} placeholder="By Eli, age 5" />
	</label>

	<button class="next" on:click={next}>Next →</button>
</section>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.style {
		padding: 0.5rem;
		background: #fff;
		border: 2px solid #ddd;
		border-radius: 8px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		text-align: center;
	}
	.style.selected {
		border-color: #2a6;
		background: #e8f5ed;
	}
	.preview {
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 6px;
		background: var(--g);
	}
	.palette {
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 6px;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		overflow: hidden;
		border: 1px solid #e5e5e5;
	}
	.swatch {
		min-width: 0;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0;
	}
	.field {
		display: block;
		margin: 1rem 0;
	}
	.field input {
		display: block;
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		margin-top: 0.25rem;
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
</style>
