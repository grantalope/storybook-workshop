<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	// Types
	interface Beat {
		beat: string;
		sceneTreeRole: string;
		storyText: string;
		pageTurnHook?: string;
	}

	interface Book {
		title: string;
		ageBand: string;
		artStyle: string;
		refrain: string;
		beats: Beat[];
	}

	interface ReaderPage {
		type: 'cover' | 'beat';
		imageSrc: string;
		beat?: Beat;
	}

	// State
	let book = $state<Book | null>(null);
	let pageIndex = $state<number>(0);
	let speaking = $state<boolean>(false);
	let wordIndex = $state<number>(-1);
	let voices = $state<SpeechSynthesisVoice[]>([]);
	let chosenVoiceURI = $state<string>('');
	let loading = $state<boolean>(true);
	let error = $state<string | null>(null);
	let selectedWord = $state<string | null>(null);
	let selectedWordChunks = $state<string[]>([]);
	let tooltipEl = $state<HTMLDivElement | null>(null);

	// Derived
	const bookId = $derived<string>($page.params.id ?? '');
	const pages = $derived<ReaderPage[]>(book ? [
		{
			type: 'cover',
			imageSrc: `/pillar-library-v2/example-books/${bookId}/cover.jpg`
		},
		...book.beats.map((beat: Beat): ReaderPage => ({
			type: 'beat',
			imageSrc: `/pillar-library-v2/example-books/${bookId}/spread-${beat.sceneTreeRole}.jpg`,
			beat
		}))
	] : []);
	const currentPage = $derived<ReaderPage | undefined>(pages[pageIndex]);
	const currentBeat = $derived<Beat | undefined>(currentPage?.type === 'beat' ? currentPage.beat : undefined);
	const isFirstPage = $derived<boolean>(pageIndex === 0);
	const isLastPage = $derived<boolean>(pageIndex === pages.length - 1);
	const totalPages = $derived<number>(pages.length);

	// Helpers
	function getPhonicsChunks(word: string): string[] {
		const chunks = word.match(/[^aeiou]*[aeiou]+(?:[^aeiou]*$)?/gi);
		return chunks || [word];
	}

	function getWordAtCharIndex(text: string, charIndex: number): number {
		const words = text.split(/\s+/);
		let currentPos = 0;
		let wordIdx = 0;
		for (let i = 0; i < words.length; i++) {
			const word = words[i];
			const wordStart = currentPos;
			const wordEnd = currentPos + word.length;
			if (charIndex >= wordStart && charIndex < wordEnd) {
				wordIdx = i;
				break;
			}
			currentPos = wordEnd + 1; // +1 for space
		}
		return wordIdx;
	}

	function getWords(text: string): string[] {
		return text.split(/\s+/).filter(w => w.length > 0);
	}

	// Speech
	function getSelectedVoice(): SpeechSynthesisVoice | undefined {
		return voices.find(v => v.voiceURI === chosenVoiceURI);
	}

	async function speak(text: string, rate: number = 0.9): Promise<void> {
		if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

		const utterance = new SpeechSynthesisUtterance(text);
		const voice = getSelectedVoice();
		if (voice) {
			utterance.voice = voice;
		}
		utterance.rate = rate;

		return new Promise<void>((resolve) => {
			utterance.onend = () => resolve();
			window.speechSynthesis.speak(utterance);
		});
	}

	function speakStory(): void {
		if (!currentBeat || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

		speaking = true;
		wordIndex = -1;

		const utterance = new SpeechSynthesisUtterance(currentBeat.storyText);
		const voice = getSelectedVoice();
		if (voice) {
			utterance.voice = voice;
		}
		utterance.rate = 0.9;

		let textOffset = 0;

		utterance.onboundary = (event: SpeechSynthesisEvent) => {
			if (event.name === 'word' || event.name === 'sentence') {
				const charIndex = event.charIndex;
				wordIndex = getWordAtCharIndex(currentBeat!.storyText, charIndex);
			}
		};

		utterance.onend = () => {
			wordIndex = -1;
			speaking = false;
		};

		utterance.onerror = () => {
			wordIndex = -1;
			speaking = false;
		};

		window.speechSynthesis.speak(utterance);
	}

	function stopSpeaking(): void {
		if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
		window.speechSynthesis.cancel();
		speaking = false;
		wordIndex = -1;
	}

	function speakWord(word: string, event: MouseEvent): void {
		event.stopPropagation();
		if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

		// Stop any ongoing speech
		window.speechSynthesis.cancel();

		selectedWord = word;
		selectedWordChunks = getPhonicsChunks(word.toLowerCase());

		const utterance = new SpeechSynthesisUtterance(word);
		const voice = getSelectedVoice();
		if (voice) {
			utterance.voice = voice;
		}
		utterance.rate = 0.6;

		window.speechSynthesis.speak(utterance);
	}

	function closeTooltip(): void {
		selectedWord = null;
		selectedWordChunks = [];
	}

	function handlePageClick(event: MouseEvent): void {
		// Close tooltip when clicking elsewhere
		if (tooltipEl && !tooltipEl.contains(event.target as Node)) {
			closeTooltip();
		}
	}

	// Navigation
	function goToPage(index: number): void {
		stopSpeaking();
		closeTooltip();
		pageIndex = index;
	}

	function goNext(): void {
		if (!isLastPage) {
			goToPage(pageIndex + 1);
		}
	}

	function goPrev(): void {
		if (!isFirstPage) {
			goToPage(pageIndex - 1);
		}
	}

	// Image error handling
	function handleImageError(event: Event): void {
		const img = event.target as HTMLImageElement;
		img.style.display = 'none';
	}

	// Lifecycle
	onMount(() => {
		const loadVoices = (): void => {
			const availableVoices = window.speechSynthesis.getVoices();
			voices = availableVoices;
			if (availableVoices.length > 0 && !chosenVoiceURI) {
				const enVoice = availableVoices.find(v => v.lang.startsWith('en'));
				chosenVoiceURI = enVoice ? enVoice.voiceURI : availableVoices[0].voiceURI;
			}
		};

		if ('speechSynthesis' in window) {
			loadVoices();
			window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
		}

	});

	// Fetch book data
	$effect(() => {
		const fetchBook = async (): Promise<void> => {
			try {
				const response = await fetch(`/pillar-library-v2/example-books/${bookId}/story.json`);
				if (!response.ok) {
					throw new Error(`Failed to fetch: ${response.status}`);
				}
				const data: Book = await response.json();
				book = data;
			} catch (err) {
				error = err instanceof Error ? err.message : 'Unknown error';
			} finally {
				loading = false;
			}
		};

		fetchBook();
	});
</script>

<svelte:window onclick={handlePageClick} />

<div class="reader" role="main" aria-label="Storybook reader">
	<!-- Header -->
	<header class="reader-header">
		<a href="/examples" class="back-link" aria-label="Back to all examples">
			<span class="back-arrow">⬅</span>
			<span class="back-text">All examples</span>
		</a>
		{#if voices.length > 0}
			<div class="voice-picker">
				<label for="voice-select">Narrator voice</label>
				<select id="voice-select" bind:value={chosenVoiceURI}>
					{#each voices as voice (voice.voiceURI)}
						<option value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
					{/each}
				</select>
			</div>
		{/if}
	</header>

	{#if loading}
		<div class="loading" role="status" aria-live="polite">
			<p>Loading your story...</p>
		</div>
	{:else if error}
		<div class="error" role="alert">
			<p>Unable to load story: {error}</p>
			<a href="/examples">Return to examples</a>
		</div>
	{:else if book && currentPage}
		<div class="book-stage">
			<!-- Image area -->
			<div class="image-container">
				{#if currentPage.type === 'cover'}
					<img
						src={currentPage.imageSrc}
						alt={`Cover of ${book.title}`}
						class="spread-image"
						onerror={handleImageError}
					/>
				{:else}
					<img
						src={currentPage.imageSrc}
						alt={`Illustration for ${currentBeat?.beat || 'scene'}`}
						class="spread-image"
						onerror={handleImageError}
					/>
				{/if}
			</div>

			<!-- Text panel -->
			<div class="text-panel">
				{#if currentPage.type === 'cover'}
					<div class="cover-content">
						<h1 class="book-title">{book.title}</h1>
						<p class="age-band">Ages {book.ageBand}</p>
						<p class="art-style">{book.artStyle}</p>
						<button
							class="start-button"
							onclick={() => goToPage(1)}
							aria-label="Start reading"
						>
							Start reading
						</button>
					</div>
				{:else if currentBeat}
					<div class="beat-content">
						<!-- Karaoke text -->
						<div class="story-text" aria-live="polite">
							{#each getWords(currentBeat.storyText) as word, idx (idx)}
								<span
									class="word-span"
									class:karaoke-active={idx === wordIndex}
									class:word-clickable={!speaking}
									onclick={(e) => speakWord(word, e)}
									role="button"
									tabindex="0"
									aria-label={`Word: ${word}`}
									onkeydown={(e) => e.key === 'Enter' && speakWord(word, e as unknown as MouseEvent)}
								>
									{word}
									{#if selectedWord === word}
										<div class="tooltip" bind:this={tooltipEl} role="tooltip">
											<span class="tooltip-text">{selectedWordChunks.join('·')}</span>
										</div>
									{/if}
								</span>
								{' '}
							{/each}
						</div>

						<!-- Read aloud controls -->
						<div class="audio-controls">
							{#if !speaking}
								<button
									class="audio-button play-button"
									onclick={speakStory}
									aria-label="Read aloud"
									disabled={!('speechSynthesis' in window)}
								>
									▶ Read aloud
								</button>
							{:else}
								<button
									class="audio-button pause-button"
									onclick={stopSpeaking}
									aria-label="Stop reading"
								>
									⏸ Stop
								</button>
							{/if}
						</div>

						<!-- Dialogic prompt -->
						{#if currentBeat.pageTurnHook}
							<div class="page-turn-hook" role="note">
								<span class="hook-icon">?</span>
								<div class="hook-body">
									<span class="hook-label" title="A talk-about-it question — dialogic reading (Whitehurst). Research-backed: builds vocabulary + comprehension.">Dialogic prompt</span>
									<p class="hook-text">Turn the page... {currentBeat.pageTurnHook}</p>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Navigation -->
			<nav class="page-nav" aria-label="Page navigation">
				<button
					class="nav-button"
					onclick={goPrev}
					disabled={isFirstPage}
					aria-label="Previous page"
				>
					Prev
				</button>

				<span class="page-counter" aria-live="polite">
					Page {pageIndex + 1} of {totalPages}
				</span>

				{#if isLastPage}
					<a href="/examples" class="nav-button end-button" aria-label="Read another story">
						The End ✦ Read another
					</a>
				{:else}
					<button
						class="nav-button"
						onclick={goNext}
						disabled={isLastPage}
						aria-label="Next page"
					>
						Next
					</button>
				{/if}
			</nav>
		</div>
	{/if}
</div>

<style>
	/* Reset and base */
	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		font-family: 'Georgia', 'Times New Roman', serif;
		background: #fef9f3;
		color: #3d2b1f;
	}

	/* Reader container */
	.reader {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* Header */
	.reader-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: #fff8f0;
		border-bottom: 2px solid #e8d5c4;
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		color: #8b6914;
		font-size: 0.95rem;
		font-weight: 600;
		padding: 0.5rem;
		border-radius: 0.5rem;
		transition: background 0.2s ease;
	}

	.back-link:hover {
		background: #f5e6d3;
	}

	.back-arrow {
		font-size: 1.1rem;
	}

	.voice-picker {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.voice-picker label {
		font-size: 0.85rem;
		font-weight: 600;
		color: #6b5b4f;
	}

	.voice-picker select {
		padding: 0.4rem 0.6rem;
		border-radius: 0.5rem;
		border: 2px solid #d4c4b0;
		background: #fff;
		font-size: 0.85rem;
		color: #3d2b1f;
		cursor: pointer;
		max-width: 250px;
	}

	/* Loading and error */
	.loading, .error {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		text-align: center;
	}

	.loading p {
		font-size: 1.25rem;
		color: #8b6914;
	}

	.error p {
		font-size: 1.1rem;
		color: #c45c3e;
		margin-bottom: 1rem;
	}

	.error a {
		color: #8b6914;
		font-weight: 600;
	}

	/* Book stage */
	.book-stage {
		flex: 1;
		display: flex;
		flex-direction: column;
		max-width: 800px;
		margin: 0 auto;
		width: 100%;
		padding: 1rem;
		gap: 1rem;
	}

	/* Image */
	.image-container {
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 1rem;
		overflow: hidden;
		background: #e8d5c4;
		box-shadow: 0 4px 12px rgba(61, 43, 31, 0.1);
	}

	.spread-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	/* Text panel */
	.text-panel {
		background: #fff8f0;
		border-radius: 1rem;
		padding: 1.5rem;
		box-shadow: 0 2px 8px rgba(61, 43, 31, 0.08);
	}

	/* Cover content */
	.cover-content {
		text-align: center;
	}

	.book-title {
		font-size: 2rem;
		font-weight: 700;
		color: #5a3d2b;
		margin: 0 0 0.75rem;
		line-height: 1.2;
	}

	.age-band {
		font-size: 1.1rem;
		color: #8b6914;
		font-weight: 600;
		margin: 0 0 0.25rem;
	}

	.art-style {
		font-size: 0.95rem;
		color: #a09080;
		margin: 0 0 1.5rem;
		font-style: italic;
	}

	.start-button {
		display: inline-block;
		padding: 0.875rem 2rem;
		font-size: 1.15rem;
		font-weight: 700;
		color: #fff;
		background: #c9a227;
		border: none;
		border-radius: 0.75rem;
		cursor: pointer;
		transition: transform 0.15s ease, background 0.2s ease;
	}

	.start-button:hover {
		background: #b8921f;
		transform: translateY(-2px);
	}

	.start-button:active {
		transform: translateY(0);
	}

	/* Beat content */
	.beat-content {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.story-text {
		font-size: 1.25rem;
		line-height: 1.8;
		color: #3d2b1f;
	}

	.word-span {
		display: inline-block;
		position: relative;
		padding: 0.1rem 0.05rem;
		border-radius: 0.25rem;
		transition: background 0.15s ease;
	}

	.word-clickable {
		cursor: pointer;
	}

	.word-clickable:hover {
		background: #f5e6d3;
	}

	.karaoke-active {
		background: #ffe066;
		color: #5a3d2b;
		font-weight: 600;
	}

	/* Tooltip */
	.tooltip {
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translateX(-50%);
		margin-bottom: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: #5a3d2b;
		color: #fff8f0;
		border-radius: 0.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		white-space: nowrap;
		z-index: 10;
	}

	.tooltip::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 6px solid transparent;
		border-top-color: #5a3d2b;
	}

	.tooltip-text {
		font-family: 'Courier New', monospace;
		letter-spacing: 0.05em;
	}

	/* Audio controls */
	.audio-controls {
		display: flex;
		justify-content: center;
	}

	.audio-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.25rem;
		font-size: 1rem;
		font-weight: 600;
		border: none;
		border-radius: 0.625rem;
		cursor: pointer;
		transition: transform 0.15s ease, background 0.2s ease;
	}

	.play-button {
		background: #4a9e5c;
		color: #fff;
	}

	.play-button:hover {
		background: #3d8a4e;
		transform: translateY(-2px);
	}

	.pause-button {
		background: #c45c3e;
		color: #fff;
	}

	.pause-button:hover {
		background: #a94d33;
		transform: translateY(-2px);
	}

	.audio-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Page turn hook */
	.page-turn-hook {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		background: #f0e6f5;
		border-radius: 0.75rem;
		border-left: 4px solid #9b7cb6;
	}

	.hook-icon {
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #9b7cb6;
		color: #fff;
		border-radius: 50%;
		font-size: 1.1rem;
		font-weight: 700;
	}

	.hook-text {
		margin: 0;
		font-size: 1rem;
		color: #5a4a6a;
		line-height: 1.5;
		font-style: italic;
	}

	/* Navigation */
	.page-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0;
		flex-wrap: wrap;
	}

	.nav-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.625rem 1.25rem;
		font-size: 0.95rem;
		font-weight: 600;
		color: #5a3d2b;
		background: #f5e6d3;
		border: 2px solid #d4c4b0;
		border-radius: 0.625rem;
		cursor: pointer;
		text-decoration: none;
		transition: background 0.2s ease, transform 0.15s ease;
		min-height: 2.75rem;
	}

	.nav-button:hover:not(:disabled) {
		background: #e8d5c4;
		transform: translateY(-2px);
	}

	.nav-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		transform: none;
	}

	.end-button {
		background: #c9a227;
		color: #fff;
		border-color: #b8921f;
	}

	.end-button:hover {
		background: #b8921f;
	}

	.page-counter {
		font-size: 0.9rem;
		font-weight: 600;
		color: #8b6914;
	}

	/* Reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.start-button,
		.audio-button,
		.nav-button,
		.word-span {
			transition: none !important;
			transform: none !important;
		}
	}

	/* Mobile adjustments */
	@media (max-width: 600px) {
		.reader-header {
			padding: 0.5rem;
		}

		.book-title {
			font-size: 1.5rem;
		}

		.story-text {
			font-size: 1.1rem;
		}

		.text-panel {
			padding: 1rem;
		}

		.page-nav {
			gap: 0.5rem;
		}

		.nav-button {
			padding: 0.5rem 0.875rem;
			font-size: 0.9rem;
		}

		.voice-picker select {
			max-width: 180px;
			font-size: 0.8rem;
		}
	}

	.hook-body { display: flex; flex-direction: column; gap: 0.2rem; }
	.hook-label { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #5b8def; cursor: help; }
</style>
