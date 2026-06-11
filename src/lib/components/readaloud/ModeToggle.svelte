<script lang="ts">
	type ReadAloudMode = 'listen' | 'read' | 'phonics' | 'quiz';

	let {
		mode,
		availableModes,
		onChange
	}: {
		mode: ReadAloudMode;
		availableModes: ReadAloudMode[];
		onChange: (mode: ReadAloudMode) => void;
	} = $props();

	const labels: Record<ReadAloudMode, string> = {
		listen: 'Listen',
		read: 'Read-along',
		phonics: 'Phonics',
		quiz: 'Quiz'
	};
</script>

<div class="mode-toggle" role="tablist" aria-label="Read-aloud mode">
	{#each availableModes as item (item)}
		<button
			type="button"
			role="tab"
			aria-selected={mode === item}
			class:active={mode === item}
			onclick={() => onChange(item)}
		>
			{labels[item]}
		</button>
	{/each}
</div>

<style>
	.mode-toggle {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 6px;
		margin: 0 0 18px;
	}
	button {
		min-height: 40px;
		border: 1px solid #c9d4df;
		border-radius: 8px;
		background: #ffffff;
		color: #22313f;
		font-weight: 700;
		cursor: pointer;
	}
	button.active {
		background: #204d74;
		border-color: #204d74;
		color: #ffffff;
	}
</style>
