// @graph-layer: private
// @rationale: private (prompt composition embeds story briefs + character DNA)

// src/lib/services/scenerender/ScenePromptComposer.ts
//
// Pure prompt-recipe module for the real scene-render pipeline. Ports the
// WORKING prompt recipes proven by scripts/e2e/generate-real-book.mjs
// (feat/e2e-real-book @ ca00d61):
//
//   prompt = <style prefix> . <character-DNA block> . Scene in <locale>: <brief>
//
// plus the proven negative prompt that keeps text / watermarks / photorealism
// out of kids-book art, and the multi-view character-reference-sheet recipe.
//
// Everything here is a pure function of its inputs — no env reads, no IO —
// so vitest covers the recipes byte-for-byte against the mock provider.
//
// PRIVACY: any {HERO_NAME} placeholder is resolved to "the hero" before
// prompt assembly — prompts may leave the device (cloud provider), the kid's
// name must not.

import type { AgeBand, LocaleBiome, SupportingCastEntry } from '$lib/services/author/types';
import type { ImageGenRequest } from '$lib/services/imagegen';
import type { ClothingVibe, HairKind, PillarAxes, SkinTone } from '$lib/services/types';
import { ART_STYLES, type ArtStyle, type StyleSelectionId } from '$lib/workshop/types';
import type { CharacterDNA } from './types';

// ---------------------------------------------------------------------------
// Proven recipe constants (e2e @ ca00d61)
// ---------------------------------------------------------------------------

/** Generation resolution — Qwen-Image sweet spot proven on the 4090. */
export const GEN_PX = 1024;

/** 8.25in (8" trim + 2 × 0.125" bleed) × 300dpi print resolution. */
export const PRINT_PX = 2475;

/** Deterministic seed base; sheets at +1.., spreads at +100+spreadIndex. */
export const BASE_SEED = 424_242;

/**
 * The proven negative prompt — blocks in-image text, watermarks,
 * photorealism, and scary content across every generation.
 */
export const NEGATIVE_PROMPT =
	'text, words, letters, captions, watermark, signature, photorealistic, 3d render, deformed, extra limbs, scary, gore';

/**
 * Per-art-style positive-prompt prefixes. The 'flat-painted' recipe is the
 * one proven end-to-end (palette words generalized — the e2e run carried a
 * story-specific storm palette); the trailing "no text, no letters, no
 * words" clause is the load-bearing part and is shared by all three.
 */
export const STYLE_PREFIXES: Record<ArtStyle, string> = {
	'flat-painted':
		'flat-painted children’s picture book illustration, matte gouache texture, soft rounded shapes, warm harmonious palette, cozy, whimsical, clean composition, no text, no letters, no words',
	'octopath-hd2d':
		'HD-2D children’s storybook illustration, painterly pixel textures with soft volumetric lighting, tilt-shift diorama depth, glowing highlights, cozy, whimsical, clean composition, no text, no letters, no words',
	'pixel-pure':
		'detailed pixel art children’s picture book illustration, 16-bit palette, soft dithering, rounded sprite shapes, cozy, whimsical, clean composition, no text, no letters, no words',
};

export const DEFAULT_BASE_ART_STYLE: ArtStyle = 'flat-painted';

export function baseArtStyleForStylePack(stylePackId: StyleSelectionId): ArtStyle {
	return ART_STYLES.includes(stylePackId as ArtStyle)
		? (stylePackId as ArtStyle)
		: DEFAULT_BASE_ART_STYLE;
}

/** Locale-anchor fragments — "Scene in <fragment>: <brief>". */
export const LOCALE_FRAGMENTS: Record<LocaleBiome, string> = {
	forest: 'a deep green forest',
	seaside: 'a bright seaside shore with gentle waves',
	mountain: 'a high mountain trail among pines and peaks',
	desert: 'a golden desert of warm dunes under a big sky',
	meadow: 'a sunlit wildflower meadow',
	snowfield: 'a soft snowfield under a pale winter sky',
	jungle: 'a lush green jungle full of broad leaves',
	urban: 'a friendly little neighborhood street',
	farm: 'a cozy farmyard with a red barn',
	underwater: 'an underwater reef glowing with sea light',
	space: 'a starry stretch of outer space',
	imaginary: 'a dreamlike imaginary land',
};

/** Multi-view sheet recipe — the conditioning shape Edit-2511 expects. */
export const MULTI_VIEW_SHEET_RECIPE =
	'character reference sheet, three full-body views of the same character standing on a plain cream background (front view, side view, back view), consistent design';

/** Single-view fallback when a provider handles one view better. */
export const SINGLE_VIEW_SHEET_RECIPE =
	'full-body character portrait, a single character standing on a plain cream background, consistent design';

// ---------------------------------------------------------------------------
// Privacy helper
// ---------------------------------------------------------------------------

/**
 * Resolve the {HERO_NAME} placeholder to "the hero". Prompts may leave the
 * device; the kid's name must not (NameOverlayCompositor resolves the real
 * name locally at assembly time).
 */
export function resolveHeroPlaceholder(s: string): string {
	return String(s ?? '')
		.split('{HERO_NAME}')
		.join('the hero');
}

// ---------------------------------------------------------------------------
// Character-DNA block assembly
// ---------------------------------------------------------------------------

function termHits(term: string, haystackLower: string): boolean {
	const t = term.trim().toLowerCase();
	if (!t) return false;
	if (/^[a-z0-9]+$/.test(t)) return new RegExp(`\\b${t}\\b`).test(haystackLower);
	return haystackLower.includes(t);
}

/**
 * Join the DNA descriptions that apply to one spread. The hero is always
 * included; non-hero characters join when one of their matchTerms appears in
 * the spread's brief/text (ports the e2e `mentionsPip` heuristic).
 */
export function buildCharacterDnaBlock(
	characters: readonly CharacterDNA[],
	spreadContext: string,
): string {
	const hay = resolveHeroPlaceholder(spreadContext).toLowerCase();
	const parts: string[] = [];
	for (const c of characters) {
		if (c.role === 'hero') {
			parts.push(c.description);
			continue;
		}
		const terms = c.matchTerms?.length ? c.matchTerms : [c.id];
		if (terms.some((t) => termHits(t, hay))) parts.push(c.description);
	}
	return parts.join('. ');
}

// ---------------------------------------------------------------------------
// DNA builders
// ---------------------------------------------------------------------------

const HAIR_WORDS: Record<HairKind, string> = {
	'straight-short': 'short straight hair',
	'straight-long': 'long straight hair',
	'wavy-short': 'short wavy hair',
	'wavy-long': 'long wavy hair',
	'curly-short': 'short curly hair',
	'curly-long': 'long curly hair',
	coily: 'coily hair',
	buzz: 'a buzz cut',
};

const SKIN_WORDS: Record<SkinTone, string> = {
	I: 'very fair',
	II: 'fair',
	III: 'light',
	IV: 'medium-tan',
	V: 'brown',
	VI: 'deep brown',
};

const CLOTHING_WORDS: Record<ClothingVibe, string> = {
	casual: 'comfy everyday clothes',
	sporty: 'sporty activewear',
	formal: 'a neat smart outfit',
	whimsical: 'a whimsical playful outfit',
	cozy: 'a cozy warm outfit',
};

const AGE_WORDS: Record<AgeBand, string> = {
	toddler: 'a tiny toddler',
	preschool: 'a small young child',
	'grade-school': 'a school-aged kid',
};

/** Map the Station-2 pillar axes onto a hero DNA description (no name). */
export function heroDnaFromPillarAxes(axes: PillarAxes): string {
	return `the hero: ${AGE_WORDS[axes.ageBand]} with ${HAIR_WORDS[axes.hair]}, ${SKIN_WORDS[axes.skinTone]} skin and ${axes.eyeColor} eyes, wearing ${CLOTHING_WORDS[axes.clothingVibe]}`;
}

/** Generic hero DNA when no pillar axes are available. */
export function defaultHeroDna(ageBand: AgeBand): string {
	return `the hero: ${AGE_WORDS[ageBand]} with a bright, friendly face, wearing comfy adventure clothes`;
}

/** Sidekick DNA from a supporting-cast entry (role text is the visual brief). */
export function sidekickDnaFromCast(entry: SupportingCastEntry): CharacterDNA {
	const roleWords = entry.role
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 4);
	const idWords = entry.id
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 3);
	return {
		id: entry.id,
		role: 'sidekick',
		description: `the sidekick: ${resolveHeroPlaceholder(entry.role)}`,
		matchTerms: Array.from(new Set([...roleWords, ...idWords, 'sidekick'])),
	};
}

/**
 * Build the pipeline's character roster from Station-4 output: the hero
 * (pillar-axes DNA when available, generic otherwise) plus the sidekick
 * (from its supporting-cast entry, or a generic companion).
 */
export function charactersFromStation4(
	s4: { sidekickSettlerId: string; supportingCast: SupportingCastEntry[] },
	ageBand: AgeBand,
	heroDnaOverride?: string,
): CharacterDNA[] {
	const hero: CharacterDNA = {
		id: 'hero',
		role: 'hero',
		description: heroDnaOverride ?? defaultHeroDna(ageBand),
	};
	const castEntry = s4.supportingCast.find((c) => c.id === s4.sidekickSettlerId);
	const sidekick: CharacterDNA = castEntry
		? sidekickDnaFromCast(castEntry)
		: {
				id: s4.sidekickSettlerId,
				role: 'sidekick',
				description: "the sidekick: the hero's small, loyal animal companion",
				matchTerms: Array.from(
					new Set([
						...s4.sidekickSettlerId
							.toLowerCase()
							.split(/[^a-z0-9]+/)
							.filter((w) => w.length >= 3),
						'sidekick',
						'companion',
						'friend',
					]),
				),
			};
	return [hero, sidekick];
}

// ---------------------------------------------------------------------------
// Prompt composition (pure)
// ---------------------------------------------------------------------------

export interface ScenePromptOpts {
	/** spread.illustration_brief (fallback: sceneBrief / spread_text). */
	illustrationBrief: string;
	artStyle: ArtStyle;
	locale: LocaleBiome;
	/** Pre-joined character-DNA block (see buildCharacterDnaBlock). */
	characterDna: string;
	/** Character-sheet refs — only on the Edit-2511 multi-ref path. */
	refs?: Blob[] | string[];
	seed?: number;
	width?: number;
	height?: number;
}

/** (brief, artStyle, locale, DNA block, refs?) → ImageGenRequest. Pure. */
export function composeScenePrompt(opts: ScenePromptOpts): ImageGenRequest {
	const brief = resolveHeroPlaceholder(opts.illustrationBrief).trim();
	const req: ImageGenRequest = {
		prompt: `${STYLE_PREFIXES[opts.artStyle]}. ${opts.characterDna}. Scene in ${LOCALE_FRAGMENTS[opts.locale]}: ${brief}`,
		negativePrompt: NEGATIVE_PROMPT,
		width: opts.width ?? GEN_PX,
		height: opts.height ?? GEN_PX,
	};
	if (opts.seed !== undefined) req.seed = opts.seed;
	if (opts.refs && opts.refs.length > 0) req.characterRefs = opts.refs;
	return req;
}

export interface CharacterSheetPromptOpts {
	character: CharacterDNA;
	artStyle: ArtStyle;
	seed?: number;
	/** Square sheet size in px (default GEN_PX). */
	size?: number;
	/** Default true — front/side/back sheet (the Edit-2511 conditioning shape). */
	multiView?: boolean;
}

/** Character-sheet T2I request (multi-view by default). Pure. */
export function composeCharacterSheetPrompt(opts: CharacterSheetPromptOpts): ImageGenRequest {
	const recipe = (opts.multiView ?? true) ? MULTI_VIEW_SHEET_RECIPE : SINGLE_VIEW_SHEET_RECIPE;
	const px = opts.size ?? GEN_PX;
	const req: ImageGenRequest = {
		prompt: `${recipe}. ${resolveHeroPlaceholder(opts.character.description)}. ${STYLE_PREFIXES[opts.artStyle]}`,
		negativePrompt: NEGATIVE_PROMPT,
		width: px,
		height: px,
	};
	if (opts.seed !== undefined) req.seed = opts.seed;
	return req;
}
