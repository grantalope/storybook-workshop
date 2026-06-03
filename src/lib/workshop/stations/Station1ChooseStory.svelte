<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import { currentOrchestrator } from '$lib/workshop/stores';
	import {
		LENGTH_TIER_SPREADS,
		type LengthTier,
	} from '$lib/workshop/types';
	import type { StoryOccasion, StoryTheme, EhriPhase } from '$lib/services/author/types';

	export let orchestrator: WorkshopOrchestrator;
	const dispatch = createEventDispatcher<{ advance: void }>();

	const THEMES: { id: StoryTheme; label: string; blurb: string }[] = [
		{ id: 'bedtime', label: 'Bedtime', blurb: 'A quiet wind-down' },
		{ id: 'first-day', label: 'First Day', blurb: 'School, new place, big feelings' },
		{ id: 'lost-and-found', label: 'Lost & Found', blurb: 'Wander → return home' },
		{ id: 'overcoming-fear', label: 'Brave', blurb: 'Face the thing' },
		{ id: 'new-baby-arrives', label: 'New Sibling', blurb: 'Welcoming someone little' },
		{ id: 'kindness', label: 'Kindness', blurb: 'Help quietly' },
		{ id: 'adventure', label: 'Adventure', blurb: 'A real quest' },
		{ id: 'curiosity', label: 'Curious', blurb: 'Why is the sky blue?' },
		{ id: 'friendship', label: 'Friendship', blurb: 'Together is better' },
		{ id: 'sibling-rivalry', label: 'Sibling', blurb: 'Brother + sister stuff' },
		{ id: 'saying-goodbye', label: 'Goodbye', blurb: 'Loss + love' },
		{ id: 'silly-quest', label: 'Silly Quest', blurb: 'Goofy and fun' },
	];

	const OCCASIONS: StoryOccasion[] = ['birthday', 'holiday', 'gift', 'just-because'];
	const LENGTHS: { tier: LengthTier; label: string }[] = [
		{ tier: 'bedtime', label: 'Bedtime (~8 spreads)' },
		{ tier: 'standard', label: 'Standard (~12 spreads)' },
		{ tier: 'adventure', label: 'Adventure (~16 spreads)' },
		{ tier: 'saga', label: 'Saga (~24 spreads)' },
	];
	const EHRI_PHASES: { id: EhriPhase; label: string }[] = [
		{ id: 'pre-alphabetic', label: 'Pre-letters (very young)' },
		{ id: 'partial-alphabetic', label: 'Knows some letters' },
		{ id: 'full-alphabetic', label: 'Reading short words' },
		{ id: 'consolidated-alphabetic', label: 'Reading sentences' },
	];

	let theme: StoryTheme = orchestrator.draft.outputs.s1?.theme ?? 'bedtime';
	let occasion: StoryOccasion = orchestrator.draft.outputs.s1?.occasion ?? 'just-because';
	let lengthTier: LengthTier = orchestrator.draft.outputs.s1?.lengthTier ?? 'standard';
	let ehriPhase: EhriPhase = orchestrator.draft.outputs.s1?.ehriPhase ?? 'partial-alphabetic';

	async function next() {
		await orchestrator.saveOutput('s1', {
			theme,
			occasion,
			lengthTier,
			targetSpreads: LENGTH_TIER_SPREADS[lengthTier],
			ehriPhase,
		});
		currentOrchestrator.set(orchestrator);
		dispatch('advance');
	}
</script>

<section class="station">
	<h2>Choose your story shape</h2>

	<h3>Theme</h3>
	<div class="grid">
		{#each THEMES as t (t.id)}
			<button
				class="card"
				class:selected={theme === t.id}
				on:click={() => (theme = t.id)}
			>
				<strong>{t.label}</strong>
				<small>{t.blurb}</small>
			</button>
		{/each}
	</div>

	<h3>Occasion</h3>
	<div class="chips">
		{#each OCCASIONS as o (o)}
			<button class="chip" class:selected={occasion === o} on:click={() => (occasion = o)}>
				{o}
			</button>
		{/each}
	</div>

	<h3>Length</h3>
	<div class="chips">
		{#each LENGTHS as l (l.tier)}
			<button
				class="chip"
				class:selected={lengthTier === l.tier}
				on:click={() => (lengthTier = l.tier)}
			>
				{l.label}
			</button>
		{/each}
	</div>

	<h3>Reading level (Ehri phase)</h3>
	<div class="chips">
		{#each EHRI_PHASES as p (p.id)}
			<button
				class="chip"
				class:selected={ehriPhase === p.id}
				on:click={() => (ehriPhase = p.id)}
			>
				{p.label}
			</button>
		{/each}
	</div>

	<button class="next" on:click={next}>Next →</button>
</section>

<style>
	.station h2 {
		margin-top: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.card {
		padding: 0.75rem;
		border: 2px solid #ddd;
		border-radius: 10px;
		background: #fff;
		text-align: left;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.card.selected,
	.chip.selected {
		border-color: #2a6;
		background: #e8f5ed;
	}
	.chips {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}
	.chip {
		padding: 0.5rem 0.85rem;
		border: 1px solid #ccc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
		text-transform: capitalize;
	}
	.next {
		display: block;
		margin: 2rem auto 0;
		padding: 0.75rem 2rem;
		background: #2a6;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		cursor: pointer;
	}
</style>
