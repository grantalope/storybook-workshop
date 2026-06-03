<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let reviewedSpreads: boolean = false;
	export let understandsNonRefundable: boolean = false;
	export let disabled = false;

	const dispatch = createEventDispatcher<{
		change: { reviewedSpreads: boolean; understandsNonRefundable: boolean };
	}>();

	$: dispatch('change', { reviewedSpreads, understandsNonRefundable });
	$: ready = reviewedSpreads && understandsNonRefundable && !disabled;
</script>

<section class="gate" class:ready>
	<h3>Before we take it home</h3>
	<label>
		<input type="checkbox" bind:checked={reviewedSpreads} {disabled} />
		I've reviewed every spread.
	</label>
	<label>
		<input type="checkbox" bind:checked={understandsNonRefundable} {disabled} />
		I understand this is a personalized print — I can't return it for taste reasons.
	</label>
	<p class="note">
		Both boxes are required to move to Station 7. Your settler host is happy to wait.
	</p>
</section>

<style>
	.gate {
		margin-top: 1.5rem;
		padding: 1rem;
		background: #fff9e6;
		border: 2px solid #f5c518;
		border-radius: 12px;
	}
	.gate.ready {
		background: #e8f5ed;
		border-color: #2a6;
	}
	label {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.35rem 0;
	}
	.note {
		font-size: 0.85rem;
		color: #555;
		margin-top: 0.5rem;
	}
</style>
