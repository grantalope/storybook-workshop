<!--
src/routes/(marketing)/privacy/+page.svelte

Privacy explainer. Network-tab proof + on-device architecture explainer
per spec §8.8. Concrete claims, no marketing fluff.
-->
<svelte:head>
	<title>Privacy on-device — Storybook Workshop</title>
	<meta
		name="description"
		content="How we keep your kid's photo, name, and address off our servers — verifiably."
	/>
</svelte:head>

<main class="privacy">
	<h1>Your kid's data does not leave your device.</h1>
	<p class="lead">
		We mean that literally. The browser tab does the personalization. Our servers
		never see the photo, the name, or the address until the moment you place a print
		order — and even then, only the shipping address goes to Lulu (our print partner).
	</p>

	<section>
		<h2>What we do (on your device)</h2>
		<ul>
			<li>
				<strong>Photo CLIP vectorize:</strong> we run a small WASM neural net in your
				browser. It produces a 512-dimension vector representing your kid's appearance.
				The photo is then discarded.
			</li>
			<li>
				<strong>Name + name pronunciation:</strong> stored in your browser's local
				IndexedDB. Composited locally into the PDF at assembly time.
			</li>
			<li>
				<strong>Pillar match:</strong> the vector is compared to ~200 anonymous
				"pillar" archetypes shipped with the app. Only the matched pillar ID crosses
				to our servers — that ID does not identify your kid.
			</li>
		</ul>
	</section>

	<section>
		<h2>What we do (on our servers)</h2>
		<ul>
			<li>Story authoring via on-device LLM (LLR runtime, WebGPU). No external API call.</li>
			<li>
				Pillar manifest delivery — a static, version-controlled file of pillar
				descriptors. Same file for every parent. Nothing kid-specific.
			</li>
			<li>
				Order processing — at checkout, the shipping address + first name go to
				Lulu Direct (our print partner). The PDF is composed in your browser and
				uploaded directly to Lulu, never to our servers.
			</li>
		</ul>
	</section>

	<section>
		<h2>Network-tab proof</h2>
		<p>
			Open your browser DevTools, switch to the Network tab, and walk through the
			workshop. You will see:
		</p>
		<ul>
			<li>API call to <code>/api/pillar/manifest</code> — a static list of archetypes.</li>
			<li>No outbound POST containing a photo or kid name.</li>
			<li>
				Print order: a single POST to <code>/api/order</code> with format, page count,
				pdfHash, and shipping address.
			</li>
		</ul>
	</section>

	<section>
		<h2>COPPA-K + GDPR</h2>
		<p>
			We are COPPA-K compliant (children under 13). We never serve ads. We don't run
			behavioral analytics across users. Per-bucket unsubscribe (transactional /
			marketing / educational) is one click. Full-account delete cascades to our CRM
			contact within 24 hours.
		</p>
	</section>

	<p class="links"><a href="/">Back to the workshop</a></p>
</main>

<style>
	.privacy {
		max-width: 760px;
		margin: 0 auto;
		padding: 64px 24px;
		font-family: system-ui, sans-serif;
		color: #1f1d1a;
		line-height: 1.5;
	}
	h1 {
		font-size: 2.5rem;
		margin-bottom: 16px;
	}
	.lead {
		font-size: 1.2rem;
		color: #555;
		margin-bottom: 48px;
	}
	section {
		margin-bottom: 32px;
	}
	h2 {
		font-size: 1.4rem;
		margin-top: 32px;
		margin-bottom: 12px;
	}
	code {
		background: #fafaf9;
		padding: 2px 6px;
		border-radius: 4px;
		font-family: 'SF Mono', Menlo, monospace;
		font-size: 0.9em;
	}
	.links {
		margin-top: 48px;
	}
</style>
