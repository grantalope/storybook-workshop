import { storyBudgetAllocator } from '$lib/services/author/StoryBudgetAllocator';
import type { BeatId, LocaleBiome, StoryInput, StoryTheme } from '$lib/services/author/types';
import {
	CONFLICT_THEME_COMPAT,
	MAX_STAKES_BY_AGE,
	REFRAIN_WORD_RANGE_BY_AGE,
	STAKES_LADDER,
} from './constraintTables';
import { hashSeed, mulberry32 } from './seededRng';
import type {
	ConflictClass,
	EndingType,
	SidekickRole,
	StakesLevel,
	StorySkeleton,
} from './types';

const BEAT_IDS: BeatId[] = [1, 2, 3, 4, 5, 6, 7];

const LOCALE_BIOMES: LocaleBiome[] = [
	'forest',
	'seaside',
	'mountain',
	'desert',
	'meadow',
	'snowfield',
	'jungle',
	'urban',
	'farm',
	'underwater',
	'space',
	'imaginary',
];

const CIRCULAR_RETURN_THEMES = new Set<StoryTheme>([
	'bedtime',
	'lost-and-found',
	'saying-goodbye',
]);

const SIDEKICK_ROLES: SidekickRole[] = ['helper', 'comic', 'conscience'];

const ENDING_TYPES: EndingType[] = [
	'circular-callback',
	'quiet-warmth',
	'lesson-named',
	'joke-button',
	'gift-forward',
];

const THEME_MOTIFS: Record<StoryTheme, string> = {
	bedtime: 'moon',
	'first-day': 'door',
	'lost-and-found': 'lantern',
	'overcoming-fear': 'glow',
	'new-baby-arrives': 'nest',
	kindness: 'hand',
	adventure: 'trail',
	curiosity: 'spark',
	friendship: 'ribbon',
	'sibling-rivalry': 'turn',
	'saying-goodbye': 'wave',
	'silly-quest': 'wiggle',
};

export function collapseSkeleton(
	input: StoryInput,
	opts: { seed?: number } = {},
): StorySkeleton {
	const seedUsed =
		opts.seed ??
		hashSeed(
			input.theme,
			input.ageBand,
			input.targetSpreads,
			input.sidekickSettlerId,
			input.localeBiome,
		);
	const rng = mulberry32(seedUsed);

	const conflictClass = collapseConflictClass(input.theme, rng);
	const stakes = collapseStakes(input.ageBand, rng);
	const excursion = pick(
		LOCALE_BIOMES.filter((biome) => biome !== input.localeBiome),
		rng,
	);
	const returnBiome = CIRCULAR_RETURN_THEMES.has(input.theme)
		? input.localeBiome
		: pick(LOCALE_BIOMES, rng);
	const beatSpreadBudgets = storyBudgetAllocator.allocate(input.targetSpreads);

	return {
		seedUsed,
		theme: input.theme,
		conflictClass,
		stakes,
		settingArc: {
			start: input.localeBiome,
			excursion,
			return: returnBiome,
		},
		refrain: buildRefrain(input.theme, input.ageBand),
		sidekickRole: pick(SIDEKICK_ROLES, rng),
		endingType: pick(ENDING_TYPES, rng),
		beatSceneCounts: splitBeatSceneCounts(beatSpreadBudgets, rng),
		beatSpreadBudgets,
		emotionalArc: buildEmotionalArc(rng),
	};
}

function collapseConflictClass(theme: StoryTheme, rng: () => number): ConflictClass {
	const compatible = (Object.keys(CONFLICT_THEME_COMPAT) as ConflictClass[]).filter((conflict) =>
		CONFLICT_THEME_COMPAT[conflict].includes(theme),
	);
	if (compatible.length === 0) {
		throw new Error(`CONFLICT_THEME_COMPAT has no conflict class for theme "${theme}"`);
	}
	return pick(compatible, rng);
}

function collapseStakes(ageBand: StoryInput['ageBand'], rng: () => number): StakesLevel {
	const max = MAX_STAKES_BY_AGE[ageBand];
	const maxIndex = STAKES_LADDER.indexOf(max);
	if (maxIndex < 0) throw new Error(`MAX_STAKES_BY_AGE has invalid value "${max}"`);
	return pick(STAKES_LADDER.slice(0, maxIndex + 1), rng);
}

function buildRefrain(theme: StoryTheme, ageBand: StoryInput['ageBand']) {
	const range = REFRAIN_WORD_RANGE_BY_AGE[ageBand];
	const motif = THEME_MOTIFS[theme];
	const line =
		ageBand === 'toddler'
			? `${capitalize(motif)} says, try one step`
			: ageBand === 'preschool'
				? `${capitalize(motif)} by ${motif}, show the way home`
				: `Step by steady step, the ${motif} shows the way home`;
	const count = wordCount(line);
	if (count < range.minWords || count > range.maxWords) {
		throw new Error(
			`refrain "${line}" has ${count} words, outside ${range.minWords}-${range.maxWords}`,
		);
	}
	return {
		line,
		minWords: range.minWords,
		maxWords: range.maxWords,
		placementBeats: [1, 6, 7] as BeatId[],
		climaxMutation: { beat: 6 as BeatId, swapWordIndex: 0 },
	};
}

function buildEmotionalArc(rng: () => number): Record<BeatId, number> {
	const beat1 = 0.15 + rng() * 0.1;
	const beat2 = beat1 - 0.05 - rng() * 0.08;
	const beat3 = beat2 - 0.05 - rng() * 0.08;
	const dip = beat1 - 0.35 - rng() * 0.1;
	const beat5 = dip + 0.05 + rng() * 0.05;
	const beat6 = beat5 + 0.25 + rng() * 0.1;
	const beat7 = Math.max(0.5, beat6 + 0.2 + rng() * 0.1);

	return {
		1: rounded(clamp(beat1, -1, 1)),
		2: rounded(clamp(beat2, -1, 1)),
		3: rounded(clamp(beat3, -1, 1)),
		4: rounded(clamp(dip, -1, 1)),
		5: rounded(clamp(beat5, -1, 1)),
		6: rounded(clamp(beat6, -1, 1)),
		7: rounded(clamp(beat7, 0.5, 1)),
	};
}

function splitBeatSceneCounts(
	beatSpreadBudgets: Record<BeatId, number>,
	rng: () => number,
): Record<BeatId, number> {
	const counts = {} as Record<BeatId, number>;
	for (const beatId of BEAT_IDS) {
		const budget = beatSpreadBudgets[beatId];
		const minScenes = Math.ceil(budget / 5);
		const maxScenes = Math.min(3, budget);
		if (minScenes > maxScenes) {
			throw new Error(`beat ${beatId} budget ${budget} cannot fit into 1..3 scenes`);
		}
		counts[beatId] = minScenes + Math.floor(rng() * (maxScenes - minScenes + 1));
	}
	return counts;
}

function pick<T>(items: T[], rng: () => number): T {
	if (items.length === 0) throw new Error('cannot pick from an empty list');
	return items[Math.floor(rng() * items.length)];
}

function wordCount(line: string): number {
	return line.trim().split(/\s+/).filter(Boolean).length;
}

function rounded(n: number): number {
	return Number(n.toFixed(2));
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
