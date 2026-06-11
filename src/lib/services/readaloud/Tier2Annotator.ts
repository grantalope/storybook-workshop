import { TIER2_VOCAB_CORPUS_DEDUPED } from '$lib/services/author/tier2-vocab-corpus';
import type { Tier2Annotation } from './types';

const DEFINITION_BY_WORD = new Map(
	TIER2_VOCAB_CORPUS_DEDUPED.map((entry) => [entry.word.toLocaleLowerCase('en-US'), entry.definition_kid])
);

export function annotateTier2(resolvedSpreadTexts: string[], tier2Words: string[]): Tier2Annotation[] {
	const annotations: Tier2Annotation[] = [];
	const missingDefinitionWarnings = new Set<string>();
	const uniqueWords = Array.from(
		new Set(tier2Words.map((word) => word.trim().toLocaleLowerCase('en-US')).filter(Boolean))
	).sort();

	for (const word of uniqueWords) {
		const definitionKid = DEFINITION_BY_WORD.get(word) ?? '';
		const matcher = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
		for (let spreadIndex = 0; spreadIndex < resolvedSpreadTexts.length; spreadIndex++) {
			const text = resolvedSpreadTexts[spreadIndex] ?? '';
			for (const match of text.matchAll(matcher)) {
				if (!definitionKid && !missingDefinitionWarnings.has(word)) {
					console.warn(`Tier2Annotator: missing corpus definition for "${word}"`);
					missingDefinitionWarnings.add(word);
				}
				const charStart = match.index ?? 0;
				annotations.push({
					word: match[0],
					spreadIndex,
					charStart,
					charEnd: charStart + match[0].length,
					definitionKid
				});
			}
		}
	}

	return annotations.sort((a, b) => a.spreadIndex - b.spreadIndex || a.charStart - b.charStart || a.word.localeCompare(b.word));
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
