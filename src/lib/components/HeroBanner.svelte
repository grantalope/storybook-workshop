<script lang="ts">
</script>

<section class="hero">
	<div class="hero-inner">
		<p class="eyebrow">Personalized read-aloud picture books</p>
		<h1 class="headline">Their name on the cover. The science of reading on every page.</h1>
		<p class="subhead">A story where your child is the hero and every tap is quietly doing the work of a PhD in literacy.</p>

		<div class="chips">
			<div class="chip">
				<span class="chip-emoji"></span>
				<div class="chip-text">
					<strong>Words light up as they're read</strong>
					<span class="chip-note">orthographic mapping</span>
				</div>
			</div>
			<div class="chip">
				<span class="chip-emoji"></span>
				<div class="chip-text">
					<strong>Tap any word to sound it out</strong>
					<span class="chip-note">systematic synthetic phonics</span>
				</div>
			</div>
			<div class="chip">
				<span class="chip-emoji"></span>
				<div class="chip-text">
					<strong> Talk-about-it prompts each page</strong>
					<span class="chip-note">dialogic reading</span>
				</div>
			</div>
		</div>

	 <div class="actions">
			<a href="/examples" class="btn btn-primary">Read an example</a>
			<a href="/approach" class="btn btn-secondary">The science </a>
		</div>
	</div>
</section>

<style>
	.hero {
		background: linear-gradient(135deg, #fef6f0 0%, #fdf2e9 50%, #f9ede3 100%);
		border-radius: 20px;
		padding: 2.5rem 1.5rem;
		margin-inline: auto;
		max-width: 860px;
	}

	.hero-inner {
		text-align: center;
	}

	.eyebrow {
		color: #b07a5c;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		margin-bottom: 0.75rem;
	}

	.headline {
		color: #2a1810;
		font-size: 1.75rem;
		font-weight: 700;
		line-height: 1.25;
		margin-bottom: 0.75rem;
	}

	.subhead {
		color: #5c4538;
		font-size: 1rem;
		line-height: 1.6;
		max-width: 560px;
		margin-inline: auto;
		margin-bottom: 1.75rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: center;
		margin-bottom: 1.75rem;
	}

	.chip {
		background: #fff;
		border-radius: 12px;
		padding: 0.875rem 1rem;
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		text-align: left;
		box-shadow: 0 2px 8px rgba(42, 24, 16, 0.04);
		flex: 1 1 200px;
		max-width: 260px;
	}

	.chip-emoji {
		font-size: 1.25rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.chip-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.chip-text strong {
		color: #2a1810;
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.4;
	}

	.chip-note {
		color: #9e7b66;
		font-size: 0.6875rem;
		font-weight: 500;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: center;
	}

	.btn {
		border-radius: 10px;
		font-size: 0.9375rem;
		font-weight: 600;
		padding: 0.625rem 1.25rem;
		text-decoration: none;
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}

	.btn:hover {
		transform: translateY(-1px);
	}

	.btn-primary {
		background: #2a1810;
		color: #fef6f0;
		box-shadow: 0 2px 8px rgba(42, 24, 16, 0.12);
	}

	.btn-primary:hover {
		box-shadow: 0 4px 12px rgba(42, 24, 16, 0.16);
	}

	.btn-secondary {
		background: #fff;
		color: #5c4538;
		box-shadow: 0 2px 8px rgba(42, 24, 16, 0.06);
	}

	.btn-secondary:hover {
		box-shadow: 0 4px 12px rgba(42, 24, 16, 0.1);
	}

	@media (min-width: 640px) {
		.hero {
			padding: 3rem 2.5rem;
		}

		.headline {
			font-size: 2rem;
		}
	}
</style>
