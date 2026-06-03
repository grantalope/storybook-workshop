<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import { currentOrchestrator } from '$lib/workshop/stores';

	export let orchestrator: WorkshopOrchestrator;
	const dispatch = createEventDispatcher<{ advance: void }>();

	const TEMPLATES = [
		{ id: 'curious', text: 'I hope you stay as curious as you are right now.' },
		{ id: 'kind', text: 'Be kind to creatures big and small.' },
		{ id: 'brave', text: 'When you feel small, remember you have always been brave.' },
		{ id: 'silly', text: 'Never stop laughing your big silly laugh.' },
	];

	let tab: 'type' | 'template' = 'type';
	let dedicationText: string = orchestrator.draft.outputs.s3?.dedicationText ?? '';
	let templateId: string | undefined = orchestrator.draft.outputs.s3?.templateId;

	function pickTemplate(id: string, text: string) {
		templateId = id;
		dedicationText = text;
	}

	async function next() {
		if (!dedicationText.trim()) return;
		await orchestrator.saveOutput('s3', { dedicationText, templateId });
		currentOrchestrator.set(orchestrator);
		dispatch('advance');
	}
</script>

<section class="station">
	<h2>The wish moment</h2>
	<p>Write a one-line dedication. This is the only message in the book carrying your voice.</p>

	<div class="tabs">
		<button class:active={tab === 'type'} on:click={() => (tab = 'type')}>Type</button>
		<button class:active={tab === 'template'} on:click={() => (tab = 'template')}>Templates</button>
	</div>

	{#if tab === 'type'}
		<textarea
			bind:value={dedicationText}
			placeholder="To Eli — may the world always feel new."
			rows="4"
		/>
	{:else}
		<div class="templates">
			{#each TEMPLATES as t (t.id)}
				<button
					class="template"
					class:selected={templateId === t.id}
					on:click={() => pickTemplate(t.id, t.text)}
				>
					{t.text}
				</button>
			{/each}
		</div>
		{#if dedicationText}
			<p class="preview">Preview: <em>{dedicationText}</em></p>
		{/if}
	{/if}

	<button class="next" disabled={!dedicationText.trim()} on:click={next}>Next →</button>
</section>

<style>
	.tabs {
		display: flex;
		gap: 0.5rem;
		margin: 1rem 0;
	}
	.tabs button {
		padding: 0.5rem 1rem;
		background: #fff;
		border: 1px solid #ccc;
		border-radius: 6px;
		cursor: pointer;
	}
	.tabs button.active {
		background: #2a6;
		color: white;
		border-color: #2a6;
	}
	textarea {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		font-family: inherit;
		font-size: 1rem;
	}
	.templates {
		display: grid;
		gap: 0.5rem;
	}
	.template {
		text-align: left;
		padding: 0.75rem;
		background: #fff;
		border: 2px solid #ddd;
		border-radius: 8px;
		cursor: pointer;
	}
	.template.selected {
		border-color: #2a6;
		background: #e8f5ed;
	}
	.preview {
		margin-top: 1rem;
		padding: 0.75rem;
		background: #fafafa;
		border-radius: 6px;
		font-size: 0.95rem;
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
	.next:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
