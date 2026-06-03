<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';

	export let orchestrator: WorkshopOrchestrator;
	const dispatch = createEventDispatcher<{ done: void }>();

	let showPrintModal = false;
	let downloaded = false;

	const s6 = orchestrator.draft.outputs.s6;
	const shortcode = s6?.bookShortcode ?? 'unknown';

	function downloadDigital() {
		// Re-running the pipeline is wasteful; in MVP we re-emit a tiny
		// "this is your book" stub. Real flow keeps the AssembledBook from
		// Station 6 in a content-addressed cache keyed by shortcode + pdfHash.
		// For now: surface the shortcode + recommend running the print order
		// once the fulfillment goal lands.
		const text =
			`Your storybook shortcode: ${shortcode}\n` +
			`PDF size: ${(s6?.pdfBlobSize ?? 0) / 1024} KB\n` +
			`PDF hash: ${s6?.pdfHash}\n\n` +
			`The full digital PDF + ePub + read-along bundle is generated in Station 6.\n` +
			`Hook this CTA up to the AssembledBook cache once the in-memory transport ships.`;
		const blob = new Blob([text], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `storybook-${shortcode}.txt`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5_000);
		downloaded = true;
	}

	function done() {
		dispatch('done');
	}
</script>

<section class="station">
	<h2>Take it home</h2>

	<div class="cta-grid">
		<button class="cta digital" on:click={downloadDigital}>
			<h3>Get the free digital book</h3>
			<p>Instant PDF + ePub read-along.</p>
		</button>
		<button class="cta print" on:click={() => (showPrintModal = true)}>
			<h3>Order printed copy</h3>
			<p>Hardcover delivered to your door.</p>
		</button>
	</div>

	{#if downloaded}
		<p class="status">Your digital book is downloading. Share with grandparents using the shortcode above.</p>
	{/if}

	<div class="more">
		<button on:click={done}>Make another book →</button>
		<a href="/library">Visit your library</a>
	</div>

	{#if showPrintModal}
		<div class="modal-backdrop" on:click={() => (showPrintModal = false)}>
			<div class="modal" on:click|stopPropagation>
				<h3>Print orders are coming soon</h3>
				<p>
					The fulfillment service (Lulu Direct + shipping quote + Stripe) is wired in
					goal #8 of the master plan. The print CTA goes live the moment that goal merges
					— your draft + AssembledBook from Station 6 will already be cached.
				</p>
				<p>
					In the meantime, your free digital book has everything: PDF, ePub, animated
					read-along bundle.
				</p>
				<button on:click={() => (showPrintModal = false)}>Got it</button>
			</div>
		</div>
	{/if}
</section>

<style>
	.cta-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin: 1rem 0;
	}
	.cta {
		padding: 1.5rem;
		border-radius: 12px;
		border: 2px solid #ddd;
		background: #fff;
		cursor: pointer;
		text-align: center;
	}
	.cta.digital { border-color: #2a6; background: #e8f5ed; }
	.cta.print { border-color: #d4a017; background: #fff7d6; }
	.status {
		padding: 0.75rem;
		background: #e8f5ed;
		border-radius: 8px;
	}
	.more {
		display: flex;
		justify-content: space-between;
		margin-top: 1.5rem;
	}
	.more button {
		padding: 0.5rem 1rem;
		background: #2a6;
		color: white;
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}
	.more a {
		align-self: center;
		color: #2a6;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.modal {
		background: white;
		padding: 1.5rem;
		border-radius: 12px;
		max-width: 480px;
	}
	.modal button {
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: #2a6;
		color: white;
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}
</style>
