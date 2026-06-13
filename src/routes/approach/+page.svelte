<svelte:head>
	<title>The Science — Storybook Workshop</title>
</svelte:head>

<main>

	<nav class="top-nav">
		<a href="/" class="nav-link">← Home</a>
		<a href="/examples" class="nav-link">Read an example →</a>
	</nav>

	<header class="hero">
		<h1>The science behind the magic</h1>
		<p class="lead">Rigorous reading research woven into every highlighted word, every sounded-out syllable, every plot twist — hidden inside a story where the child is the hero.</p>
	</header>

	<section class="section">
		<h2>Word-by-word read-along</h2>
		<p class="subtitle">(orthographic mapping)</p>
		<p>Our karaoke highlight syncs each word to the narrator's voice, helping kids connect graphemes to phonemes — building <strong>orthographic mapping</strong> <em>(Ehri's phases: pre-alphabetic → partial → full → consolidated alphabetic)</em>, the mechanism behind fluent sight-word reading and the single biggest predictor of fluency.</p>
	</section>

	<section class="section">
		<h2>Tap to sound it out</h2>
		<p class="subtitle">(systematic synthetic phonics)</p>
		<p>Tapping a word breaks it into sounds — systematic synthetic phonics, the approach the <strong>National Reading Panel</strong> <em>(2000)</em> and the <strong>UK Rose Review</strong> <em>(2006)</em> found most effective for beginning readers; the "reading wars" resolution per <strong>Castles, Rastle & Nation</strong> <em>(2018)</em> is <em>which</em> phonics, not whether.</p>
	</section>

	<section class="section">
		<h2>Talk about the story</h2>
		<p class="subtitle">(dialogic reading)</p>
		<p>Our page-turn prompts are <strong>dialogic reading</strong> prompts <em>(Whitehurst et al.)</em> — the <strong>PEER</strong> sequence <em>(Prompt, Evaluate, Expand, Repeat)</em> and <strong>CROWD</strong> prompts <em>(Completion, Recall, Open-ended, Wh-, Distancing)</em>, shown to boost vocabulary + expressive language.</p>
	</section>

	<section class="section">
		<h2>The whole reader</h2>
		<p class="subtitle">(Scarborough's Reading Rope)</p>
		<p>Reading = word recognition × language comprehension <em>(Simple View of Reading, Gough & Tunmer; Scarborough's Rope)</em>. We weave both strands: decoding <em>and</em> Tier-2 vocabulary <em>(Beck, McKeown & Kucan)</em> + narrative/story-grammar comprehension <em>(Pixar-style story spine)</em>.</p>
	</section>

	<section class="section">
		<h2>Why their name + face matters</h2>
		<p class="subtitle">(personalization & agency)</p>
		<p>Personalization + child choice drive intrinsic motivation + attention/memory <em>(self-determination theory; the own-name/self-reference effect; Mayer's multimedia-learning for the word+image pairing)</em>. Rigor underneath; child-driven flexibility on top — not worksheets.</p>
	</section>

	<footer class="closing">
		<p>Every feature is grounded in peer-reviewed research, but to a child it simply feels like being the hero of their own story. Child-driven, not a worksheet.</p>
		<a href="/examples" class="cta-button">See it in a real book</a>
	</footer>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: Georgia, 'Times New Roman', serif;
		line-height: 1.7;
		color: #3d2b1f;
		background: #fdf8f3;
	}

	main {
		max-width: 42rem;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.top-nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid #e8ddd3;
	}

	.nav-link {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 0.875rem;
		color: #8b6914;
		text-decoration: none;
		padding: 0.5rem 0;
		transition: color 0.2s ease;
	}

	.nav-link:hover {
		color: #5c4a0a;
		text-decoration: underline;
	}

	.hero {
		margin-bottom: 3rem;
	}

	h1 {
		font-size: 1.875rem;
		font-weight: 400;
		line-height: 1.25;
		color: #2c1f16;
		margin: 0 0 1rem;
	}

	.lead {
		font-size: 1.125rem;
		line-height: 1.7;
		color: #5c4a3d;
		margin: 0;
	}

	.section {
		margin-bottom: 2.5rem;
		padding-bottom: 2.5rem;
		border-bottom: 1px solid #e8ddd3;
	}

	.section:last-of-type {
		border-bottom: none;
		margin-bottom: 2rem;
	}

	h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: #2c1f16;
		margin: 0 0 0.25rem;
	}

	.subtitle {
		font-size: 0.875rem;
		font-style: italic;
		color: #8b7355;
		margin: 0 0 0.75rem;
	}

	.section p:last-child {
		margin: 0;
	}

	.closing {
		text-align: center;
		padding: 2rem 0 3rem;
	}

	.closing p {
		font-size: 1.0625rem;
		line-height: 1.7;
		color: #5c4a3d;
		margin: 0 0 1.5rem;
	}

	.cta-button {
		display: inline-block;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		font-size: 1rem;
		font-weight: 500;
		color: #fff;
		background: #b8860b;
		padding: 0.875rem 2rem;
		border-radius: 0.5rem;
		text-decoration: none;
		transition: background 0.2s ease;
	}

	.cta-button:hover {
		background: #9a7009;
	}

	@media (min-width: 640px) {
		main {
			padding: 2.5rem;
		}

		h1 {
			font-size: 2.5rem;
		}

		.lead {
			font-size: 1.25rem;
		}

		h2 {
			font-size: 1.375rem;
		}
	}
</style>
