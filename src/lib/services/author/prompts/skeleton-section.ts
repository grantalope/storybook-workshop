import type { BeatBrief } from '$lib/services/storygrammar';

export function appendSkeletonSection(userMsg: string, briefs: BeatBrief[]): string {
	const lines = [
		userMsg,
		'',
		'## Story skeleton (follow exactly)',
		...briefs.map((brief) =>
			[
				`beat ${brief.beatId} (${brief.beatName})`,
				`valence: ${brief.valence}`,
				`scenes: ${brief.sceneCount}`,
				`spreads: ${brief.spreadBudget}`,
				`conflict_focus: ${brief.conflictFocus}`,
				`setting: ${brief.settingNote}`,
				`sidekick: ${brief.sidekickNote}`,
				brief.refrainLine ? `refrain: ${brief.refrainLine}` : '',
				brief.refrainIsMutated ? 'refrain_mutated: yes' : '',
				brief.tier2Words.length ? `tier2_words: ${brief.tier2Words.join(', ')}` : '',
				`brief: ${brief.brief}`,
			]
				.filter(Boolean)
				.join('\n'),
		),
	];
	return lines.join('\n');
}
