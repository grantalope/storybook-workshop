<!--
src/routes/(marketing)/+page.svelte

Landing page. Hero + 3 moats + "Make Your First Book (Free)" CTA per
spec §8.8. Marketing-pure: no kid PII, no upstream calls.
-->
<script lang="ts">
	const moats = [
		{
			title: 'Privacy on-device',
			body:
				"Your kid's photo, name, and address never enter our content pipeline. We vectorize the photo locally in your browser and only opaque pillar IDs ever cross a network boundary.",
		},
		{
			title: 'Evidence-backed pedagogy',
			body:
				'Every design choice ties to peer-reviewed reading research (Symons & Johnson 1997, Stein & Glenn 1979, Bus 1995, Beck/McKeown/Kucan 2013, Whitehurst 1988, Bryant 1990, ...). We will publish citations on every page.',
		},
		{
			title: 'Real settlers, real provenance',
			body:
				'Stories are co-authored by our settler roster — characters with stable personalities and consistent voices. You can see who wrote what, and the seal stamp on your hardcover names the lead settler for that book.',
		},
	];
</script>

<svelte:head>
	<title>Storybook Workshop · The personalized children's book</title>
	<meta
		name="description"
		content="Build a one-of-a-kind hardcover storybook starring your child. Free digital preview. Privacy on-device."
	/>
</svelte:head>

<main class="landing">
	<section class="hero">
		<h1>A storybook starring <em>your</em> child.</h1>
		<p class="lead">
			Build the story in 10 minutes. Read the digital preview free. Print the
			hardcover for $34.99 + free shipping.
		</p>
		<a href="/" class="cta" data-testid="marketing-cta">Make Your First Book (Free)</a>
	</section>

	<section class="moats">
		<h2>Why this is different.</h2>
		<div class="moat-grid">
			{#each moats as moat}
				<article class="moat">
					<h3>{moat.title}</h3>
					<p>{moat.body}</p>
				</article>
			{/each}
		</div>
	</section>

	<section class="links">
		<a href="/marketing/research">Research backing</a>
		<a href="/marketing/privacy">Privacy explainer</a>
		<a href="/gift">Grandma's gift flow</a>
	</section>
</main>

<style>
	.landing {
		max-width: 880px;
		margin: 0 auto;
		padding: 64px 24px;
		font-family: system-ui, sans-serif;
		color: #1f1d1a;
	}
	.hero {
		text-align: center;
		margin-bottom: 64px;
	}
	.hero h1 {
		font-size: clamp(2rem, 6vw, 3.5rem);
		line-height: 1.1;
		margin-bottom: 16px;
	}
	.hero em {
		color: #d2691e;
		font-style: italic;
	}
	.lead {
		font-size: 1.25rem;
		color: #555;
		max-width: 600px;
		margin: 0 auto 32px;
	}
	.cta {
		display: inline-block;
		background: #1a73e8;
		color: white;
		padding: 16px 32px;
		border-radius: 999px;
		font-size: 1.1rem;
		font-weight: 600;
		text-decoration: none;
	}
	.cta:hover {
		background: #1557b0;
	}
	.moats {
		margin-bottom: 64px;
	}
	.moats h2 {
		font-size: 1.75rem;
		text-align: center;
		margin-bottom: 32px;
	}
	.moat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 24px;
	}
	.moat {
		background: #fafaf9;
		padding: 24px;
		border-radius: 12px;
		border-left: 4px solid #d2691e;
	}
	.moat h3 {
		font-size: 1.1rem;
		margin: 0 0 8px;
	}
	.moat p {
		margin: 0;
		color: #555;
		font-size: 0.95rem;
	}
	.links {
		display: flex;
		justify-content: center;
		gap: 32px;
		flex-wrap: wrap;
	}
	.links a {
		color: #1a73e8;
	}
</style>
