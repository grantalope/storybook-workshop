<!--
src/routes/(marketing)/research/+page.svelte

Research-backing page. Shows the 10 evidence knobs as cards, each with
a citation. Sourced from the same catalog the EducationalDripService uses,
so the marketing claim and the educational drip cite the same papers.
-->
<script lang="ts">
	import { EDU_DRIP_CATALOG } from '$lib/services/marketing';

	// Group by knob: pick the first entry per knob as the headline citation.
	const byKnob = new Map<string, (typeof EDU_DRIP_CATALOG)[number]>();
	for (const e of EDU_DRIP_CATALOG) {
		if (!byKnob.has(e.knob)) byKnob.set(e.knob, e);
	}
	const cards = Array.from(byKnob.values());
</script>

<svelte:head>
	<title>The research — Storybook Workshop</title>
	<meta
		name="description"
		content="10 evidence-backed design knobs, each tied to a peer-reviewed citation. No marketing fluff."
	/>
</svelte:head>

<main class="research">
	<header class="hero">
		<h1>Real research. No fluff.</h1>
		<p>
			Every design knob in Storybook Workshop is tied to a published reading-research
			finding. Here are the ten core knobs, each linked to its primary citation.
		</p>
	</header>

	<ul class="citations">
		{#each cards as entry}
			<li id={entry.id} class="citation-card">
				<h2>{entry.knob.replace(/_/g, ' ')}</h2>
				<p class="cite">{entry.citation}</p>
				<p class="body">{entry.body}</p>
				<p class="tie">{entry.productTie}</p>
			</li>
		{/each}
	</ul>

	<p class="links"><a href="/">Back to the workshop</a></p>
</main>

<style>
	.research {
		max-width: 880px;
		margin: 0 auto;
		padding: 64px 24px;
		font-family: system-ui, sans-serif;
		color: #1f1d1a;
	}
	.hero {
		margin-bottom: 48px;
	}
	.hero h1 {
		font-size: 2.5rem;
		margin-bottom: 16px;
	}
	.hero p {
		color: #555;
		font-size: 1.05rem;
		max-width: 600px;
	}
	.citations {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 24px;
	}
	.citation-card {
		background: #fafaf9;
		padding: 24px;
		border-radius: 12px;
		border-top: 4px solid #1a73e8;
	}
	.citation-card h2 {
		font-size: 1.15rem;
		margin: 0 0 8px;
		text-transform: capitalize;
	}
	.cite {
		font-style: italic;
		color: #777;
		margin: 0 0 12px;
		font-size: 0.9rem;
	}
	.body {
		margin: 0 0 12px;
	}
	.tie {
		margin: 0;
		font-size: 0.9rem;
		color: #1a73e8;
	}
	.links {
		margin-top: 48px;
		text-align: center;
	}
</style>
