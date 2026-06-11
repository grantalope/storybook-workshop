import { BEAT_NAMES } from '$lib/services/author/types';
import type { BeatId, StoryInput } from '$lib/services/author/types';
import type { BeatBrief, ConflictClass, StorySkeleton } from './types';

const BEAT_IDS: BeatId[] = [1, 2, 3, 4, 5, 6, 7];
const TIER2_BEATS: BeatId[] = [2, 3, 4, 5, 6];

const CONFLICT_FOCUS: Record<ConflictClass, Record<BeatId, string>> = {
	'lost-thing': {
		1: 'The beloved thing matters before it goes missing.',
		2: 'The loss becomes clear and age-sized.',
		3: 'The hero decides what the missing thing means.',
		4: 'The hero searches with a first concrete plan.',
		5: 'The search creates a setback or clue.',
		6: 'The hero uses the clue to resolve the loss.',
		7: 'The found thing changes how home feels.',
	},
	'new-experience': {
		1: 'The ordinary world feels known and safe.',
		2: 'A new place or role asks the hero to step forward.',
		3: 'The hero weighs worry against curiosity.',
		4: 'The hero tries one small new action.',
		5: 'The new action becomes messier than expected.',
		6: 'The hero chooses the next brave step.',
		7: 'The new experience becomes part of the hero.',
	},
	'friendship-rift': {
		1: 'The bond is visible before the rift.',
		2: 'A misunderstanding or hurt opens space between friends.',
		3: 'The hero notices what the rift feels like.',
		4: 'The hero attempts repair through action.',
		5: 'The first repair attempt is incomplete.',
		6: 'The hero names or shows the needed kindness.',
		7: 'The relationship settles into a warmer shape.',
	},
	'fear-to-face': {
		1: 'The safe world contains a small shadow of worry.',
		2: 'The fear steps into the path.',
		3: 'The hero shows worry through body and action.',
		4: 'The hero approaches the fear in one small step.',
		5: 'The fear grows before it shrinks.',
		6: 'The hero faces the fear directly.',
		7: 'The world feels safe with new bravery inside it.',
	},
	'big-task': {
		1: 'The task is hinted before it begins.',
		2: 'The task becomes too big for one easy answer.',
		3: 'The hero chooses a reason to try.',
		4: 'The hero breaks the task into a visible step.',
		5: 'The step has a consequence that tests resolve.',
		6: 'The hero completes the key action.',
		7: 'The completed task leaves a gift or joke behind.',
	},
};

export function renderBeatBriefs(
	skeleton: StorySkeleton,
	input: StoryInput,
	tier2Words: string[],
): BeatBrief[] {
	const assignedWords = assignTier2Words(tier2Words);
	const briefs = BEAT_IDS.map((beatId) => {
		const refrainLine = refrainForBeat(skeleton, beatId);
		const settingNote = settingForBeat(skeleton, beatId);
		const sidekickNote = `The sidekick acts as ${articleFor(skeleton.sidekickRole)} ${skeleton.sidekickRole} and supports the hero without solving the climax.`;
		const agency =
			beatId === 6 ? ' The hero, not the sidekick, resolves the problem.' : '';
		const refrainInstruction = refrainLine ? ` Use the refrain: "${refrainLine}".` : '';
		const brief = [
			`Beat ${beatId} (${BEAT_NAMES[beatId]}): the hero follows the ${skeleton.conflictClass} arc.`,
			CONFLICT_FOCUS[skeleton.conflictClass][beatId],
			settingNote,
			sidekickNote,
			refrainInstruction.trim(),
			agency.trim(),
		]
			.filter(Boolean)
			.join(' ');

		return {
			beatId,
			beatName: BEAT_NAMES[beatId],
			valence: skeleton.emotionalArc[beatId],
			sceneCount: skeleton.beatSceneCounts[beatId],
			spreadBudget: skeleton.beatSpreadBudgets[beatId],
			conflictFocus: CONFLICT_FOCUS[skeleton.conflictClass][beatId],
			...(refrainLine ? { refrainLine } : {}),
			...(beatId === skeleton.refrain.climaxMutation.beat
				? { refrainIsMutated: true }
				: {}),
			tier2Words: assignedWords[beatId],
			sidekickNote,
			settingNote,
			brief,
		};
	});

	assertNoKidNameLeak(briefs, input.kidName);
	return briefs;
}

function assignTier2Words(tier2Words: string[]): Record<BeatId, string[]> {
	const assigned = {
		1: [],
		2: [],
		3: [],
		4: [],
		5: [],
		6: [],
		7: [],
	} as Record<BeatId, string[]>;

	tier2Words.forEach((word, index) => {
		assigned[TIER2_BEATS[index % TIER2_BEATS.length]].push(word);
	});
	return assigned;
}

function refrainForBeat(skeleton: StorySkeleton, beatId: BeatId): string | undefined {
	const isPlacement = skeleton.refrain.placementBeats.includes(beatId);
	const isMutationBeat = beatId === skeleton.refrain.climaxMutation.beat;
	if (!isPlacement && !isMutationBeat) return undefined;
	if (!isMutationBeat) return skeleton.refrain.line;
	return mutateRefrain(skeleton.refrain.line, skeleton.refrain.climaxMutation.swapWordIndex);
}

function mutateRefrain(line: string, swapWordIndex: number): string {
	const words = line.split(/\s+/);
	const safeIndex = Math.max(0, Math.min(words.length - 1, swapWordIndex));
	words[safeIndex] = 'Brave';
	return words.join(' ');
}

function settingForBeat(skeleton: StorySkeleton, beatId: BeatId): string {
	if (beatId <= 2) return `Setting: start in the ${skeleton.settingArc.start}.`;
	if (beatId <= 5) return `Setting: excursion through the ${skeleton.settingArc.excursion}.`;
	return `Setting: return leg toward the ${skeleton.settingArc.return}.`;
}

function articleFor(role: string): string {
	return /^[aeiou]/i.test(role) ? 'an' : 'a';
}

function assertNoKidNameLeak(briefs: BeatBrief[], kidName: string): void {
	const name = kidName.trim().toLowerCase();
	if (!name) return;
	const serialized = JSON.stringify(briefs).toLowerCase();
	if (serialized.includes(name)) {
		throw new Error('Beat briefs must not include the kid name');
	}
}
