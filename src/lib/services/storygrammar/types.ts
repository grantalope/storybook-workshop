import type {
	AgeBand,
	BeatId,
	BeatName,
	LocaleBiome,
	SceneTree,
	StoryTheme,
} from '$lib/services/author/types';

export type ConflictClass =
	| 'lost-thing'
	| 'new-experience'
	| 'friendship-rift'
	| 'fear-to-face'
	| 'big-task';

export type StakesLevel =
	| 'comfort-object'
	| 'routine-change'
	| 'social-bond'
	| 'self-mastery'
	| 'community';

export type SidekickRole = 'helper' | 'comic' | 'conscience';

export type EndingType =
	| 'circular-callback'
	| 'quiet-warmth'
	| 'lesson-named'
	| 'joke-button'
	| 'gift-forward';

export interface RefrainPattern {
	line: string;
	minWords: number;
	maxWords: number;
	placementBeats: BeatId[];
	climaxMutation: { beat: BeatId; swapWordIndex: number };
}

export interface SettingArc {
	start: LocaleBiome;
	excursion: LocaleBiome;
	return: LocaleBiome;
}

export interface StorySkeleton {
	seedUsed: number;
	theme: StoryTheme;
	conflictClass: ConflictClass;
	stakes: StakesLevel;
	settingArc: SettingArc;
	refrain: RefrainPattern;
	sidekickRole: SidekickRole;
	endingType: EndingType;
	beatSceneCounts: Record<BeatId, number>;
	beatSpreadBudgets: Record<BeatId, number>;
	emotionalArc: Record<BeatId, number>;
}

export interface BeatBrief {
	beatId: BeatId;
	beatName: BeatName;
	valence: number;
	sceneCount: number;
	spreadBudget: number;
	conflictFocus: string;
	refrainLine?: string;
	refrainIsMutated?: boolean;
	tier2Words: string[];
	sidekickNote: string;
	settingNote: string;
	brief: string;
}

export interface SceneTreeCacheStore {
	get(hash: string): Promise<SceneTree | null>;
	put(hash: string, tree: SceneTree): Promise<void>;
}

export type { AgeBand, BeatId, BeatName, LocaleBiome, StoryTheme };
