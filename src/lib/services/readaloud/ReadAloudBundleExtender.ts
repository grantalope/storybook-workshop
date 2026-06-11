import type { ReadAlongBundle } from '$lib/services/assemble/types';
import type { SceneTree } from '$lib/services/author/types';
import { annotateTier2 } from './Tier2Annotator';
import { buildPhonicsMap } from './PhonicsMapper';
import { generateQuiz } from './QuizGenerator';
import type { EduOverlayBundle, WordTiming } from './types';

const WORD_RE = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;

export interface ReadAloudBundleExtenderArgs {
	sceneTree: SceneTree;
	wordTimings?: Record<number, WordTiming[]>;
}

export function extendReadAlongBundle(
	bundle: ReadAlongBundle,
	args: ReadAloudBundleExtenderArgs
): ReadAlongBundle {
	const spreadTexts = bundle.spreads.map((spread) => spread.text);
	const edu: EduOverlayBundle = {
		phonicsMap: buildPhonicsMap(uniqueWords(spreadTexts)),
		tier2Annotations: annotateTier2(spreadTexts, args.sceneTree.tier2_words),
		dialogicPrompts: [...(args.sceneTree.dialogic_prompts ?? [])],
		quiz: generateQuiz(args.sceneTree)
	};
	if (args.wordTimings) {
		edu.wordTimings = copyWordTimings(args.wordTimings);
	}
	return { ...bundle, edu };
}

function uniqueWords(spreadTexts: string[]): string[] {
	const words = new Set<string>();
	for (const text of spreadTexts) {
		for (const match of text.matchAll(WORD_RE)) {
			words.add(match[0].toLocaleLowerCase('en-US'));
		}
	}
	return Array.from(words).sort();
}

function copyWordTimings(wordTimings: Record<number, WordTiming[]>): Record<number, WordTiming[]> {
	return Object.fromEntries(
		Object.entries(wordTimings).map(([spreadIndex, timings]) => [
			spreadIndex,
			timings.map((timing) => ({ ...timing }))
		])
	);
}
