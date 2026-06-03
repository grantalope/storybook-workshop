<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import { currentOrchestrator } from '$lib/workshop/stores';
	import {
		runWorkshopPipeline,
		type PipelineProgress,
		type PipelineResult,
	} from '$lib/workshop/services/WorkshopBookPipeline';
	import type { ConsentRecord } from '$lib/workshop/types';
	import ConsentGate from '$lib/workshop/components/ConsentGate.svelte';

	export let orchestrator: WorkshopOrchestrator;
	const dispatch = createEventDispatcher<{ advance: void }>();

	let progress: PipelineProgress | null = null;
	let result: PipelineResult | null = null;
	let runError = '';
	let running = false;

	let reviewedSpreads = false;
	let understandsNonRefundable = false;

	$: consentReady = reviewedSpreads && understandsNonRefundable;
	$: canSeal = !!result && consentReady && !running;

	onMount(() => {
		// Resume affordance: if we re-enter Station 6 and the draft already has s6,
		// surface a "rerun pipeline" CTA instead of auto-running.
		const prior = orchestrator.draft.outputs.s6;
		if (prior) {
			reviewedSpreads = prior.consent.reviewedSpreads;
			understandsNonRefundable = prior.consent.understandsNonRefundable;
		} else {
			runPipeline();
		}
	});

	async function runPipeline() {
		running = true;
		runError = '';
		progress = null;
		try {
			result = await runWorkshopPipeline(orchestrator.draft, {
				onProgress: (p) => (progress = p),
			});
		} catch (e) {
			runError = (e as Error).message;
		} finally {
			running = false;
		}
	}

	async function sealAndAdvance() {
		if (!result || !consentReady) return;
		const consent: ConsentRecord = {
			reviewedSpreads,
			understandsNonRefundable,
			pdfHash: result.pdfHash,
			timestampMs: Date.now(),
		};
		await orchestrator.saveOutput('s6', {
			bookShortcode: result.book.shortcode,
			pdfBlobSize: result.book.pdfBlob.size,
			pdfHash: result.pdfHash,
			consent,
		});
		currentOrchestrator.set(orchestrator);
		dispatch('advance');
	}
</script>

<section class="station">
	<h2>The seal</h2>

	{#if running}
		<div class="status">
			<p><strong>{progress?.message ?? 'Starting…'}</strong></p>
			<div class="spinner" />
		</div>
	{:else if runError}
		<div class="error">
			<p>{runError}</p>
			<button on:click={runPipeline}>Retry</button>
		</div>
	{:else if result}
		<div class="seal-card">
			<h3>{result.tree.title}</h3>
			<p class="blurb">{result.tree.back_cover_blurb}</p>
			<dl>
				<dt>Pages</dt><dd>{result.pageCount}</dd>
				<dt>Shortcode</dt><dd>{result.book.shortcode}</dd>
				<dt>PDF size</dt><dd>{(result.book.pdfBlob.size / 1024).toFixed(1)} KB</dd>
				<dt>PDF hash</dt><dd class="hash">{result.pdfHash.slice(0, 16)}…</dd>
			</dl>
		</div>

		<details class="redo">
			<summary>Want to redo something?</summary>
			<button on:click={runPipeline}>Reroll the whole story</button>
			<p class="note">Per-scene + style swap + pillar swap affordances ship with the HD-2D adapter.</p>
		</details>

		<ConsentGate
			bind:reviewedSpreads
			bind:understandsNonRefundable
			disabled={running}
		/>

		<button class="next" disabled={!canSeal} on:click={sealAndAdvance}>
			Seal it & take it home →
		</button>
	{/if}
</section>

<style>
	.status {
		text-align: center;
		padding: 2rem;
	}
	.spinner {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: 4px solid #ccc;
		border-top-color: #2a6;
		margin: 1rem auto;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.seal-card {
		padding: 1.5rem;
		background: linear-gradient(135deg, #fff7d6, #fde68a);
		border: 3px solid #d4a017;
		border-radius: 12px;
	}
	.seal-card h3 {
		margin: 0;
	}
	.blurb {
		font-style: italic;
		margin: 0.5rem 0 1rem;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
		margin: 0;
	}
	dt { font-weight: 600; }
	dd { margin: 0; }
	.hash { font-family: monospace; font-size: 0.85em; }
	.error {
		padding: 1rem;
		background: #ffe6e6;
		border: 1px solid #b00;
		border-radius: 8px;
	}
	.redo {
		margin: 1rem 0;
		padding: 0.75rem;
		background: #fafafa;
		border-radius: 6px;
	}
	.redo button {
		padding: 0.5rem 1rem;
		background: #fff;
		border: 1px solid #ccc;
		border-radius: 6px;
		cursor: pointer;
		margin-top: 0.5rem;
	}
	.note {
		font-size: 0.85rem;
		color: #666;
	}
	.next {
		display: block;
		margin: 1.5rem auto 0;
		padding: 0.85rem 2rem;
		background: #2a6;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 1.05rem;
		cursor: pointer;
	}
	.next:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
