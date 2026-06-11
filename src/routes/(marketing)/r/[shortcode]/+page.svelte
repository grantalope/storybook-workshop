<!--
src/routes/r/[shortcode]/+page.svelte

Public read-along route per spec §8.1 / §8.8.

Fetches `/api/book/[shortcode]` (book-assembler subsystem). When the API
returns the truncated body (first 4 spreads + emailGateRequired: true), we
render the gate form. On submit, POST to /api/marketing/email-gate which
sets the swEmailGate_<shortcode> cookie. Browser reloads — the next GET
shows the full book.

Also wires the public click-tracking surface: if URL has ?ref=<shortcode>,
we hit /api/marketing/referral/[shortcode] to register the click.

This page is intentionally minimal — the upstream BookSpreadCanvas
component owns the read-along animation. We just gate it.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { getStylePack } from '$lib/services/stylepacks';
	import ModeToggle from '$lib/components/readaloud/ModeToggle.svelte';
	import KaraokeText from '$lib/components/readaloud/KaraokeText.svelte';
	import DialogicBubble from '$lib/components/readaloud/DialogicBubble.svelte';
	import QuizPanel from '$lib/components/readaloud/QuizPanel.svelte';
	import { BrowserSpeechProvider } from '$lib/services/readaloud/BrowserSpeechProvider';
	import { NarratorServerProvider, pickTtsProvider } from '$lib/services/readaloud/NarratorServerProvider';
	import type {
		EduOverlayBundle,
		QuizQuestion,
		Tier2Annotation,
		TtsProvider
	} from '$lib/services/readaloud/types';

	type Spread = { index: number; text: string; framePngBase64: string; effect: string };
	type ReadAloudMode = 'listen' | 'read' | 'phonics' | 'quiz';
	type PublicEduOverlayBundle = Omit<EduOverlayBundle, 'quiz'> & { quiz?: QuizQuestion[] };
	interface BundleResponse {
		shortcode: string;
		title: string;
		stylePackId?: string;
		spreads: Spread[];
		hasVoiceOver: boolean;
		hasDedicationAudio: boolean;
		emailGateRequired?: boolean;
		emailGateAfter?: number;
		edu?: PublicEduOverlayBundle;
	}

	let bundle = $state<BundleResponse | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let emailInput = $state('');
	let submitting = $state(false);
	let mode = $state<ReadAloudMode>('read');
	let ttsProvider = $state<TtsProvider | null>(null);
	let activeWordBySpread = $state<Record<number, number>>({});
	let tier2Card = $state<Tier2Annotation | null>(null);
	let shareUrl = $state('');
	let shareMessage = $state('');

	const shortcode = $derived($page.params.shortcode as string);
	const stylePack = $derived(bundle?.stylePackId ? getStylePack(bundle.stylePackId) : null);
	const availableModes: ReadAloudMode[] = $derived.by(() => {
		if (!bundle?.edu) return [];
		const modes: ReadAloudMode[] = [];
		if (ttsProvider) modes.push('listen');
		modes.push('read', 'phonics');
		if (!bundle.emailGateRequired && (bundle.edu.quiz?.length ?? 0) > 0) modes.push('quiz');
		return modes;
	});

	$effect(() => {
		if (bundle?.edu && availableModes.length > 0 && !availableModes.includes(mode)) {
			mode = availableModes[0];
		}
	});

	async function fetchBundle() {
		loading = true;
		error = null;
		try {
			const r = await fetch(`/api/book/${shortcode}`);
			if (!r.ok) {
				error = `Could not load read-along (${r.status})`;
				return;
			}
			bundle = (await r.json()) as BundleResponse;
			tier2Card = null;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	async function submitEmail(ev: SubmitEvent) {
		ev.preventDefault();
		if (!emailInput || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) {
			error = 'Please enter a valid email';
			return;
		}
		submitting = true;
		try {
			const r = await fetch('/api/marketing/email-gate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: emailInput, shortcode }),
			});
			if (!r.ok) {
				error = `Could not unlock (${r.status})`;
				return;
			}
			// Also POST to /api/book/[shortcode] so the legacy book-assembler
			// session is granted too (best-effort).
			await fetch(`/api/book/${shortcode}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: emailInput }),
			}).catch(() => undefined);
			// Reload the bundle now that cookies are set.
			await fetchBundle();
		} finally {
			submitting = false;
		}
	}

	async function trackReferralIfAny() {
		const ref = $page.url.searchParams.get('ref');
		if (!ref) return;
		// Fire and forget. Server-side route 302s; client just pings to count.
		await fetch(`/api/marketing/referral/${ref}`).catch(() => undefined);
	}

	async function setupTtsProvider() {
		ttsProvider = await pickTtsProvider([new NarratorServerProvider(), new BrowserSpeechProvider()]);
	}

	async function playSpread(spread: Spread) {
		if (!ttsProvider) return;
		let wordIndex = -1;
		activeWordBySpread = { ...activeWordBySpread, [spread.index]: -1 };
		try {
			await ttsProvider.synth(spread.text, {
				onBoundary: () => {
					wordIndex += 1;
					activeWordBySpread = { ...activeWordBySpread, [spread.index]: wordIndex };
				}
			});
		} catch (e) {
			console.warn('Read-aloud speech failed', e);
		} finally {
			activeWordBySpread = { ...activeWordBySpread, [spread.index]: -1 };
		}
	}

	function speakWord(word: string) {
		ttsProvider?.synth(word, { rate: 0.9 }).catch((e) => {
			console.warn('Read-aloud word speech failed', e);
		});
	}

	function showTier2(annotation: Tier2Annotation) {
		tier2Card = annotation;
		speakWord(annotation.word);
	}

	function annotationsForSpread(spreadIndex: number): Tier2Annotation[] {
		return bundle?.edu?.tier2Annotations.filter((annotation) => annotation.spreadIndex === spreadIndex) ?? [];
	}

	function promptsForSpread(spreadIndex: number) {
		return bundle?.edu?.dialogicPrompts.filter((prompt) => prompt.spreadIndex === spreadIndex) ?? [];
	}

	async function mintShareLink() {
		if (typeof window === 'undefined') return;
		const url = new URL(`/r/${shortcode}`, window.location.origin).toString();
		shareUrl = url;
		try {
			await navigator.clipboard?.writeText(url);
			shareMessage = 'Link copied.';
		} catch {
			shareMessage = 'Link ready.';
		}
	}

	onMount(async () => {
		await trackReferralIfAny();
		await setupTtsProvider();
		await fetchBundle();
	});
</script>

<svelte:head>
	<title>{bundle?.title ?? 'Storybook Workshop'} · Read-along</title>
</svelte:head>

<main class="readalong">
	{#if loading}
		<p>Loading...</p>
	{:else if error && !bundle}
		<p class="error" data-testid="error">{error}</p>
	{:else if bundle}
		<header>
			<h1>{bundle.title}</h1>
		</header>
		{#if bundle.edu}
			<ModeToggle {mode} {availableModes} onChange={(next) => (mode = next)} />
		{/if}
		<ol class="spreads">
			{#each bundle.spreads as spread (spread.index)}
				<li class="spread" data-spread-index={spread.index}>
					{#if bundle.edu}
						{#if mode === 'listen' && ttsProvider}
							<button type="button" class="listen-button" onclick={() => playSpread(spread)}>
								Play spread {spread.index + 1}
							</button>
						{/if}
						<KaraokeText
							text={spread.text}
							{mode}
							activeWordIndex={activeWordBySpread[spread.index] ?? -1}
							wordTimings={bundle.edu.wordTimings?.[spread.index] ?? []}
							phonicsMap={bundle.edu.phonicsMap}
							tier2Annotations={annotationsForSpread(spread.index)}
							onWordSpeak={speakWord}
							onTier2={showTier2}
						/>
						{#each promptsForSpread(spread.index) as prompt (`${spread.index}-${prompt.text}`)}
							<DialogicBubble {prompt} />
						{/each}
					{:else}
						<p>{spread.text}</p>
					{/if}
				</li>
			{/each}
		</ol>

		{#if bundle.edu && tier2Card}
			<section class="tier2-card" data-testid="tier2-card">
				<h2>{tier2Card.word}</h2>
				<p>{tier2Card.definitionKid || 'A useful story word.'}</p>
			</section>
		{/if}

		{#if bundle.edu && mode === 'quiz' && !bundle.emailGateRequired && bundle.edu.quiz?.length}
			<QuizPanel questions={bundle.edu.quiz} />
		{/if}

		{#if stylePack?.educationalCard}
			<section class="style-card" data-testid="style-card">
				<h2>About this art style</h2>
				<h3>{stylePack.displayName}</h3>
				<p>{stylePack.educationalCard.kidExplainer}</p>
				<p><strong>Look for:</strong> {stylePack.educationalCard.lookFor}</p>
				{#if stylePack.respectNote}
					<p class="respect-note">{stylePack.respectNote}</p>
				{/if}
			</section>
		{/if}

		{#if bundle.emailGateRequired}
			<section class="gate" data-testid="email-gate">
				<h2>Enter your email to read the full book</h2>
				<p>The first {bundle.emailGateAfter ?? 4} spreads are free. Unlock the rest with one click.</p>
				<form onsubmit={submitEmail}>
					<input
						type="email"
						bind:value={emailInput}
						placeholder="you@example.com"
						required
						aria-label="Email"
					/>
					<button type="submit" disabled={submitting}>
						{submitting ? 'Unlocking...' : 'Unlock'}
					</button>
				</form>
				{#if error}<p class="error">{error}</p>{/if}
				<p class="tiny">
					We use your email to send the read-along link and a few short follow-ups.
					Unsubscribe in one click. We never sell your data. We are COPPA-K compliant.
				</p>
			</section>
		{:else}
			<section class="cta">
				<h2>Love it? Make it a hardcover.</h2>
				<a href="/?ref={shortcode}" class="primary">Order this for {bundle.title}</a>
				<a href="/" class="secondary">Make one for your own grandkid</a>
				<div class="share" data-testid="share-controls">
					<button type="button" onclick={mintShareLink}>Share with Grandma</button>
					{#if shareUrl}<input class="share-url" readonly value={shareUrl} />{/if}
					{#if shareMessage}<p class="tiny">{shareMessage}</p>{/if}
				</div>
			</section>
		{/if}
	{/if}
</main>

<style>
	.readalong {
		max-width: 760px;
		margin: 0 auto;
		padding: 32px 16px;
		font-family: system-ui, sans-serif;
		color: #1f1d1a;
		line-height: 1.5;
	}
	h1 {
		font-size: 2rem;
		text-align: center;
		margin-bottom: 32px;
	}
	.spreads {
		list-style: none;
		padding: 0;
	}
	.spread {
		background: #fafaf9;
		padding: 24px;
		border-radius: 12px;
		margin-bottom: 16px;
		font-size: 1.1rem;
	}
	.listen-button {
		margin: 0 0 12px;
		border: 0;
		border-radius: 8px;
		background: #204d74;
		color: #ffffff;
		padding: 8px 12px;
		font-weight: 700;
		cursor: pointer;
	}
	.tier2-card {
		margin: 20px 0;
		padding: 16px;
		border: 1px solid #d8d0ff;
		border-radius: 8px;
		background: #f6f3ff;
	}
	.tier2-card h2 {
		margin: 0 0 6px;
		font-size: 1.2rem;
	}
	.tier2-card p {
		margin: 0;
	}
	.style-card {
		background: #f7f3e8;
		border: 1px solid #e0d6bd;
		border-radius: 8px;
		padding: 24px;
		margin: 32px 0 16px;
	}
	.style-card h2,
	.style-card h3 {
		margin: 0 0 8px;
	}
	.style-card p {
		margin: 8px 0;
	}
	.respect-note {
		color: #5f5138;
		font-size: 0.95rem;
	}
	.gate {
		margin-top: 48px;
		padding: 32px;
		background: #fff8e1;
		border-radius: 12px;
		text-align: center;
	}
	.gate h2 {
		margin: 0 0 8px;
	}
	.gate form {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin: 16px 0;
		flex-wrap: wrap;
	}
	.gate input {
		padding: 10px 16px;
		border: 1px solid #ddd;
		border-radius: 6px;
		font-size: 1rem;
		min-width: 220px;
	}
	.gate button {
		padding: 10px 20px;
		background: #1a73e8;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
	}
	.gate button:disabled {
		opacity: 0.6;
	}
	.tiny {
		font-size: 0.8rem;
		color: #888;
		margin-top: 16px;
	}
	.cta {
		margin-top: 48px;
		text-align: center;
	}
	.cta a {
		display: inline-block;
		margin: 8px;
		padding: 12px 24px;
		border-radius: 6px;
		text-decoration: none;
		font-weight: 600;
	}
	.cta .primary {
		background: #1a73e8;
		color: white;
	}
	.cta .secondary {
		color: #1a73e8;
	}
	.error {
		color: #d32f2f;
		font-size: 0.9rem;
	}
</style>
