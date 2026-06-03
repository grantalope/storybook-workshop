<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
	import type { BookFormat } from '$lib/services/assemble/types';
	import type {
		ShippingAddress,
		ShippingOption,
	} from '$lib/services/fulfillment';

	const { orchestrator }: { orchestrator: WorkshopOrchestrator } = $props();
	const dispatch = createEventDispatcher<{ done: void }>();

	type Phase =
		| 'choose'
		| 'address'
		| 'quote'
		| 'pay'
		| 'paying'
		| 'success'
		| 'error';

	let phase: Phase = 'choose';
	let errorMsg = '';
	let downloaded = false;

	const s6 = orchestrator.draft.outputs.s6;
	const s1 = orchestrator.draft.outputs.s1;
	const shortcode = s6?.bookShortcode ?? 'unknown';
	const targetPages = computeOrderPages();

	// -- Abandoned-cart tracking (blocker 5 wiring) -----------------------
	// Per spec section 8.3, Station 7 abandonment must register a cart
	// after a debounce window so the recovery chain fires at T+1h/24h/72h.
	// We trigger the registration when the parent has set their email AND
	// the phase is still pre-payment after 30 seconds.
	let _cartTimer: ReturnType<typeof setTimeout> | null = null;
	let _cartRegistered = false;
	const _cartCostCents = 3499;
	function scheduleAbandonedCartCheck(): void {
		if (_cartTimer) clearTimeout(_cartTimer);
		_cartTimer = setTimeout(() => {
			void maybeRegisterCart();
		}, 30_000);
	}
	async function maybeRegisterCart(): Promise<void> {
		if (_cartRegistered) return;
		if (!parentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) return;
		if (phase === 'success' || phase === 'paying' || phase === 'error') return;
		const kidId = orchestrator.draft.kidId;
		if (!kidId) return;
		try {
			const r = await fetch('/api/marketing/cart-abandoned', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					parentEmail,
					kidId,
					shortcode,
					bookCostCents: selectedOption?.subtotalCents ?? _cartCostCents,
				}),
			});
			if (r.ok) _cartRegistered = true;
		} catch {
			// best-effort; do not surface to the user
		}
	}
	async function resolveCart(): Promise<void> {
		const kidId = orchestrator.draft.kidId;
		if (!parentEmail || !kidId) return;
		try {
			await fetch(
				`/api/marketing/cart-abandoned?parentEmail=${encodeURIComponent(parentEmail)}&kidId=${encodeURIComponent(kidId)}`,
				{ method: 'DELETE' },
			);
		} catch {
			// best-effort
		}
	}
	onMount(() => scheduleAbandonedCartCheck());
	onDestroy(() => { if (_cartTimer) clearTimeout(_cartTimer); });


	function computeOrderPages(): number {
		// Spreads x 2 pages per spread, rounded up to format multiple downstream.
		// Use s1.targetSpreads when present.
		const spreads = s1?.targetSpreads ?? 12;
		const raw = spreads * 2;
		// Hardcover-8x8 multiple is 2 already — emit even count.
		return raw % 2 === 0 ? raw : raw + 1;
	}

	// ── Free digital download ────────────────────────────────────────────────
	function downloadDigital() {
		// MVP: the AssembledBook blob is not currently persisted across
		// stations (Station6Output stores only metadata). Emit a stub text
		// payload pointing to the shortcode + hash. Replace with the real PDF
		// once the in-memory transport ships (tracked in impl notes §Free-Digital).
		const text =
			`Your storybook shortcode: ${shortcode}\n` +
			`PDF size: ${(s6?.pdfBlobSize ?? 0) / 1024} KB\n` +
			`PDF hash: ${s6?.pdfHash}\n`;
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

	// ── Print order: state ──────────────────────────────────────────────────
	let addressForm = $state<ShippingAddress>({
		name: '',
		line1: '',
		city: '',
		region: '',
		postcode: '',
		country: 'US',
	});
	let parentEmail = $state('');
	let selectedFormat = $state<BookFormat>('hardcover-8x8');
	let quoteOptions = $state<ShippingOption[]>([]);
	let selectedOption = $state<ShippingOption | null>(null);
	let cardNumber = $state('');
	let orderId = $state<string | null>(null);
	let trackingInfo = $state<{ luluJobId?: string; state?: string }>({});

	async function fetchQuote() {
		errorMsg = '';
		try {
			const res = await fetch('/api/shipping-quote', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					shippingAddress: addressForm,
					format: selectedFormat,
					pages: targetPages,
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				errorMsg = data.error ?? 'quote_failed';
				phase = 'error';
				return;
			}
			quoteOptions = data.options as ShippingOption[];
			if (quoteOptions.length > 0) selectedOption = quoteOptions[0];
			phase = 'quote';
		} catch (e) {
			errorMsg = (e as Error).message;
			phase = 'error';
		}
	}

	async function createOrder() {
		if (!selectedOption) return;
		if (!s6) {
			errorMsg = 'station_6_output_missing';
			phase = 'error';
			return;
		}
		errorMsg = '';
		try {
			const res = await fetch('/api/order', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					kidId: orchestrator.draft.kidId,
					bookId: shortcode,
					parentEmail,
					format: selectedFormat,
					pages: targetPages,
					pdfHash: s6.pdfHash,
					shippingAddress: addressForm,
					shippingOption: selectedOption,
					bookCostCents: bookCostFor(selectedFormat),
					consentLog: s6.consent,
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				errorMsg = `${data.error}${data.field ? ': ' + data.field : ''}`;
				phase = 'error';
				return;
			}
			orderId = data.orderId;
			phase = 'pay';
		} catch (e) {
			errorMsg = (e as Error).message;
			phase = 'error';
		}
	}

	function bookCostFor(fmt: BookFormat): number {
		switch (fmt) {
			case 'hardcover-8x8':
				return 2999;
			case 'softcover-8x8':
				return 1999;
			case 'saddlestitch-8x8':
				return 1499;
		}
	}

	async function submitPayment() {
		if (cardNumber.replace(/\s+/g, '') !== '4242424242424242') {
			errorMsg = 'use the test card number 4242 4242 4242 4242';
			return;
		}
		phase = 'paying';
		// Simulate Stripe confirm + poll the order status until paid/submitted.
		// In a real Elements flow we would confirmCardPayment + listen for the
		// stripe-webhook to advance the order. Test-mode bypasses Elements.
		try {
			const res = await fetch(`/api/order/${orderId}`);
			const data = await res.json();
			trackingInfo = {
				luluJobId: data.luluJobId,
				state: data.state,
			};
			phase = 'success';
			void resolveCart();
		} catch (e) {
			errorMsg = (e as Error).message;
			phase = 'error';
		}
	}

	function backToChoose() {
		phase = 'choose';
		errorMsg = '';
	}
</script>

<section class="station">
	<h2>Take it home</h2>

	{#if phase === 'choose'}
		<div class="cta-grid">
			<button class="cta digital" on:click={downloadDigital}>
				<h3>Get the free digital book</h3>
				<p>Instant PDF + ePub read-along.</p>
			</button>
			<button class="cta print" on:click={() => (phase = 'address')}>
				<h3>Order printed copy</h3>
				<p>Hardcover delivered to your door.</p>
			</button>
		</div>

		{#if downloaded}
			<p class="status">Your digital book is downloading. Share the shortcode with grandparents.</p>
		{/if}

		<div class="more">
			<button on:click={done}>Make another book →</button>
			<a href="/library">Visit your library</a>
		</div>
	{:else if phase === 'address'}
		<div class="print-form">
			<h3>Where should we send it?</h3>
			<label>
				Parent email
				<input type="email" bind:value={parentEmail} placeholder="you@example.com" />
			</label>
			<label>
				Recipient name
				<input bind:value={addressForm.name} placeholder="Pat Parent" />
			</label>
			<label>
				Street
				<input bind:value={addressForm.line1} placeholder="123 Main St" />
			</label>
			<div class="row">
				<label>
					City
					<input bind:value={addressForm.city} />
				</label>
				<label>
					State/Region
					<input bind:value={addressForm.region} />
				</label>
			</div>
			<div class="row">
				<label>
					Postcode
					<input bind:value={addressForm.postcode} />
				</label>
				<label>
					Country (ISO-2)
					<input bind:value={addressForm.country} maxlength="2" />
				</label>
			</div>
			<label>
				Format
				<select bind:value={selectedFormat}>
					<option value="hardcover-8x8">Hardcover 8x8 — $29.99</option>
					<option value="softcover-8x8">Softcover 8x8 — $19.99</option>
					<option value="saddlestitch-8x8">Saddle-stitch 8x8 — $14.99</option>
				</select>
			</label>
			<div class="actions">
				<button class="back" on:click={backToChoose}>Back</button>
				<button class="primary" on:click={fetchQuote}>Get shipping quote →</button>
			</div>
			{#if errorMsg}<p class="error">{errorMsg}</p>{/if}
		</div>
	{:else if phase === 'quote'}
		<div class="print-form">
			<h3>Pick a shipping speed</h3>
			{#each quoteOptions as opt}
				<label class="radio-card">
					<input
						type="radio"
						bind:group={selectedOption}
						value={opt}
					/>
					<span class="opt-name">{opt.name}</span>
					<span class="opt-eta">~{opt.etaDays} days</span>
					<span class="opt-cost">${(opt.costCents / 100).toFixed(2)}</span>
				</label>
			{/each}
			<div class="actions">
				<button class="back" on:click={() => (phase = 'address')}>Back</button>
				<button class="primary" on:click={createOrder} disabled={!selectedOption}>Continue →</button>
			</div>
			{#if errorMsg}<p class="error">{errorMsg}</p>{/if}
		</div>
	{:else if phase === 'pay'}
		<div class="print-form">
			<h3>Test-mode card</h3>
			<p class="hint">
				Stripe Elements integration ships in v2. For now enter the test card
				<code>4242 4242 4242 4242</code>.
			</p>
			<label>
				Card number
				<input bind:value={cardNumber} placeholder="4242 4242 4242 4242" />
			</label>
			<div class="actions">
				<button class="back" on:click={() => (phase = 'quote')}>Back</button>
				<button class="primary" on:click={submitPayment}>Pay & print →</button>
			</div>
			{#if errorMsg}<p class="error">{errorMsg}</p>{/if}
		</div>
	{:else if phase === 'paying'}
		<p>Confirming your payment…</p>
	{:else if phase === 'success'}
		<div class="success-card">
			<h3>Your book is printing 🎉</h3>
			<p>Order ID: {orderId}</p>
			{#if trackingInfo.luluJobId}
				<p>Lulu job: {trackingInfo.luluJobId}</p>
			{/if}
			<p>We'll email you when it ships.</p>
			<button class="primary" on:click={done}>Make another book →</button>
		</div>
	{:else if phase === 'error'}
		<div class="error-card">
			<p class="error">Something went wrong: {errorMsg}</p>
			<button on:click={backToChoose}>Start over</button>
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
	.print-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 540px;
	}
	.print-form label {
		display: flex;
		flex-direction: column;
		font-size: 0.9rem;
	}
	.print-form input,
	.print-form select {
		padding: 0.5rem;
		border: 1px solid #bbb;
		border-radius: 4px;
		font-size: 1rem;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.radio-card {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		gap: 0.5rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		align-items: center;
	}
	.opt-name { font-weight: 600; }
	.opt-eta { color: #555; }
	.opt-cost { font-weight: 600; color: #2a6; }
	.actions {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.actions button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		border: 0;
		cursor: pointer;
	}
	.actions .back {
		background: #eee;
		color: #444;
	}
	.actions .primary {
		background: #2a6;
		color: white;
	}
	.success-card {
		padding: 1.5rem;
		background: #e8f5ed;
		border-radius: 12px;
	}
	.error {
		color: #c33;
		font-size: 0.9rem;
	}
	.error-card {
		padding: 1rem;
		background: #fee;
		border-radius: 8px;
	}
	.hint {
		font-size: 0.85rem;
		color: #555;
	}
	code {
		background: #f4f4f4;
		padding: 2px 4px;
		border-radius: 3px;
	}
</style>
