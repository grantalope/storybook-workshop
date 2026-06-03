<script lang="ts">
	import type { StationId } from '$lib/workshop/types';

	export let station: StationId | null;

	const BANTER: Record<string, string> = {
		s1: "Welcome to the workshop. Pick the shape of your story — I'll help you fit it together.",
		s2: 'Now to forge your hero. Pick a tile that feels right.',
		s3: 'Every book carries one wish. What do you want them to hear?',
		s4: 'A hero needs friends. Who travels with them?',
		s5: 'Time to dress the story. Three styles, one fits.',
		s6: "I'm pulling the pages together. Last chance to redo anything.",
		s7: "It's yours. Take it home digital, or send it to the press.",
		'kid-picker': 'Who are we making a book for today?',
		library: 'Your shelf. Every book lives here forever.',
	};

	$: line = station ? BANTER[station] ?? 'Step right in.' : 'Step right in.';
</script>

<header class="host">
	<div class="portrait" />
	<div class="bubble">{line}</div>
</header>

<style>
	.host {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.85rem;
		background: linear-gradient(135deg, #f8f5e6, #fff);
		border: 1px solid #ddd;
		border-radius: 12px;
		margin: 0.5rem 0;
	}
	.portrait {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		flex-shrink: 0;
		background: conic-gradient(from 0deg, #fbbf24, #fde68a, #d4a017, #fbbf24);
	}
	.bubble {
		position: relative;
		padding: 0.5rem 0.85rem;
		background: white;
		border: 1px solid #ccc;
		border-radius: 12px;
		font-style: italic;
		color: #444;
	}
</style>
