<script lang="ts">
	import PhonicsWord from './PhonicsWord.svelte';
	import type { GraphemeSegment, PhonicsMap, Tier2Annotation, WordTiming } from '$lib/services/readaloud/types';

	type ReadAloudMode = 'listen' | 'read' | 'phonics' | 'quiz';
	const TOKEN_RE = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*|\s+|[^\s\p{L}\p{N}]+/gu;

	interface Token {
		text: string;
		kind: 'word' | 'space';
		charStart: number;
		charEnd: number;
		wordIndex: number;
		normalized: string;
		tier2?: Tier2Annotation;
		segments?: GraphemeSegment[];
	}

	let {
		text,
		mode,
		activeWordIndex = -1,
		wordTimings = [],
		phonicsMap = {},
		tier2Annotations = [],
		onWordSpeak,
		onTier2
	}: {
		text: string;
		mode: ReadAloudMode;
		activeWordIndex?: number;
		wordTimings?: WordTiming[];
		phonicsMap?: PhonicsMap;
		tier2Annotations?: Tier2Annotation[];
		onWordSpeak?: (word: string) => void;
		onTier2?: (annotation: Tier2Annotation) => void;
	} = $props();

	const tokens: Token[] = $derived.by(() => tokenize(text, tier2Annotations, phonicsMap, wordTimings));

	function tokenize(
		value: string,
		annotations: Tier2Annotation[],
		map: PhonicsMap,
		timings: WordTiming[]
	): Token[] {
		const timingByStart = new Map(timings.map((timing, index) => [timing.charStart, index]));
		let wordIndex = 0;
		return Array.from(value.matchAll(TOKEN_RE)).map((match) => {
			const tokenText = match[0];
			const charStart = match.index ?? 0;
			const charEnd = charStart + tokenText.length;
			const normalized = tokenText.toLocaleLowerCase('en-US');
			const isWord = /^[\p{L}\p{N}]/u.test(tokenText);
			const timedIndex = timingByStart.get(charStart);
			const currentWordIndex = isWord ? (timedIndex ?? wordIndex++) : -1;
			const tier2 = annotations.find(
				(annotation) =>
					annotation.charStart === charStart ||
					annotation.word.toLocaleLowerCase('en-US') === normalized
			);
			return {
				text: tokenText,
				kind: isWord ? 'word' : 'space',
				charStart,
				charEnd,
				wordIndex: currentWordIndex,
				normalized,
				tier2,
				segments: map[normalized]
			};
		});
	}
</script>

<p class="karaoke-text" data-mode={mode}>
	{#each tokens as token, index (index)}
		{#if token.kind === 'space'}
			{token.text}
		{:else if mode === 'phonics' && token.segments}
			<PhonicsWord
				word={token.text}
				segments={token.segments}
				definitionKid={token.tier2?.definitionKid}
				onSpeak={onWordSpeak}
			/>
		{:else}
			<button
				type="button"
				class="word"
				class:active={token.wordIndex === activeWordIndex}
				class:tier2={!!token.tier2}
				onclick={() => (token.tier2 ? onTier2?.(token.tier2) : onWordSpeak?.(token.text))}
			>
				{token.text}
			</button>
		{/if}
	{/each}
</p>

<style>
	.karaoke-text {
		margin: 0;
		font-size: 1.12rem;
		line-height: 1.85;
	}
	.word {
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		padding: 0 2px;
		cursor: pointer;
	}
	.word.active {
		background: #ffe082;
		box-shadow: 0 0 0 2px #ffe082;
	}
	.word.tier2 {
		text-decoration-line: underline;
		text-decoration-style: wavy;
		text-decoration-color: #7b61ff;
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
	}
</style>
