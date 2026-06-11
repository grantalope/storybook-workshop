import { describe, expect, it, vi } from 'vitest';
import { TIER2_VOCAB_CORPUS_DEDUPED } from '$lib/services/author/tier2-vocab-corpus';
import { annotateTier2 } from '$lib/services/readaloud/Tier2Annotator';

function definitionFor(word: string): string {
	const entry = TIER2_VOCAB_CORPUS_DEDUPED.find((candidate) => candidate.word === word);
	if (!entry) throw new Error(`Missing fixture word ${word}`);
	return entry.definition_kid;
}

describe('annotateTier2', () => {
	it('finds whole-word positions across spreads with corpus definitions', () => {
		const annotations = annotateTier2(
			['Eli felt brave in the cave.', 'A cozy blanket made the cave glow.'],
			['brave', 'cozy']
		);

		expect(annotations).toEqual([
			{ word: 'brave', spreadIndex: 0, charStart: 9, charEnd: 14, definitionKid: definitionFor('brave') },
			{ word: 'cozy', spreadIndex: 1, charStart: 2, charEnd: 6, definitionKid: definitionFor('cozy') }
		]);
	});

	it('returns no annotations when a planned word is absent from all spread text', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		expect(annotateTier2(['No target word here.'], ['brave'])).toEqual([]);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
