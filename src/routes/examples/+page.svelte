<script lang="ts">
	interface BookData {
		id: string;
		title: string;
		ageBand: string;
		artStyle: string;
		coverUrl: string;
	}

	const ids = ['p002', 'p005', 'p006', 'p011', 'p024', 'p065', 'p083', 'p089'];

	let books = $state<BookData[]>([]);
	let loaded = $state(false);

	$effect(() => {
		let cancelled = false;

		async function loadBooks() {
			const results = await Promise.all(
				ids.map(async (id) => {
					try {
						const res = await fetch(`/pillar-library-v2/example-books/${id}/story.json`);
						if (!res.ok) return null;
						const data = await res.json();
						return {
							id,
							title: data.title ?? 'Untitled',
							ageBand: data.ageBand ?? '',
							artStyle: data.artStyle ?? '',
							coverUrl: `/pillar-library-v2/example-books/${id}/cover.jpg`
						} as BookData;
					} catch {
						return null;
					}
				})
			);

			if (!cancelled) {
				books = results.filter((b): b is BookData => b !== null);
				loaded = true;
			}
		}

		loadBooks();

		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:head>
	<title>Example Storybooks — Storybook Workshop</title>
	<meta
		name="description"
		content="Read finished personalized picture books aloud — tap any word to sound it out, with a talk-about-it prompt on every page. Full experience, no sign-up."
	/>
</svelte:head>

<div class="page">
	<header class="header">
		<h1 class="title">Example Storybooks</h1>
		<p class="subtitle">Tap any book to read it aloud — full experience, no sign-up.</p>
	</header>

	{#if !loaded}
		<div class="loading">Loading books…</div>
	{:else if books.length === 0}
		<div class="empty">No books available right now.</div>
	{:else}
		<div class="grid">
			{#each books as book (book.id)}
				<a class="card" href={`/examples/${book.id}`}>
					<div class="cover-wrap">
						<img class="cover" src={book.coverUrl} alt={`Cover for ${book.title}`} loading="lazy" />
					</div>
					<div class="info">
						<h2 class="book-title">{book.title}</h2>
						<p class="meta">{book.ageBand} · {book.artStyle}</p>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
		background: #fef9f3;
		color: #3e2723;
	}

	.page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 24px 16px 48px;
	}

	.header {
		text-align: center;
		margin-bottom: 32px;
	}

	.title {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 0 0 8px;
		color: #4e342e;
	}

	.subtitle {
		font-size: 1rem;
		margin: 0;
		color: #6d4c41;
	}

	.loading,
	.empty {
		text-align: center;
		padding: 48px 16px;
		font-size: 1rem;
		color: #8d6e63;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 20px;
	}

	.card {
		display: block;
		text-decoration: none;
		color: inherit;
		background: #ffffff;
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 4px 12px rgba(62, 39, 35, 0.08);
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}

	.card:hover {
		transform: translateY(-4px);
		box-shadow: 0 8px 24px rgba(62, 39, 35, 0.12);
	}

	.cover-wrap {
		aspect-ratio: 3 / 4;
		overflow: hidden;
		background: #f3e5d8;
	}

	.cover {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.info {
		padding: 12px 14px 16px;
	}

	.book-title {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 4px;
		line-height: 1.3;
		color: #3e2723;
	}

	.meta {
		font-size: 0.8125rem;
		margin: 0;
		color: #8d6e63;
	}

	@media (min-width: 640px) {
		.page {
			padding: 32px 24px 64px;
		}

		.title {
			font-size: 2rem;
		}

		.subtitle {
			font-size: 1.0625rem;
		}
	}

	@media (min-width: 1024px) {
		.page {
			padding: 40px 32px 80px;
		}

		.grid {
			gap: 24px;
		}
	}
</style>
