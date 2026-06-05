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

	type Spread = { index: number; text: string; framePngBase64: string; effect: string };
	interface BundleResponse {
		shortcode: string;
		title: string;
		spreads: Spread[];
		hasVoiceOver: boolean;
		hasDedicationAudio: boolean;
		emailGateRequired?: boolean;
		emailGateAfter?: number;
	}

	let bundle = $state<BundleResponse | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let emailInput = $state('');
	let submitting = $state(false);

	const shortcode = $derived($page.params.shortcode as string);

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

	onMount(async () => {
		await trackReferralIfAny();
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
		<ol class="spreads">
			{#each bundle.spreads as spread (spread.index)}
				<li class="spread" data-spread-index={spread.index}>
					<p>{spread.text}</p>
				</li>
			{/each}
		</ol>

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
