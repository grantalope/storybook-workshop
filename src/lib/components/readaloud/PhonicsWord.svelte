<script lang="ts">
	import type { GraphemeSegment } from '$lib/services/readaloud/types';

	let {
		word,
		segments,
		definitionKid = '',
		onSpeak
	}: {
		word: string;
		segments: GraphemeSegment[];
		definitionKid?: string;
		onSpeak?: (text: string) => void;
	} = $props();

	let open = $state(false);
</script>

<span class="phonics-word">
	<button type="button" class="word" aria-expanded={open} onclick={() => (open = !open)}>
		{word}
	</button>
	{#if open}
		<span class="popover" role="dialog" aria-label="{word} sound out">
			<span class="segments">
				{#each segments as segment, index (index)}
					<button
						type="button"
						class="chip"
						class:silent={segment.kind === 'silent'}
						class:joined={segment.kind === 'digraph' || segment.kind === 'vowel-team'}
						data-kind={segment.kind}
						onclick={() => onSpeak?.(segment.phoneme || segment.grapheme)}
					>
						<span>{segment.grapheme}</span>
						<small>{segment.phoneme || 'quiet'}</small>
					</button>
				{/each}
			</span>
			{#if definitionKid}
				<span class="definition">{definitionKid}</span>
			{/if}
		</span>
	{/if}
</span>

<style>
	.phonics-word {
		position: relative;
		display: inline-block;
	}
	.word {
		border: 0;
		border-bottom: 2px solid #2c7a7b;
		background: transparent;
		color: inherit;
		font: inherit;
		padding: 0 1px;
		cursor: pointer;
	}
	.popover {
		position: absolute;
		z-index: 5;
		left: 0;
		top: calc(100% + 6px);
		width: max-content;
		max-width: min(320px, 80vw);
		padding: 10px;
		border: 1px solid #c9d4df;
		border-radius: 8px;
		background: #ffffff;
		box-shadow: 0 10px 24px rgba(20, 32, 44, 0.18);
	}
	.segments {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		min-width: 42px;
		border: 1px solid #d4dde6;
		border-radius: 7px;
		background: #f7fbff;
		color: #172635;
		padding: 5px 7px;
		cursor: pointer;
	}
	.chip[data-kind='short-vowel'],
	.chip[data-kind='long-vowel'] {
		background: #fff4cf;
	}
	.chip[data-kind='digraph'],
	.chip[data-kind='vowel-team'] {
		background: #e8f7ef;
	}
	.chip.joined {
		border-bottom: 3px solid #1f8a5b;
	}
	.chip.silent {
		background: #edf0f2;
		color: #7c8790;
	}
	.chip span,
	.chip small {
		display: block;
		line-height: 1.1;
	}
	.chip small {
		margin-top: 2px;
		font-size: 0.72rem;
	}
	.definition {
		display: block;
		margin-top: 8px;
		color: #4b5563;
		font-size: 0.9rem;
	}
</style>
