<script lang="ts">
	import { onMount } from "svelte";
	import { pillarVectorizerService } from "$lib/services/PillarVectorizerService";
	import { pillarMatcherService } from "$lib/services/PillarMatcherService";
	import { fetchManifest } from "$lib/services/PillarManifestClient";
	import type { Pillar, PillarMatch } from "$lib/services/types";
	let uploadCount = 0;
	let _fetchWrapped = false;
	function wrapFetch() {
		if (_fetchWrapped || typeof window === "undefined") return;
		_fetchWrapped = true;
		const origFetch = window.fetch.bind(window);
		window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const method = (init?.method ?? "GET").toUpperCase();
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
			const isLocal = url.startsWith("/") || url.startsWith(window.location.origin);
			if (!isLocal || method === "POST" || method === "PUT") uploadCount += 1;
			return origFetch(input, init);
		};
	}
	type DemoView = "home" | "matching" | "results" | "gallery";
	let view: DemoView = "home";
	let manifest: Pillar[] = [];
	let manifestLoaded = false;
	let photoFile: File | null = null;
	let photoUrl: string | null = null;
	let isDragging = false;
	let fileInput: HTMLInputElement;
	let matching = false;
	let matchError = "";
	let matches: PillarMatch[] = [];
	let galleryFilter = "";
	let galleryAgeBand = "";
	let faqOpen: Record<number, boolean> = {};
	interface ManifestEntry {
		pillarId: number; archetypeId: string; displayName: string;
		axes: { hair: string; skinTone: string; eyeColor: string; ageBand: string; clothingVibe: string; extras: string[]; };
		embedding: number[]; previewUrl: string; fullUrl: string;
	}
	let manifestRaw: ManifestEntry[] = [];
	interface BookData {
		beats: Array<{ beat: string; storyText: string; pageTurnHook: string }>;
		title: string; refrain: { setup: string; climaxMutation: string };
	}
	let exampleBooks: Record<string, BookData> = {};
	const DEMO_SAMPLES = [
		"/demo-samples/sample-01.jpg","/demo-samples/sample-02.jpg","/demo-samples/sample-03.jpg",
		"/demo-samples/sample-04.jpg","/demo-samples/sample-05.jpg","/demo-samples/sample-06.jpg",
	];
	onMount(async () => {
		wrapFetch();
		try { const res = await fetch("/pillar-library-v2/manifest.json"); if (res.ok) manifestRaw = await res.json(); } catch (_) {}
		manifest = await fetchManifest();
		manifestLoaded = true;
		pillarVectorizerService.warmup().catch(() => {});
		for (const id of ["p002","p005","p006","p011","p024","p065","p083","p089"]) {
			try { const r = await fetch(`/pillar-library-v2/example-books/${id}/story.json`); if (r.ok) exampleBooks[id] = await r.json(); } catch (_) {}
		}
	});
	function entryFor(pillarId: number): ManifestEntry | undefined {
		return manifestRaw.find((e) => e.pillarId === pillarId);
	}
	function handleFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (f) setPhoto(f);
	}
	function setPhoto(f: File) {
		photoFile = f;
		if (photoUrl) URL.revokeObjectURL(photoUrl);
		photoUrl = URL.createObjectURL(f);
		view = "home"; matchError = ""; matches = [];
	}
	function handleDrop(e: DragEvent) {
		e.preventDefault(); isDragging = false;
		const f = e.dataTransfer?.files[0];
		if (f && f.type.startsWith("image/")) setPhoto(f);
	}
	async function useSample(url: string) {
		try {
			const res = await fetch(url);
			if (!res.ok) { matchError = `Sample not available (${res.status}). Upload your own photo.`; return; }
			const blob = await res.blob();
			setPhoto(new File([blob], "sample.jpg", { type: blob.type }));
		} catch (_) { matchError = "Could not load sample. Upload your own photo."; }
	}
	async function runMatch() {
		if (!photoFile) return;
		matching = true; matchError = ""; matches = []; view = "matching";
		try {
			const vec = await pillarVectorizerService.vectorize(photoFile);
			photoFile = null;
			matches = await pillarMatcherService.match(vec, { topK: 3 });
			view = "results";
		} catch (err) {
			matchError = (err as Error).message ?? "Match failed.";
			view = "home";
		} finally { matching = false; }
	}
	$: filteredGallery = manifestRaw.filter((e) => {
		const q = galleryFilter.toLowerCase();
		if (q && !e.displayName.toLowerCase().includes(q) && !e.axes.hair.includes(q) && !e.axes.ageBand.includes(q)) return false;
		if (galleryAgeBand && e.axes.ageBand !== galleryAgeBand) return false;
		return true;
	});
	function pct(sim: number) { return Math.round(Math.max(0, Math.min(1, (sim + 1) / 2)) * 100); }
	const FAQ = [
		{ q: "Does my photo get uploaded anywhere?", a: "No. CLIP runs entirely in your browser via WebAssembly. Your photo is processed locally and immediately discarded. Only a 512-number embedding is used. Nothing leaves your device. Open DevTools Network tab to verify." },
		{ q: "What is an archetype?", a: "An archetype is one of 150 illustrated kid characters covering hair types, skin tones, eye colors, age bands, and clothing vibes. Your child's book hero comes from the closest archetype match." },
		{ q: "How accurate is the matching?", a: "CLIP (Contrastive Language-Image Pretraining) finds the closest visual match from 150 options by overall appearance. It is not a face-recognition system." },
		{ q: "Is this using face recognition?", a: "No. CLIP is a general visual similarity model, not face recognition. It cannot identify people. The 512-float embeddings represent abstract visual features, not biometric identity." },
		{ q: "Can I use a drawing instead of a photo?", a: "Yes! The CLIP model works on any image — drawing, cartoon, or photo. Matching is by visual similarity, not photorealism." },
	];
</script>

<svelte:head>
	<title>Find Your Child's Archetype — Storybook Workshop</title>
	<meta name="description" content="On-device CLIP matching: 100% private, zero uploads." />
</svelte:head>

<header class="hero">
	<div class="privacy-badge">
		<span>🔒</span> <strong>100% Private</strong> — your photo NEVER leaves this device
	</div>
	<h1>Find Your Child's Story Archetype</h1>
	<p class="subtitle">Drop a photo — our on-device AI matches it to one of 150 illustrated characters for a personalised storybook. Zero uploads.</p>
	<div class="network-counter" class:danger={uploadCount > 0}>
		<span class="dot" class:green={uploadCount === 0} class:red={uploadCount > 0}></span>
		Photo uploads: <strong>{uploadCount}</strong>
		{#if uploadCount === 0}<span class="ok">✓ Nothing sent to our servers</span>
		{:else}<span class="warn">⚠ Check DevTools → Network</span>{/if}
	</div>
</header>

<main class="demo-main">
	<nav class="demo-nav">
		<button class:active={view !== "gallery"} on:click={() => { if (view === "gallery") view = "home"; }}>Match a photo</button>
		<button class:active={view === "gallery"} on:click={() => { view = "gallery"; }}>Browse all {manifestRaw.length || 150}</button>
	</nav>

	{#if view === "gallery"}
		<section>
			<h2>All {manifestRaw.length} Archetypes</h2>
			<div class="filters">
				<input class="filter-input" type="text" placeholder="Search name, hair, vibe..." bind:value={galleryFilter} />
				<select class="filter-select" bind:value={galleryAgeBand}>
					<option value="">All ages</option>
					<option value="toddler">Toddler</option>
					<option value="preschool">Preschool</option>
					<option value="grade-school">Grade school</option>
				</select>
			</div>
			<div class="gallery-grid">
				{#each filteredGallery as e (e.pillarId)}
					<a href="/?pillarId={e.pillarId}" class="gallery-card" title={e.displayName}>
						<img src={e.previewUrl} alt={e.displayName} loading="lazy" />
						<span>{e.displayName}</span>
					</a>
				{/each}
				{#if filteredGallery.length === 0}<p class="empty">No archetypes match.</p>{/if}
			</div>
		</section>
	{:else}
		<section class="upload-section">
			<div class="drop-zone" class:dragging={isDragging}
				on:dragover|preventDefault={() => isDragging = true}
				on:dragleave={() => isDragging = false}
				on:drop={handleDrop}
				role="button" tabindex="0"
				on:click={() => fileInput.click()}
				on:keydown={(e) => e.key === "Enter" && fileInput.click()}
				aria-label="Drop a photo or click to browse">
				{#if photoUrl}
					<img src={photoUrl} alt="Selected" class="preview-img" />
					<p class="hint">Click to change</p>
				{:else}
					<div class="drop-icon">📷</div>
					<p class="hint">Drop a photo here, or click to browse</p>
					<p class="sub">JPG · PNG · WEBP · stays on your device</p>
				{/if}
			</div>
			<input bind:this={fileInput} type="file" accept="image/*" class="sr-only"
				on:change={handleFileSelect} aria-label="Upload photo" />

			<p class="samples-label">Or try a sample <a href="/demo-samples/LICENSES.md" target="_blank" rel="noopener" class="lic">(Unsplash-licensed)</a>:</p>
			<div class="samples-row">
				{#each DEMO_SAMPLES as url, i}
					<button class="sample-btn" on:click={() => useSample(url)} aria-label="Use sample {i+1}">
						<img src={url} alt="Sample {i+1}" loading="lazy"
							on:error={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
						<span class="sample-num">{i+1}</span>
					</button>
				{/each}
			</div>

			{#if matchError}<p class="error" role="alert">{matchError}</p>{/if}

			<div class="match-actions">
				<button class="match-btn" disabled={!photoFile || matching || !manifestLoaded} on:click={runMatch}>
					{#if matching}Analysing on-device...
					{:else if !manifestLoaded}Loading library...
					{:else if !photoFile}Select a photo first
					{:else}Find My Archetype &#8594;{/if}
				</button>
			</div>

			{#if view === "matching"}
				<div class="spinner-wrap" role="status" aria-live="polite">
					<div class="spinner"></div>
					<p>Running CLIP on your device — no network needed...</p>
				</div>
			{/if}
		</section>
	{/if}

	{#if view === "results"}
		<section class="results">
			<h2>Top 3 Matches</h2>
			<p class="results-note">Similarity from on-device CLIP. Photo discarded after analysis.</p>
			<div class="matches-grid">
				{#each matches as m, i}
					{@const entry = entryFor(m.pillarId)}
					<div class="match-card" class:top={i === 0}>
						{#if i === 0}<span class="best-badge">Best match</span>{/if}
						{#if entry}
							<a href="/?pillarId={m.pillarId}">
								<img src={entry.fullUrl} alt={entry.displayName} class="portrait" loading="eager" />
							</a>
						{/if}
						<div class="card-body">
							<h3>{entry?.displayName ?? `Archetype #${m.pillarId}`}</h3>
							<div class="tags">
								{#if entry}
									<span class="tag">{entry.axes.hair.replace(/-/g," ")}</span>
									<span class="tag">skin {entry.axes.skinTone}</span>
									<span class="tag">{entry.axes.ageBand}</span>
									<span class="tag">{entry.axes.clothingVibe.replace(/-/g," ")}</span>
									{#each (entry.axes.extras ?? []) as ex}<span class="tag ex">{ex}</span>{/each}
								{/if}
							</div>
							<div class="sim-wrap"><div class="sim-bar" style="width:{pct(m.similarity)}%"></div></div>
							<p class="sim-label">{pct(m.similarity)}% similarity</p>

							{#if entry && exampleBooks[entry.archetypeId]}
								{@const book = exampleBooks[entry.archetypeId]}
								<details class="book-details">
									<summary>📖 <em>{book.title}</em></summary>
									<div class="book-content">
										<div class="spreads">
											{#each ["cover","spread-setup","spread-midpoint","spread-climax","spread-trial","spread-resolution"] as s}
												<img src="/pillar-library-v2/example-books/{entry.archetypeId}/{s}.jpg"
													alt={s} class="spread" loading="lazy"
													on:error={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
											{/each}
										</div>
										<div class="beat-ribbon">
											{#each book.beats as beat}
												<div class="beat">
													<span class="beat-name">{beat.beat}</span>
													<p class="beat-text">{beat.storyText}</p>
													<p class="beat-hook">&#8617; {beat.pageTurnHook}</p>
												</div>
											{/each}
										</div>
										<blockquote class="refrain">
											"{book.refrain.setup}"
											<footer>— story refrain</footer>
										</blockquote>
									</div>
								</details>
							{/if}
							<a class="cta" href="/?pillarId={m.pillarId}">Start a book with this hero &#8594;</a>
						</div>
					</div>
				{/each}
			</div>
			<div class="result-actions">
				<button class="sec-btn" on:click={() => { view="home"; photoUrl=null; photoFile=null; matches=[]; }}>
					&#8592; Try another photo
				</button>
				<button class="sec-btn" on:click={() => { view="gallery"; }}>Browse all</button>
			</div>
		</section>
	{/if}
</main>

<section class="faq">
	<h2>Privacy FAQ</h2>
	<p class="devtools-challenge">
		<strong>DevTools challenge:</strong> open the Network tab <em>before</em> uploading a photo.
		Watch the counter above — it stays at 0. Your photo never leaves your browser.
	</p>
	<ul class="faq-list">
		{#each FAQ as item, i}
			<li>
				<button class="faq-q" on:click={() => faqOpen = {...faqOpen, [i]: !faqOpen[i]}}
					aria-expanded={!!faqOpen[i]}>
					{item.q} <span>{faqOpen[i] ? "▲" : "▼"}</span>
				</button>
				{#if faqOpen[i]}<p class="faq-a">{item.a}</p>{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	:global(body) { font-family: system-ui,sans-serif; margin: 0; background: #0f0f14; color: #e8e8f0; }
	.hero { text-align: center; padding: 3rem 1.5rem 2rem; background: linear-gradient(135deg,#1a1a2e,#16213e,#0f3460); }
	.privacy-badge {
		display: inline-flex; align-items: center; gap: .5rem;
		background: rgba(0,200,100,.12); border: 1px solid rgba(0,200,100,.35);
		border-radius: 2rem; padding: .35rem .9rem; font-size: .88rem; color: #6effa8; margin-bottom: 1.25rem;
	}
	h1 {
		font-size: clamp(1.8rem,4vw,3rem); font-weight: 800; margin: 0 0 .75rem;
		background: linear-gradient(135deg,#e8e8ff,#a0a8ff);
		-webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
	}
	.subtitle { max-width: 580px; margin: 0 auto 1.5rem; color: #9090b0; font-size: 1rem; }
	.network-counter {
		display: inline-flex; align-items: center; gap: .5rem;
		background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
		border-radius: .5rem; padding: .35rem .8rem; font-size: .82rem; font-family: monospace;
	}
	.network-counter.danger { border-color: rgba(255,80,80,.45); color: #ff8080; }
	.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
	.dot.green { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
	.dot.red { background: #f87171; box-shadow: 0 0 6px #f87171; }
	.ok { color: #6effa8; font-size: .78rem; }
	.warn { color: #f87171; font-size: .78rem; }
	.demo-main { max-width: 900px; margin: 0 auto; padding: 1.25rem 1.5rem; }
	.demo-nav { display: flex; gap: .5rem; margin-bottom: 1.25rem; }
	.demo-nav button {
		background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
		border-radius: .4rem; color: #9090b0; padding: .38rem .9rem; cursor: pointer; font-size: .88rem;
	}
	.demo-nav button.active { background: rgba(160,168,255,.13); border-color: rgba(160,168,255,.38); color: #a0a8ff; }
	.upload-section { max-width: 520px; margin: 0 auto; }
	.drop-zone {
		border: 2px dashed rgba(160,168,255,.28); border-radius: 1rem; padding: 2.25rem;
		text-align: center; cursor: pointer; min-height: 160px;
		display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .4rem;
		background: rgba(255,255,255,.015); transition: all .18s;
	}
	.drop-zone:hover,.drop-zone.dragging { border-color: rgba(160,168,255,.65); background: rgba(160,168,255,.04); }
	.drop-icon { font-size: 2.4rem; }
	.hint { color: #a0a8ff; font-size: .95rem; margin: 0; }
	.sub { color: #5050a0; font-size: .78rem; margin: 0; }
	.preview-img { max-height: 190px; max-width: 100%; border-radius: .5rem; object-fit: cover; }
	.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
	.samples-label { color: #5050a0; font-size: .82rem; margin: 1.25rem 0 .4rem; }
	.lic { color: #4040a0; font-size: .75rem; }
	.samples-row { display: flex; gap: .4rem; flex-wrap: wrap; }
	.sample-btn {
		position: relative; width: 58px; height: 58px; border-radius: .4rem;
		border: 2px solid rgba(255,255,255,.08); overflow: hidden;
		cursor: pointer; background: rgba(255,255,255,.04); padding: 0;
	}
	.sample-btn img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.sample-num {
		position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
		color: #5050a0; font-size: 1.1rem; pointer-events: none;
	}
	.error { color: #f87171; background: rgba(248,113,113,.09); border: 1px solid rgba(248,113,113,.28);
		border-radius: .4rem; padding: .45rem .7rem; font-size: .83rem; margin-top: .6rem; }
	.match-actions { margin-top: 1.25rem; text-align: center; }
	.match-btn {
		background: linear-gradient(135deg,#4040c0,#8040d0); color: #fff; border: none;
		border-radius: .55rem; padding: .7rem 1.8rem; font-size: .95rem; font-weight: 600;
		cursor: pointer; min-width: 200px; transition: opacity .15s;
	}
	.match-btn:disabled { opacity: .38; cursor: not-allowed; }
	.spinner-wrap { text-align: center; margin-top: 1.75rem; color: #9090b0; }
	.spinner {
		width: 38px; height: 38px; border: 3px solid rgba(160,168,255,.18);
		border-top-color: #a0a8ff; border-radius: 50%; animation: spin .8s linear infinite; margin: 0 auto .9rem;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.results { padding-top: .25rem; }
	.results-note { color: #5050a0; font-size: .82rem; margin-bottom: 1.25rem; }
	.matches-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(250px,1fr)); gap: 1.1rem; }
	.match-card {
		background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.07);
		border-radius: .75rem; overflow: hidden; position: relative;
	}
	.match-card.top { border-color: rgba(160,168,255,.38); box-shadow: 0 0 18px rgba(160,168,255,.08); }
	.best-badge {
		position: absolute; top: .45rem; right: .45rem;
		background: linear-gradient(135deg,#4040c0,#8040d0); color: #fff;
		font-size: .65rem; padding: .18rem .55rem; border-radius: 1rem;
		font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
	}
	.portrait { width: 100%; height: 190px; object-fit: cover; display: block; }
	.card-body { padding: .9rem; }
	.card-body h3 { margin: 0 0 .45rem; font-size: .95rem; }
	.tags { display: flex; flex-wrap: wrap; gap: .28rem; margin-bottom: .65rem; }
	.tag { background: rgba(255,255,255,.055); border-radius: .22rem; padding: .12rem .4rem; font-size: .68rem; color: #9090b0; }
	.tag.ex { color: #a0a8ff; background: rgba(160,168,255,.09); }
	.sim-wrap { background: rgba(255,255,255,.04); border-radius: .22rem; height: 7px; overflow: hidden; }
	.sim-bar { height: 100%; background: linear-gradient(90deg,#4040c0,#a040d0); border-radius: .22rem; transition: width .5s; }
	.sim-label { font-size: .7rem; color: #5050a0; margin: .25rem 0 0; }
	.book-details { margin-top: .65rem; }
	.book-details summary { cursor: pointer; font-size: .82rem; color: #a0a8ff; }
	.book-content { margin-top: .4rem; }
	.spreads { display: flex; gap: .28rem; overflow-x: auto; margin-bottom: .6rem; }
	.spread { height: 72px; width: auto; border-radius: .22rem; object-fit: cover; flex-shrink: 0; }
	.beat-ribbon { display: grid; grid-template-columns: repeat(7,1fr); gap: .2rem; overflow-x: auto; margin-bottom: .45rem; }
	.beat { background: rgba(255,255,255,.025); border-radius: .25rem; padding: .25rem .35rem; min-width: 72px; }
	.beat-name { font-size: .6rem; font-weight: 700; text-transform: uppercase; color: #a0a8ff; letter-spacing: .05em; }
	.beat-text { font-size: .65rem; color: #9090b0; margin: .15rem 0; line-height: 1.25; }
	.beat-hook { font-size: .6rem; color: #5050a0; margin: 0; font-style: italic; }
	.refrain { border-left: 2px solid rgba(160,168,255,.35); padding-left: .65rem; color: #c0c0e0; font-style: italic; font-size: .82rem; margin: .4rem 0; }
	.refrain footer { font-size: .7rem; color: #5050a0; font-style: normal; margin-top: .2rem; }
	.cta {
		display: inline-block; margin-top: .65rem;
		background: linear-gradient(135deg,#4040c0,#8040d0); color: #fff; text-decoration: none;
		border-radius: .38rem; padding: .38rem .8rem; font-size: .82rem; font-weight: 600;
	}
	.result-actions { display: flex; gap: .65rem; margin-top: 1.75rem; flex-wrap: wrap; }
	.sec-btn {
		background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1);
		border-radius: .38rem; color: #9090b0; padding: .45rem .9rem; cursor: pointer; font-size: .88rem;
	}
	.filters { display: flex; gap: .65rem; margin-bottom: .9rem; flex-wrap: wrap; }
	.filter-input,.filter-select {
		background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
		border-radius: .38rem; color: #e8e8f0; padding: .35rem .65rem; font-size: .88rem;
	}
	.filter-input { flex: 1; min-width: 140px; }
	.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(90px,1fr)); gap: .45rem; }
	.gallery-card { text-decoration: none; text-align: center; }
	.gallery-card img {
		width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: .35rem; display: block;
		border: 2px solid transparent; transition: border-color .15s;
	}
	.gallery-card:hover img { border-color: rgba(160,168,255,.55); }
	.gallery-card span { font-size: .62rem; color: #5050a0; display: block; margin-top: .18rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.empty { color: #5050a0; grid-column: 1/-1; }
	.faq { max-width: 680px; margin: 3rem auto 4rem; padding: 0 1.5rem; }
	.faq h2 { font-size: 1.35rem; margin-bottom: .5rem; }
	.devtools-challenge {
		background: rgba(0,200,100,.06); border: 1px solid rgba(0,200,100,.18);
		border-radius: .45rem; padding: .65rem .9rem; font-size: .83rem; color: #80c090; margin-bottom: 1.25rem;
	}
	.faq-list { list-style: none; padding: 0; margin: 0; }
	.faq-list li { border-bottom: 1px solid rgba(255,255,255,.06); }
	.faq-q {
		background: none; border: none; width: 100%; text-align: left;
		padding: .9rem 0; font-size: .9rem; color: #c0c0e0; cursor: pointer;
		display: flex; justify-content: space-between; align-items: center; gap: .4rem;
	}
	.faq-q span { color: #5050a0; flex-shrink: 0; }
	.faq-a { padding: 0 0 .9rem; color: #9090b0; font-size: .85rem; line-height: 1.55; margin: 0; }
</style>
