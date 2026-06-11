// @graph-layer: private
// @rationale: private (per-user/per-kid workshop state — never leaves device)

// src/lib/workshop/types.ts
//
// Canonical types for the Storybook Workshop UI shell.
// Per docs/specs/2026-05-24-design.md §2 + the 2026-05-25 hd2d pivot
// (Station 5 art-style enum compressed from 12 → 3 styles).

import type {
	AgeBand,
	EhriPhase,
	LocaleBiome,
	StoryOccasion,
	StoryTheme,
	SupportingCastEntry,
} from '$lib/services/author/types';

// ─── Pivot: 3 art styles ────────────────────────────────────────────────────
export type ArtStyle = 'octopath-hd2d' | 'flat-painted' | 'pixel-pure';
export type StyleSelectionId = string;

export const ART_STYLES: readonly ArtStyle[] = [
	'octopath-hd2d',
	'flat-painted',
	'pixel-pure',
] as const;

// ─── Kid roster ─────────────────────────────────────────────────────────────
export interface KidProfile {
	kidId: string;
	name: string;
	birthdayIso: string; // YYYY-MM-DD
	ageBand: AgeBand;
	oneLineAbout: string;
	createdAt: number;
	updatedAt: number;
}

// ─── Workshop state ─────────────────────────────────────────────────────────
export type StationId =
	| 'kid-picker'
	| 's1'
	| 's2'
	| 's3'
	| 's4'
	| 's5'
	| 's6'
	| 's7'
	| 'library';

export const STATION_ORDER: readonly StationId[] = [
	'kid-picker',
	's1',
	's2',
	's3',
	's4',
	's5',
	's6',
	's7',
	'library',
] as const;

export type WorkshopMode = 'standard' | 'quick';

export type LengthTier = 'bedtime' | 'standard' | 'adventure' | 'saga';
export const LENGTH_TIER_SPREADS: Record<LengthTier, number> = {
	bedtime: 8,
	standard: 12,
	adventure: 16,
	saga: 24,
};

export interface Station1Output {
	theme: StoryTheme;
	occasion: StoryOccasion;
	lengthTier: LengthTier;
	targetSpreads: number;
	ehriPhase: EhriPhase;
}

export interface Station2Output {
	pillarId: string; // opaque
}

export interface Station3Output {
	dedicationText: string;
	voiceClipBlobUrl?: string; // local blob URL only
	templateId?: string;
}

export interface Station4Output {
	heroName: string;
	sidekickSettlerId: string;
	supportingCast: SupportingCastEntry[];
	localeBiome: LocaleBiome;
}

export interface Station5Output {
	artStyle: StyleSelectionId;
	authorByline?: string;
	endpaper?: string;
	coverBadge?: string;
	easierReadingMode: boolean;
	dialogicPromptsEnabled: boolean;
}

export interface ConsentRecord {
	reviewedSpreads: boolean;
	understandsNonRefundable: boolean;
	pdfHash: string;
	timestampMs: number;
}

export interface Station6Output {
	bookShortcode: string;
	pdfBlobSize: number;
	pdfHash: string;
	consent: ConsentRecord;
}

export type StationOutputs = {
	s1?: Station1Output;
	s2?: Station2Output;
	s3?: Station3Output;
	s4?: Station4Output;
	s5?: Station5Output;
	s6?: Station6Output;
};

export interface WorkshopDraft {
	draftId: string;
	kidId: string;
	mode: WorkshopMode;
	currentStation: StationId;
	outputs: StationOutputs;
	createdAt: number;
	updatedAt: number;
	expiresAt: number; // updatedAt + 30 days
}

export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
