// @graph-layer: private
// tests/scenerender/scene-prompt-composer.test.ts
//
// Pure prompt-recipe coverage: style prefixes, negative prompt, character-
// DNA injection, locale anchoring, refs passthrough, privacy placeholder
// resolution, and the DNA builders. NO provider, NO GPU.

import { describe, expect, it } from 'vitest';

import { ART_STYLES } from '$lib/workshop/types';
import {
	GEN_PX,
	LOCALE_FRAGMENTS,
	MULTI_VIEW_SHEET_RECIPE,
	NEGATIVE_PROMPT,
	SINGLE_VIEW_SHEET_RECIPE,
	STYLE_PREFIXES,
	buildCharacterDnaBlock,
	charactersFromStation4,
	composeCharacterSheetPrompt,
	composeScenePrompt,
	defaultHeroDna,
	heroDnaFromPillarAxes,
	resolveHeroPlaceholder,
	sidekickDnaFromCast,
} from '$lib/services/scenerender';
import { HERO_DNA, SIDEKICK_DNA } from './helpers';

describe('ScenePromptComposer — recipe constants', () => {
	it('ships one style prefix per art style, each carrying the no-text clause', () => {
		expect(Object.keys(STYLE_PREFIXES).sort()).toEqual([...ART_STYLES].sort());
		for (const prefix of Object.values(STYLE_PREFIXES)) {
			expect(prefix).toMatch(/no text, no letters, no words$/);
		}
		// Prefixes are distinct per style.
		expect(new Set(Object.values(STYLE_PREFIXES)).size).toBe(ART_STYLES.length);
	});

	it('covers every locale biome with an anchor fragment', () => {
		expect(Object.keys(LOCALE_FRAGMENTS)).toHaveLength(12);
		expect(LOCALE_FRAGMENTS.forest).toBe('a deep green forest');
		for (const fragment of Object.values(LOCALE_FRAGMENTS)) {
			expect(fragment.length).toBeGreaterThan(5);
		}
	});

	it('keeps the proven negative prompt', () => {
		expect(NEGATIVE_PROMPT).toContain('text');
		expect(NEGATIVE_PROMPT).toContain('watermark');
		expect(NEGATIVE_PROMPT).toContain('photorealistic');
		expect(NEGATIVE_PROMPT).toContain('scary');
	});
});

describe('composeScenePrompt', () => {
	const base = {
		illustrationBrief: 'the hero stands at the forest edge',
		artStyle: 'flat-painted' as const,
		locale: 'forest' as const,
		characterDna: HERO_DNA.description,
	};

	it('assembles style prefix + DNA + locale-anchored brief', () => {
		const req = composeScenePrompt(base);
		expect(req.prompt).toBe(
			`${STYLE_PREFIXES['flat-painted']}. ${HERO_DNA.description}. Scene in a deep green forest: the hero stands at the forest edge`,
		);
		expect(req.negativePrompt).toBe(NEGATIVE_PROMPT);
		expect(req.width).toBe(GEN_PX);
		expect(req.height).toBe(GEN_PX);
		expect(req.seed).toBeUndefined();
		expect(req.characterRefs).toBeUndefined();
	});

	it('threads seed, dimensions, and character refs through', () => {
		const refs = ['hero-sheet.png', 'sidekick-sheet.png'];
		const req = composeScenePrompt({ ...base, seed: 99, width: 512, height: 768, refs });
		expect(req.seed).toBe(99);
		expect(req.width).toBe(512);
		expect(req.height).toBe(768);
		expect(req.characterRefs).toEqual(refs);
	});

	it('omits characterRefs for an empty refs array', () => {
		const req = composeScenePrompt({ ...base, refs: [] });
		expect(req.characterRefs).toBeUndefined();
	});

	it('resolves {HERO_NAME} to "the hero" — the kid name never enters a prompt', () => {
		const req = composeScenePrompt({
			...base,
			illustrationBrief: '{HERO_NAME} laughs as {HERO_NAME} jumps the puddle',
		});
		expect(req.prompt).not.toContain('{HERO_NAME}');
		expect(req.prompt).toContain('the hero laughs as the hero jumps the puddle');
	});
});

describe('buildCharacterDnaBlock', () => {
	const cast = [HERO_DNA, SIDEKICK_DNA];

	it('always includes the hero; sidekick joins only on a term match', () => {
		const withPip = buildCharacterDnaBlock(cast, 'Pip raises the lantern high');
		expect(withPip).toContain(HERO_DNA.description);
		expect(withPip).toContain(SIDEKICK_DNA.description);

		const withoutPip = buildCharacterDnaBlock(cast, 'the hero walks alone through rain');
		expect(withoutPip).toBe(HERO_DNA.description);
	});

	it('matches terms case-insensitively on word boundaries', () => {
		expect(buildCharacterDnaBlock(cast, 'A HEDGEHOG appears!')).toContain(
			SIDEKICK_DNA.description,
		);
		// 'pipeline' must NOT match the term 'pip'.
		expect(buildCharacterDnaBlock(cast, 'the pipeline hums')).toBe(HERO_DNA.description);
	});

	it('falls back to the character id as the only match term', () => {
		const noTerms = { ...SIDEKICK_DNA, matchTerms: undefined };
		expect(buildCharacterDnaBlock([HERO_DNA, noTerms], 'pip-hedgehog waddles in')).toContain(
			SIDEKICK_DNA.description,
		);
	});
});

describe('DNA builders', () => {
	it('heroDnaFromPillarAxes maps axes onto plain visual words (no name, no placeholders)', () => {
		const dna = heroDnaFromPillarAxes({
			hair: 'curly-short',
			skinTone: 'IV',
			eyeColor: 'hazel',
			ageBand: 'preschool',
			clothingVibe: 'cozy',
			extras: [],
		});
		expect(dna).toBe(
			'the hero: a small young child with short curly hair, medium-tan skin and hazel eyes, wearing a cozy warm outfit',
		);
	});

	it('defaultHeroDna calibrates by age band and starts with "the hero"', () => {
		expect(defaultHeroDna('toddler')).toContain('a tiny toddler');
		expect(defaultHeroDna('grade-school')).toContain('a school-aged kid');
		expect(defaultHeroDna('preschool')).toMatch(/^the hero: /);
	});

	it('sidekickDnaFromCast derives the description and match terms from the cast role', () => {
		const dna = sidekickDnaFromCast({
			id: 'pip-hedgehog',
			role: "Pip, a lantern-carrying hedgehog and the hero's best friend",
		});
		expect(dna.role).toBe('sidekick');
		expect(dna.description).toBe(
			"the sidekick: Pip, a lantern-carrying hedgehog and the hero's best friend",
		);
		expect(dna.matchTerms).toEqual(expect.arrayContaining(['hedgehog', 'lantern', 'pip', 'sidekick']));
	});

	it('charactersFromStation4 builds hero + sidekick, honoring the hero override', () => {
		const s4 = {
			sidekickSettlerId: 'pip-hedgehog',
			supportingCast: [{ id: 'pip-hedgehog', role: 'Pip, a lantern-carrying hedgehog' }],
		};
		const chars = charactersFromStation4(s4, 'preschool');
		expect(chars).toHaveLength(2);
		expect(chars[0]).toMatchObject({ id: 'hero', role: 'hero' });
		expect(chars[1].description).toContain('lantern-carrying hedgehog');

		const overridden = charactersFromStation4(s4, 'preschool', 'the hero: a kid in a red cape');
		expect(overridden[0].description).toBe('the hero: a kid in a red cape');

		// No cast entry → generic companion keyed off the settler id.
		const generic = charactersFromStation4(
			{ sidekickSettlerId: 'ada', supportingCast: [] },
			'preschool',
		);
		expect(generic[1].id).toBe('ada');
		expect(generic[1].matchTerms).toEqual(expect.arrayContaining(['ada', 'sidekick']));
	});
});

describe('composeCharacterSheetPrompt', () => {
	it('uses the proven multi-view reference-sheet recipe by default', () => {
		const req = composeCharacterSheetPrompt({ character: HERO_DNA, artStyle: 'flat-painted' });
		expect(req.prompt).toBe(
			`${MULTI_VIEW_SHEET_RECIPE}. ${HERO_DNA.description}. ${STYLE_PREFIXES['flat-painted']}`,
		);
		expect(req.prompt).toContain('front view, side view, back view');
		expect(req.negativePrompt).toBe(NEGATIVE_PROMPT);
		expect(req.width).toBe(GEN_PX);
		expect(req.height).toBe(GEN_PX);
	});

	it('supports the single-view fallback + seed + size', () => {
		const req = composeCharacterSheetPrompt({
			character: SIDEKICK_DNA,
			artStyle: 'pixel-pure',
			multiView: false,
			seed: 7,
			size: 512,
		});
		expect(req.prompt).toContain(SINGLE_VIEW_SHEET_RECIPE);
		expect(req.prompt).not.toContain('front view, side view, back view');
		expect(req.seed).toBe(7);
		expect(req.width).toBe(512);
		expect(req.height).toBe(512);
	});
});

describe('resolveHeroPlaceholder', () => {
	it('replaces every occurrence and tolerates empty input', () => {
		expect(resolveHeroPlaceholder('{HERO_NAME} and {HERO_NAME}')).toBe('the hero and the hero');
		expect(resolveHeroPlaceholder('')).toBe('');
	});
});
