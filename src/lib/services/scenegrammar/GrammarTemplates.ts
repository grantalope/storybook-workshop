import type { BeatName } from '$lib/services/author/types';
import type {
	CollapsedSlot,
	CollapseContext,
	ConstraintRule,
	GrammarTemplate,
	Rect,
	SlotCandidate,
	SlotId,
	SlotSpec,
	TemplateShot,
} from './types';

export const BEAT_NAMES: BeatName[] = [
	'setup',
	'catalyst',
	'debate',
	'midpoint',
	'trial',
	'climax',
	'resolution',
];

export const ALL_SLOT_IDS: SlotId[] = [
	'backgroundPlate',
	'skyband',
	'textZone',
	'focalPropSlot',
	'heroSlot',
	'sidekickSlot',
];

export const BEAT_SHOT_MAP: Record<BeatName, TemplateShot> = {
	setup: 'wide-establishing',
	catalyst: 'medium',
	debate: 'medium',
	midpoint: 'medium-dynamic',
	trial: 'tense-medium',
	climax: 'tight-dramatic',
	resolution: 'warm-wide',
};

function candidate(x: number, y: number, w: number, h: number, scale: number, facing?: SlotCandidate['facing']): SlotCandidate {
	return { rect: { x, y, w, h }, scale, ...(facing ? { facing } : {}) };
}

function slot(id: SlotId, required: boolean, zIndex: number, candidates: SlotCandidate[]): SlotSpec {
	return { id, required, zIndex, candidates };
}

function rectCenter(rect: Rect): { x: number; y: number } {
	return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function maybePair(
	partial: Partial<Record<SlotId, CollapsedSlot>>,
	a: SlotId,
	b: SlotId,
): [CollapsedSlot, CollapsedSlot] | null {
	const left = partial[a];
	const right = partial[b];
	return left && right ? [left, right] : null;
}

const BACKGROUND_CANDIDATES: SlotCandidate[] = [
	candidate(0, 0, 1, 1, 1),
	candidate(0, 0, 1, 0.98, 1),
	candidate(0, 0.02, 1, 0.98, 1),
];

function skybandCandidates(kind: 'large' | 'standard' | 'minimal'): SlotCandidate[] {
	if (kind === 'large') {
		return [candidate(0, 0, 1, 0.24, 1), candidate(0, 0, 1, 0.22, 1), candidate(0, 0, 1, 0.2, 1)];
	}
	if (kind === 'minimal') {
		return [candidate(0, 0, 1, 0.1, 1), candidate(0, 0, 1, 0.12, 1), candidate(0, 0, 1, 0.14, 1)];
	}
	return [candidate(0, 0, 1, 0.18, 1), candidate(0, 0, 1, 0.2, 1), candidate(0, 0, 1, 0.22, 1)];
}

const generousText: SlotCandidate[] = [
	candidate(0.05, 0.3, 0.28, 0.46, 1),
	candidate(0.67, 0.3, 0.28, 0.46, 1),
	candidate(0.36, 0.66, 0.28, 0.24, 1),
	candidate(0.06, 0.68, 0.34, 0.22, 1),
];

const standardText: SlotCandidate[] = [
	candidate(0.04, 0.3, 0.24, 0.42, 1),
	candidate(0.72, 0.3, 0.24, 0.42, 1),
	candidate(0.06, 0.66, 0.28, 0.22, 1),
	candidate(0.66, 0.66, 0.28, 0.22, 1),
];

const debateText: SlotCandidate[] = [
	candidate(0.35, 0.05, 0.3, 0.16, 1),
	candidate(0.35, 0.78, 0.3, 0.16, 1),
	candidate(0.04, 0.34, 0.22, 0.34, 1),
	candidate(0.74, 0.34, 0.22, 0.34, 1),
];

const cornerText: SlotCandidate[] = [
	candidate(0.04, 0.72, 0.24, 0.18, 1),
	candidate(0.72, 0.72, 0.24, 0.18, 1),
	candidate(0.04, 0.28, 0.22, 0.2, 1),
	candidate(0.74, 0.28, 0.22, 0.2, 1),
];

const setupHero: SlotCandidate[] = [
	candidate(0.16, 0.42, 0.16, 0.34, 0.28, 'right'),
	candidate(0.24, 0.38, 0.16, 0.36, 0.3, 'right'),
	candidate(0.62, 0.42, 0.16, 0.34, 0.28, 'left'),
	candidate(0.7, 0.38, 0.16, 0.36, 0.3, 'left'),
	candidate(0.42, 0.42, 0.16, 0.32, 0.27, 'forward'),
];

const mediumHero: SlotCandidate[] = [
	candidate(0.18, 0.36, 0.18, 0.4, 0.38, 'right'),
	candidate(0.3, 0.34, 0.18, 0.42, 0.4, 'right'),
	candidate(0.56, 0.36, 0.18, 0.4, 0.38, 'left'),
	candidate(0.66, 0.34, 0.18, 0.42, 0.4, 'left'),
	candidate(0.42, 0.34, 0.18, 0.42, 0.4, 'forward'),
];

const mediumSidekick: SlotCandidate[] = [
	candidate(0.15, 0.42, 0.16, 0.34, 0.32, 'right'),
	candidate(0.36, 0.4, 0.16, 0.36, 0.34, 'right'),
	candidate(0.58, 0.42, 0.16, 0.34, 0.32, 'left'),
	candidate(0.76, 0.4, 0.16, 0.36, 0.34, 'left'),
	candidate(0.46, 0.43, 0.16, 0.34, 0.32, 'forward'),
];

const debateHero: SlotCandidate[] = [
	candidate(0.18, 0.36, 0.18, 0.4, 0.38, 'right'),
	candidate(0.27, 0.36, 0.18, 0.4, 0.38, 'right'),
	candidate(0.56, 0.36, 0.18, 0.4, 0.38, 'left'),
	candidate(0.65, 0.36, 0.18, 0.4, 0.38, 'left'),
];

const debateSidekick: SlotCandidate[] = [
	candidate(0.16, 0.38, 0.16, 0.36, 0.34, 'right'),
	candidate(0.34, 0.38, 0.16, 0.36, 0.34, 'right'),
	candidate(0.58, 0.38, 0.16, 0.36, 0.34, 'left'),
	candidate(0.76, 0.38, 0.16, 0.36, 0.34, 'left'),
];

const midpointHero: SlotCandidate[] = [
	candidate(0.18, 0.48, 0.18, 0.38, 0.42, 'right'),
	candidate(0.3, 0.3, 0.18, 0.38, 0.42, 'right'),
	candidate(0.56, 0.48, 0.18, 0.38, 0.42, 'left'),
	candidate(0.66, 0.3, 0.18, 0.38, 0.42, 'left'),
];

const midpointSidekick: SlotCandidate[] = [
	candidate(0.16, 0.28, 0.16, 0.34, 0.36, 'right'),
	candidate(0.38, 0.52, 0.16, 0.34, 0.36, 'right'),
	candidate(0.58, 0.28, 0.16, 0.34, 0.36, 'left'),
	candidate(0.76, 0.52, 0.16, 0.34, 0.36, 'left'),
];

const trialHero: SlotCandidate[] = [
	candidate(0.18, 0.34, 0.2, 0.46, 0.43, 'right'),
	candidate(0.3, 0.32, 0.2, 0.46, 0.43, 'right'),
	candidate(0.54, 0.34, 0.2, 0.46, 0.43, 'left'),
	candidate(0.66, 0.32, 0.2, 0.46, 0.43, 'left'),
];

const trialSidekick: SlotCandidate[] = [
	candidate(0.13, 0.38, 0.18, 0.4, 0.38, 'right'),
	candidate(0.35, 0.38, 0.18, 0.4, 0.38, 'right'),
	candidate(0.58, 0.38, 0.18, 0.4, 0.38, 'left'),
	candidate(0.76, 0.38, 0.18, 0.4, 0.38, 'left'),
];

const climaxHero: SlotCandidate[] = [
	candidate(0.18, 0.28, 0.24, 0.52, 0.5, 'right'),
	candidate(0.36, 0.24, 0.24, 0.54, 0.52, 'forward'),
	candidate(0.58, 0.28, 0.24, 0.52, 0.5, 'left'),
	candidate(0.28, 0.3, 0.24, 0.52, 0.48, 'right'),
];

const climaxSidekick: SlotCandidate[] = [
	candidate(0.08, 0.44, 0.18, 0.38, 0.38, 'right'),
	candidate(0.56, 0.44, 0.18, 0.38, 0.38, 'left'),
	candidate(0.74, 0.44, 0.18, 0.38, 0.38, 'left'),
	candidate(0.3, 0.46, 0.18, 0.36, 0.36, 'forward'),
];

const resolutionHero: SlotCandidate[] = [
	candidate(0.28, 0.42, 0.16, 0.34, 0.34, 'right'),
	candidate(0.34, 0.42, 0.16, 0.34, 0.34, 'right'),
	candidate(0.5, 0.42, 0.16, 0.34, 0.34, 'left'),
	candidate(0.56, 0.42, 0.16, 0.34, 0.34, 'left'),
];

const resolutionSidekick: SlotCandidate[] = [
	candidate(0.3, 0.44, 0.15, 0.32, 0.32, 'right'),
	candidate(0.42, 0.44, 0.15, 0.32, 0.32, 'forward'),
	candidate(0.54, 0.44, 0.15, 0.32, 0.32, 'left'),
	candidate(0.62, 0.44, 0.15, 0.32, 0.32, 'left'),
];

const leftProp: SlotCandidate[] = [
	candidate(0.4, 0.6, 0.1, 0.12, 0.22),
	candidate(0.5, 0.58, 0.1, 0.12, 0.22),
	candidate(0.32, 0.7, 0.1, 0.12, 0.2),
	candidate(0.58, 0.7, 0.1, 0.12, 0.2),
];

const trialProp: SlotCandidate[] = [
	candidate(0.43, 0.6, 0.1, 0.12, 0.24),
	candidate(0.49, 0.58, 0.1, 0.12, 0.24),
	candidate(0.37, 0.64, 0.1, 0.12, 0.22),
	candidate(0.56, 0.64, 0.1, 0.12, 0.22),
];

const smallProp: SlotCandidate[] = [
	candidate(0.44, 0.66, 0.08, 0.1, 0.18),
	candidate(0.52, 0.66, 0.08, 0.1, 0.18),
	candidate(0.34, 0.72, 0.08, 0.1, 0.16),
	candidate(0.6, 0.72, 0.08, 0.1, 0.16),
];

const midpointDiagonalConstraint: ConstraintRule = {
	id: 'midpoint-diagonal-energy',
	description: 'midpoint requires hero and sidekick vertical centers to be offset for diagonal energy',
	check(partial) {
		const pair = maybePair(partial, 'heroSlot', 'sidekickSlot');
		if (!pair) return null;
		const [hero, sidekick] = pair;
		const heroCenter = rectCenter(hero.rect);
		const sidekickCenter = rectCenter(sidekick.rect);
		return Math.abs(heroCenter.y - sidekickCenter.y) >= 0.12 ? null : 'hero and sidekick are not vertically offset';
	},
};

const trialPropBetweenCharactersConstraint: ConstraintRule = {
	id: 'trial-prop-between-characters',
	description: 'trial requires the focal prop between the two character centers',
	check(partial) {
		const hero = partial.heroSlot;
		const sidekick = partial.sidekickSlot;
		const prop = partial.focalPropSlot;
		if (!hero || !sidekick || !prop) return null;
		const heroX = rectCenter(hero.rect).x;
		const sidekickX = rectCenter(sidekick.rect).x;
		const propX = rectCenter(prop.rect).x;
		const minX = Math.min(heroX, sidekickX);
		const maxX = Math.max(heroX, sidekickX);
		return propX > minX && propX < maxX ? null : 'focal prop is outside the character interval';
	},
};

const climaxHeroScaleConstraint: ConstraintRule = {
	id: 'climax-hero-scale',
	description: 'climax requires the hero scale to be at least 0.45',
	check(partial) {
		const hero = partial.heroSlot;
		return !hero || hero.scale >= 0.45 ? null : 'hero scale is below 0.45';
	},
};

const resolutionAdjacentConstraint: ConstraintRule = {
	id: 'resolution-adjacent-characters',
	description: 'resolution keeps hero and sidekick adjacent in a warm wide frame',
	check(partial) {
		const pair = maybePair(partial, 'heroSlot', 'sidekickSlot');
		if (!pair) return null;
		const [hero, sidekick] = pair;
		const distance = Math.abs(rectCenter(hero.rect).x - rectCenter(sidekick.rect).x);
		return distance <= 0.28 ? null : 'hero and sidekick are too far apart for the resolution';
	},
};

function commonSlots(
	beatName: BeatName,
	options: {
		skyband: 'large' | 'standard' | 'minimal';
		text: SlotCandidate[];
		hero: SlotCandidate[];
		sidekick: SlotCandidate[];
		prop: SlotCandidate[];
		sidekickRequired: boolean;
		propRequired: boolean;
	},
): SlotSpec[] {
	return [
		slot('backgroundPlate', true, 0, BACKGROUND_CANDIDATES),
		slot('skyband', true, 1, skybandCandidates(options.skyband)),
		slot('textZone', true, 4, options.text),
		slot('focalPropSlot', options.propRequired, 2, options.prop),
		slot('heroSlot', true, 3, options.hero),
		slot('sidekickSlot', options.sidekickRequired, 3, options.sidekick),
	].map((spec) => ({ ...spec, candidates: spec.candidates.map((c) => ({ ...c, rect: { ...c.rect } })) }));
}

export const SETUP_TEMPLATE: GrammarTemplate = {
	beatName: 'setup',
	shot: BEAT_SHOT_MAP.setup,
	slots: commonSlots('setup', {
		skyband: 'large',
		text: generousText,
		hero: setupHero,
		sidekick: mediumSidekick,
		prop: smallProp,
		sidekickRequired: false,
		propRequired: false,
	}),
	constraints: [],
};

export const CATALYST_TEMPLATE: GrammarTemplate = {
	beatName: 'catalyst',
	shot: BEAT_SHOT_MAP.catalyst,
	slots: commonSlots('catalyst', {
		skyband: 'standard',
		text: standardText,
		hero: mediumHero,
		sidekick: mediumSidekick,
		prop: leftProp,
		sidekickRequired: true,
		propRequired: true,
	}),
	constraints: [],
};

export const DEBATE_TEMPLATE: GrammarTemplate = {
	beatName: 'debate',
	shot: BEAT_SHOT_MAP.debate,
	slots: commonSlots('debate', {
		skyband: 'standard',
		text: debateText,
		hero: debateHero,
		sidekick: debateSidekick,
		prop: smallProp,
		sidekickRequired: true,
		propRequired: true,
	}),
	constraints: [],
};

export const MIDPOINT_TEMPLATE: GrammarTemplate = {
	beatName: 'midpoint',
	shot: BEAT_SHOT_MAP.midpoint,
	slots: commonSlots('midpoint', {
		skyband: 'standard',
		text: standardText,
		hero: midpointHero,
		sidekick: midpointSidekick,
		prop: leftProp,
		sidekickRequired: true,
		propRequired: true,
	}),
	constraints: [midpointDiagonalConstraint],
};

export const TRIAL_TEMPLATE: GrammarTemplate = {
	beatName: 'trial',
	shot: BEAT_SHOT_MAP.trial,
	slots: commonSlots('trial', {
		skyband: 'standard',
		text: cornerText,
		hero: trialHero,
		sidekick: trialSidekick,
		prop: trialProp,
		sidekickRequired: true,
		propRequired: true,
	}),
	constraints: [trialPropBetweenCharactersConstraint],
};

export const CLIMAX_TEMPLATE: GrammarTemplate = {
	beatName: 'climax',
	shot: BEAT_SHOT_MAP.climax,
	slots: commonSlots('climax', {
		skyband: 'minimal',
		text: cornerText,
		hero: climaxHero,
		sidekick: climaxSidekick,
		prop: smallProp,
		sidekickRequired: true,
		propRequired: true,
	}),
	constraints: [climaxHeroScaleConstraint],
};

export const RESOLUTION_TEMPLATE: GrammarTemplate = {
	beatName: 'resolution',
	shot: BEAT_SHOT_MAP.resolution,
	slots: commonSlots('resolution', {
		skyband: 'large',
		text: generousText,
		hero: resolutionHero,
		sidekick: resolutionSidekick,
		prop: smallProp,
		sidekickRequired: false,
		propRequired: false,
	}),
	constraints: [resolutionAdjacentConstraint],
};

export const GRAMMAR_TEMPLATES: GrammarTemplate[] = [
	SETUP_TEMPLATE,
	CATALYST_TEMPLATE,
	DEBATE_TEMPLATE,
	MIDPOINT_TEMPLATE,
	TRIAL_TEMPLATE,
	CLIMAX_TEMPLATE,
	RESOLUTION_TEMPLATE,
];

export function getTemplateForBeat(beatName: BeatName): GrammarTemplate {
	const template = GRAMMAR_TEMPLATES.find((candidateTemplate) => candidateTemplate.beatName === beatName);
	if (!template) {
		throw new Error(`scenegrammar: no grammar template for beat "${beatName}"`);
	}
	return template;
}

export function isSlotRequiredForBeat(beatName: BeatName, slotId: SlotId): boolean {
	const slotSpec = getTemplateForBeat(beatName).slots.find((slotCandidate) => slotCandidate.id === slotId);
	return slotSpec?.required ?? false;
}
