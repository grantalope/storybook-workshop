import type { AgeBand, StoryTheme } from '$lib/services/author/types';
import type { ConflictClass, StakesLevel } from './types';

export const CONFLICT_THEME_COMPAT: Record<ConflictClass, StoryTheme[]> = {
	'lost-thing': ['lost-and-found', 'bedtime', 'silly-quest'],
	'new-experience': ['first-day', 'new-baby-arrives', 'saying-goodbye', 'curiosity'],
	'friendship-rift': ['friendship', 'sibling-rivalry', 'kindness'],
	'fear-to-face': ['overcoming-fear', 'first-day', 'bedtime'],
	'big-task': ['adventure', 'silly-quest', 'curiosity', 'kindness'],
} as const;

export const STAKES_LADDER: StakesLevel[] = [
	'comfort-object',
	'routine-change',
	'social-bond',
	'self-mastery',
	'community',
];

export const MAX_STAKES_BY_AGE: Record<AgeBand, StakesLevel> = {
	toddler: 'routine-change',
	preschool: 'social-bond',
	'grade-school': 'community',
} as const;

export const REFRAIN_WORD_RANGE_BY_AGE: Record<
	AgeBand,
	{ minWords: number; maxWords: number }
> = {
	toddler: { minWords: 4, maxWords: 6 },
	preschool: { minWords: 6, maxWords: 9 },
	'grade-school': { minWords: 8, maxWords: 12 },
} as const;

export const EMOTIONAL_ARC_RULES = {
	beat1Min: 0,
	preClimaxDipBeats: [4, 5, 6],
	preClimaxDipDelta: 0.3,
	beat7Min: 0.5,
	nonDecreasingFromDipThroughBeat7: true,
} as const;
