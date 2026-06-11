import type { BeatName, LocaleBiome } from '$lib/services/author/types';

export type SlotId =
	| 'heroSlot'
	| 'sidekickSlot'
	| 'focalPropSlot'
	| 'backgroundPlate'
	| 'skyband'
	| 'textZone';

export type Facing = 'left' | 'right' | 'forward';

/** Fractions of the full two-page spread, constrained to 0..1 by layout rules. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SlotCandidate {
	rect: Rect;
	facing?: Facing;
	scale: number;
}

export interface SlotSpec {
	id: SlotId;
	required: boolean;
	/** candidate placements the collapser may choose from (superposition domain) */
	candidates: SlotCandidate[];
	zIndex: number;
}

export interface ConstraintRule {
	id: string;
	description: string;
	/** returns violation message or null */
	check(
		partial: Partial<Record<SlotId, CollapsedSlot>>,
		ctx: CollapseContext,
	): string | null;
}

export type TemplateShot =
	| 'wide-establishing'
	| 'medium'
	| 'medium-dynamic'
	| 'tense-medium'
	| 'tight-dramatic'
	| 'warm-wide';

export interface GrammarTemplate {
	beatName: BeatName;
	shot: TemplateShot;
	slots: SlotSpec[];
	constraints: ConstraintRule[];
}

export interface CollapsedSlot {
	slotId: SlotId;
	rect: Rect;
	facing: Facing;
	scale: number;
	assetQuery?: BankAssetQuery;
}

export interface CollapseContext {
	bookId: string;
	spreadIndex: number;
	beatName: BeatName;
	locale: LocaleBiome;
	styleId: string;
	castArchetypeIds: string[];
	focalPropId?: string;
	pageTurnDirection: 'ltr' | 'rtl';
}

export interface CollapsedLayout {
	seedUsed: number;
	ctx: CollapseContext;
	slots: CollapsedSlot[];
	backtracks: number;
}

export interface CompositionPlan {
	layout: CollapsedLayout;
	mode: 'bank-composite' | 'direct-gen';
	resolvedAssets: Array<{ slotId: SlotId; assetId: string; file: string }>;
	missingAssets: BankAssetQuery[];
	fallbackToDirectGen: boolean;
}

export type PoseClass =
	| 'standing-neutral'
	| 'walking'
	| 'running'
	| 'sitting'
	| 'reaching'
	| 'pointing'
	| 'hugging'
	| 'sleeping';

export interface BankAssetQuery {
	layer: 'A' | 'B' | 'C';
	styleId: string;
	locale?: LocaleBiome;
	beatMood?: BeatName;
	archetypeId?: string;
	poseClass?: PoseClass;
	propId?: string;
}

export interface BankAssetEntry {
	assetId: string;
	layer: 'A' | 'B' | 'C';
	styleId: string;
	locale?: LocaleBiome;
	beatMood?: BeatName;
	archetypeId?: string;
	poseClass?: PoseClass;
	propId?: string;
	file: string;
	seed: number;
	qcSimilarity?: number;
	generatedAtIso: string;
}

export interface BankManifest {
	version: 1;
	bankRoot: string;
	entries: BankAssetEntry[];
}
