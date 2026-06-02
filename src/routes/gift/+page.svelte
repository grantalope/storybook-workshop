<!--
	src/routes/storybook-workshop/gift/+page.svelte

	Grandma's gift purchase page (no parent account needed). Multi-step
	form: recipient → cadence/format → length → start-date → card → pay.
	Stripe iframe mount stubbed in MVP (real integration is fulfillment goal).

	Spec §6.4 + goal Build sequence Phase 4.
-->
<script lang="ts">
	import type {
		BundleLength,
		Cadence,
		Format
	} from '$lib/services/subscription';

	type Step = 'recipient' | 'cadence' | 'length' | 'start' | 'card' | 'pay' | 'done';

	let step: Step = $state('recipient');

	// Form state
	let recipientName = $state('');
	let recipientParentEmail = $state('');
	let cadence: Cadence = $state('monthly');
	let format: Format = $state('hardcover');
	let bundleLength: BundleLength | null = $state(12);
	let startDate: number = $state(Date.now());
	let cardFromGiver = $state('');
	let giverName = $state('');
	let giverEmail = $state('');

	let submitting = $state(false);
	let result: { giftId: string; redeemCode: string } | null = $state(null);
	let error: string | null = $state(null);

	const steps: Step[] = ['recipient', 'cadence', 'length', 'start', 'card', 'pay'];

	function next() {
		const i = steps.indexOf(step);
		if (i >= 0 && i < steps.length - 1) step = steps[i + 1];
	}
	function back() {
		const i = steps.indexOf(step);
		if (i > 0) step = steps[i - 1];
	}

	async function submitGift() {
		submitting = true;
		error = null;
		try {
			const res = await fetch('/api/gift', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					recipientParentEmail,
					recipientName,
					cadence,
					format,
					bundleLength,
					startDate,
					cardFromGiver,
					giverName,
					giverEmail
				})
			});
			if (!res.ok) {
				const errBody = (await res.json()) as { error?: string; message?: string };
				throw new Error(errBody.message ?? errBody.error ?? 'unknown error');
			}
			const body = (await res.json()) as { gift: { id: string; redeemCode: string } };
			result = { giftId: body.gift.id, redeemCode: body.gift.redeemCode };
			step = 'done';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Give a Storybook — Storybook Workshop</title>
	<meta
		name="description"
		content="Give a custom-illustrated storybook series. No parent account required — they redeem with a code."
	/>
</svelte:head>

<main class="gift-page">
	<header>
		<h1>Give a year of stories</h1>
		<p>Personalized storybooks delivered every month — they redeem with a code.</p>
	</header>

	<section class="wizard">
		{#if step === 'recipient'}
			<h2>Who is this for?</h2>
			<label>
				Their name
				<input type="text" bind:value={recipientName} placeholder="Eli" />
			</label>
			<label>
				Their parent's email
				<input
					type="email"
					bind:value={recipientParentEmail}
					placeholder="parent@example.com"
				/>
			</label>
			<button onclick={next} disabled={!recipientName || !recipientParentEmail}
				>Continue</button
			>
		{:else if step === 'cadence'}
			<h2>How often?</h2>
			<label>
				Cadence
				<select bind:value={cadence}>
					<option value="quarterly">Every 3 months</option>
					<option value="monthly">Monthly (flagship)</option>
					<option value="biweekly">Every 2 weeks</option>
					<option value="weekly">Weekly</option>
				</select>
			</label>
			<label>
				Format
				<select bind:value={format}>
					<option value="hardcover">Hardcover</option>
					<option value="softcover">Softcover</option>
					<option value="bedtime">Bedtime (digital + audio)</option>
				</select>
			</label>
			<button onclick={back}>Back</button>
			<button onclick={next}>Continue</button>
		{:else if step === 'length'}
			<h2>How many books?</h2>
			<label>
				<input type="radio" bind:group={bundleLength} value={3} />
				3-book bundle — $79.99
			</label>
			<label>
				<input type="radio" bind:group={bundleLength} value={6} />
				6-book bundle — $149.99
			</label>
			<label>
				<input type="radio" bind:group={bundleLength} value={12} />
				12-book bundle — $279.99 (best value)
			</label>
			<label>
				<input type="radio" bind:group={bundleLength} value={24} />
				24-book bundle — $559.98
			</label>
			<label>
				<input type="radio" bind:group={bundleLength} value={null} />
				Until I cancel
			</label>
			<button onclick={back}>Back</button>
			<button onclick={next}>Continue</button>
		{:else if step === 'start'}
			<h2>When should it start?</h2>
			<label>
				Start date
				<input
					type="date"
					value={new Date(startDate).toISOString().slice(0, 10)}
					oninput={(e) => {
						const target = e.target as HTMLInputElement;
						if (target.valueAsDate) startDate = target.valueAsDate.getTime();
					}}
				/>
			</label>
			<button onclick={back}>Back</button>
			<button onclick={next}>Continue</button>
		{:else if step === 'card'}
			<h2>Card from {giverName || 'you'} to {recipientName || 'them'}</h2>
			<textarea
				bind:value={cardFromGiver}
				maxlength="500"
				rows="4"
				placeholder="Hi Eli — happy reading! Love, Grandma"
			></textarea>
			<label>
				Your name (appears on dedication page)
				<input type="text" bind:value={giverName} placeholder="Grandma Lou" />
			</label>
			<label>
				Your email (for the receipt)
				<input type="email" bind:value={giverEmail} placeholder="grandma@example.com" />
			</label>
			<button onclick={back}>Back</button>
			<button onclick={next} disabled={!giverName || !giverEmail}>Continue</button>
		{:else if step === 'pay'}
			<h2>Review + pay</h2>
			<dl>
				<dt>Recipient</dt>
				<dd>{recipientName} ({recipientParentEmail})</dd>
				<dt>Cadence + format</dt>
				<dd>{cadence} / {format}</dd>
				<dt>Length</dt>
				<dd>{bundleLength === null ? 'Until I cancel' : `${bundleLength}-book bundle`}</dd>
				<dt>Start</dt>
				<dd>{new Date(startDate).toLocaleDateString()}</dd>
				<dt>Card from giver</dt>
				<dd>{cardFromGiver}</dd>
			</dl>
			<div class="stripe-mount-placeholder">
				<p><em>Stripe Checkout iframe mounts here (MVP stub).</em></p>
			</div>
			{#if error}<p class="error">Error: {error}</p>{/if}
			<button onclick={back}>Back</button>
			<button onclick={submitGift} disabled={submitting}>
				{submitting ? 'Submitting…' : 'Submit (MVP — skips Stripe)'}
			</button>
		{:else if step === 'done' && result}
			<h2>Done!</h2>
			<p>We've emailed {recipientParentEmail} the redeem code.</p>
			<p>
				Redeem code:
				<code>{result.redeemCode}</code>
			</p>
		{/if}
	</section>
</main>

<style>
	.gift-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 2rem;
	}
	header {
		text-align: center;
		margin-bottom: 2rem;
	}
	.wizard {
		background: #fff8f0;
		padding: 1.5rem;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	textarea,
	input[type='text'],
	input[type='email'],
	input[type='date'],
	select {
		padding: 0.5rem;
		font-size: 1rem;
		border: 1px solid #d4cfc4;
		border-radius: 4px;
	}
	button {
		padding: 0.75rem 1rem;
		font-size: 1rem;
		background: #1a73e8;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
	}
	.stripe-mount-placeholder {
		padding: 1rem;
		background: #f0f0f0;
		border-radius: 4px;
		text-align: center;
	}
	.error {
		color: #c00;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		column-gap: 1rem;
		row-gap: 0.5rem;
	}
	dt {
		font-weight: bold;
	}
	code {
		background: #fff;
		padding: 0.25rem 0.5rem;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 1.2rem;
	}
</style>
