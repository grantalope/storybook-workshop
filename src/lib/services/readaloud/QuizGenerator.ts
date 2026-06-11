import type { Beat, BeatId, SceneTree } from '$lib/services/author/types';
import type { QuizQuestion } from './types';

type OptionItem = { text: string; correct: boolean };

export function generateQuiz(tree: SceneTree): QuizQuestion[] {
	const beat2 = findBeat(tree, 2);
	const beat5 = findBeat(tree, 5);
	const beat6 = findBeat(tree, 6);
	const beat7 = findBeat(tree, 7);

	return [
		makeQuestion(
			tree.title,
			'recall',
			'What happened at the start of the adventure?',
			firstSpreadText(beat2, 'The adventure began.'),
			[firstSpreadText(beat5, 'A later challenge appeared.'), firstSpreadText(beat7, 'Everyone found a new ending.')]
		),
		makeQuestion(
			tree.title,
			'sequence',
			'Which happened first?',
			firstSpreadText(beat2, 'The first surprise appeared.'),
			[firstSpreadText(beat6, 'The biggest moment happened.'), firstSpreadText(beat5, 'The team tried again.')]
		),
		makeQuestion(
			tree.title,
			'feeling',
			'How did everyone feel at the end?',
			emotionalTail(beat7?.emotional_arc ?? 'happy'),
			['worried', 'curious']
		)
	];
}

function findBeat(tree: SceneTree, id: BeatId): Beat | undefined {
	return tree.beats.find((beat) => beat.id === id);
}

function firstSpreadText(beat: Beat | undefined, fallback: string): string {
	return truncateOption(beat?.scenes[0]?.spreads[0]?.spread_text ?? fallback);
}

function emotionalTail(arc: string): string {
	const parts = arc.split(/\s*(?:->|→|=>|—|-)\s*/).filter(Boolean);
	return truncateOption(parts.at(-1)?.trim() || arc.trim() || 'happy');
}

function makeQuestion(
	title: string,
	type: QuizQuestion['type'],
	prompt: string,
	correct: string,
	distractors: [string, string]
): QuizQuestion {
	const items = uniqueOptions(correct, distractors);
	const shuffled = shuffle(items, fnv1a(`${title}:${type}`));
	const correctIndex = shuffled.findIndex((item) => item.correct) as 0 | 1 | 2;
	return {
		type,
		prompt,
		options: shuffled.map((item) => item.text) as [string, string, string],
		correctIndex
	};
}

function uniqueOptions(correct: string, distractors: [string, string]): [OptionItem, OptionItem, OptionItem] {
	const fallbacks = ['They solved a problem.', 'They asked for help.', 'They took a careful step.'];
	const out: OptionItem[] = [{ text: truncateOption(correct), correct: true }];
	for (const raw of distractors) {
		let text = truncateOption(raw);
		if (!text || out.some((item) => item.text === text)) {
			text = fallbacks.find((fallback) => !out.some((item) => item.text === fallback)) ?? `Choice ${out.length + 1}`;
		}
		out.push({ text, correct: false });
	}
	return out as [OptionItem, OptionItem, OptionItem];
}

function truncateOption(value: string): string {
	const compact = value.replace(/\s+/g, ' ').trim();
	if (compact.length <= 60) return compact;
	return `${compact.slice(0, 57).trimEnd()}...`;
}

function shuffle(items: [OptionItem, OptionItem, OptionItem], seed: number): [OptionItem, OptionItem, OptionItem] {
	const rng = mulberry32(seed);
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out as [OptionItem, OptionItem, OptionItem];
}

function fnv1a(value: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
