<script lang="ts">
	import type { QuizQuestion } from '$lib/services/readaloud/types';

	let { questions }: { questions: QuizQuestion[] } = $props();

	let index = $state(0);
	let selected = $state<number | null>(null);
	const current = $derived(questions[index]);
	const answered = $derived(selected !== null);
	const correct = $derived(current && selected === current.correctIndex);

	function choose(optionIndex: number) {
		selected = optionIndex;
	}

	function next() {
		if (index < questions.length - 1) {
			index++;
			selected = null;
		}
	}
</script>

{#if current}
	<section class="quiz-panel" aria-live="polite">
		<p class="counter">Question {index + 1} of {questions.length}</p>
		<h2>{current.prompt}</h2>
		<div class="options">
			{#each current.options as option, optionIndex (option)}
				<button
					type="button"
					class:chosen={selected === optionIndex}
					class:correct={answered && current.correctIndex === optionIndex}
					onclick={() => choose(optionIndex)}
				>
					{option}
				</button>
			{/each}
		</div>
		{#if answered}
			<p class:ok={correct} class:try-again={!correct}>
				{correct ? 'Right.' : `Try this one: ${current.options[current.correctIndex]}`}
			</p>
			{#if index < questions.length - 1}
				<button type="button" class="next" onclick={next}>Next</button>
			{/if}
		{/if}
	</section>
{/if}

<style>
	.quiz-panel {
		padding: 18px;
		border: 1px solid #c9d4df;
		border-radius: 8px;
		background: #f8fbff;
	}
	.counter {
		margin: 0 0 4px;
		color: #5c6b78;
		font-size: 0.88rem;
		font-weight: 700;
	}
	h2 {
		margin: 0 0 14px;
		font-size: 1.25rem;
	}
	.options {
		display: grid;
		gap: 8px;
	}
	button {
		border: 1px solid #c9d4df;
		border-radius: 8px;
		background: #ffffff;
		color: #172635;
		padding: 10px 12px;
		text-align: left;
		cursor: pointer;
	}
	button.chosen {
		border-color: #204d74;
	}
	button.correct {
		border-color: #2f855a;
		background: #eaf7ef;
	}
	.ok,
	.try-again {
		margin: 12px 0 0;
		font-weight: 700;
	}
	.ok {
		color: #276749;
	}
	.try-again {
		color: #8a4b13;
	}
	.next {
		margin-top: 12px;
		background: #204d74;
		color: #ffffff;
		text-align: center;
	}
</style>
