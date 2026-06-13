<script lang="ts">
	import { STYLE_PACKS } from '$lib/services/stylepacks';

	// Single source of truth: the same packs the workshop's Station 5 offers.
	const packs = STYLE_PACKS;

	// The 3 "modern/game" packs are `legacy: true` — they carry no art-history
	// educationalCard or palette (those fields are reserved for real traditions).
	// Mirror Station 5's preview blurbs + give each a representative palette so
	// their cards read as intentional, not empty.
	const LEGACY_PREVIEW: Record<string, { blurb: string; palette: string[] }> = {
		'octopath-hd2d': {
			blurb:
				'A cozy video-game world — small painted characters stand in deep, glowing scenes with soft light and a gentle blur, like a little stage you could step into.',
			palette: ['#1b2a4a', '#e8a33d', '#2f6f6a', '#c9603f', '#f3e6c4'],
		},
		'flat-painted': {
			blurb:
				'Soft, quiet watercolor with gentle colors and no shiny effects — calm and warm, the feel of a bedtime story.',
			palette: ['#a7c4bc', '#f4d8c6', '#e8b4a0', '#cfe0d8', '#fbf3e6'],
		},
		'pixel-pure': {
			blurb:
				'Made of tiny colored squares called pixels, like a classic arcade game. Look closely and you can count the little blocks!',
			palette: ['#22223b', '#4ea8de', '#f7b32b', '#e63946', '#06d6a0'],
		},
	};

	function paletteFor(p: (typeof STYLE_PACKS)[number]): string[] {
		const pal = p.promptRecipe?.palette;
		if (pal && pal.length) return [...pal];
		return LEGACY_PREVIEW[p.id]?.palette ?? [];
	}
	function explainFor(p: (typeof STYLE_PACKS)[number]): string {
		return p.educationalCard?.kidExplainer ?? LEGACY_PREVIEW[p.id]?.blurb ?? '';
	}

	function inspiredBy(p: (typeof STYLE_PACKS)[number]): string {
		const names = (p.inspirations ?? []).map((i) => i.name);
		return names.length ? names.join(', ') : '';
	}
	function eraLabel(p: (typeof STYLE_PACKS)[number]): string {
		const e = (p as { era?: { start?: number; end?: number } }).era;
		if (!e?.start) return '';
		return e.end ? `${e.start}–${e.end}` : `${e.start}`;
	}
</script>

<svelte:head>
	<title>Art Styles — Storybook Workshop</title>
	<meta
		name="description"
		content="Every book can be dressed in a real art-history style — Ukiyo-e woodblock, Impressionist gardens, Van Gogh swirls, Bauhaus shapes, and more. Each one teaches your child to see."
	/>
</svelte:head>

<div class="page">
	<header class="header">
		<h1 class="title">{packs.length} art styles. One story, dressed your way.</h1>
		<p class="subtitle">
			Every book is illustrated in a real art-history tradition — chosen at Station 5 of the
			workshop. Each style is a tiny, joyful art lesson: a palette, a way of seeing, an artist to
			meet. Tap a style in the workshop to dress your child's story in it.
		</p>
	</header>

	<div class="grid">
		{#each packs as p (p.id)}
			<article class="card">
				<div class="swatches" aria-hidden="true">
					{#each paletteFor(p).slice(0, 6) as c}
						<span class="swatch" style={`background:${c}`}></span>
					{/each}
				</div>
				<div class="info">
					<h2 class="style-name">{p.displayName}</h2>
					{#if explainFor(p)}
						<p class="explain">{explainFor(p)}</p>
					{/if}
					{#if p.educationalCard?.lookFor}
						<p class="lookfor"><strong>Look for:</strong> {p.educationalCard.lookFor}</p>
					{/if}
					<p class="credits">
						{#if inspiredBy(p)}<span class="inspired">In the spirit of {inspiredBy(p)}</span>{/if}
						{#if eraLabel(p)}<span class="era">· {eraLabel(p)}</span>{/if}
					</p>
				</div>
			</article>
		{/each}
	</div>

	<section class="more">
		<h2>…and many more on the way</h2>
		<p>
			These {packs.length} are the launch set. Our render pipeline runs open
			image-generation models on our own GPU, so new style packs — more world traditions, more eras,
			seasonal and themed looks — ship without re-architecting anything: each one is just a new
			recipe (palette + technique prompt + a kid-friendly art lesson). We are deliberately
			community-and-culture-respectful about which traditions we add and how we describe them.
		</p>
		<a class="cta" href="/">Make a book →</a>
	</section>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		background: #fef9f3;
		color: #3e2723;
	}
	.page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 24px 16px 64px;
	}
	.header {
		text-align: center;
		margin: 8px auto 32px;
		max-width: 760px;
	}
	.title {
		font-size: 1.9rem;
		font-weight: 800;
		margin: 0 0 10px;
		color: #4e342e;
		line-height: 1.15;
	}
	.subtitle {
		font-size: 1.02rem;
		margin: 0;
		color: #6d4c41;
		line-height: 1.5;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 20px;
	}
	.card {
		background: #fff;
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 4px 12px rgba(62, 39, 35, 0.08);
		transition: transform 0.2s ease, box-shadow 0.2s ease;
		display: flex;
		flex-direction: column;
	}
	.card:hover {
		transform: translateY(-4px);
		box-shadow: 0 8px 24px rgba(62, 39, 35, 0.12);
	}
	.swatches {
		display: flex;
		height: 64px;
	}
	.swatch {
		flex: 1;
	}
	.info {
		padding: 16px 18px 18px;
	}
	.style-name {
		font-size: 1.15rem;
		font-weight: 700;
		margin: 0 0 8px;
		color: #4e342e;
	}
	.explain {
		font-size: 0.94rem;
		line-height: 1.5;
		margin: 0 0 10px;
		color: #5d4037;
	}
	.lookfor {
		font-size: 0.86rem;
		line-height: 1.45;
		margin: 0 0 10px;
		color: #6d4c41;
	}
	.credits {
		font-size: 0.8rem;
		margin: 0;
		color: #8d6e63;
	}
	.more {
		margin: 44px auto 0;
		max-width: 720px;
		text-align: center;
		background: #fff7d6;
		border: 2px solid #f0d98a;
		border-radius: 16px;
		padding: 28px 24px;
	}
	.more h2 {
		margin: 0 0 10px;
		color: #4e342e;
	}
	.more p {
		margin: 0 auto 18px;
		color: #6d4c41;
		line-height: 1.55;
	}
	.cta {
		display: inline-block;
		background: #2a6;
		color: #fff;
		text-decoration: none;
		font-weight: 700;
		padding: 0.7rem 1.6rem;
		border-radius: 999px;
	}
	@media (max-width: 480px) {
		.title {
			font-size: 1.5rem;
		}
	}
</style>
