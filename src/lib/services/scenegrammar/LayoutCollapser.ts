import type { LocaleBiome } from '$lib/services/author/types';
import {
	BEAT_SHOT_MAP,
	GRAMMAR_TEMPLATES,
	getTemplateForBeat,
} from './GrammarTemplates';
import { hashSeed, mulberry32 } from './seededRng';
import type {
	BankAssetQuery,
	CollapsedLayout,
	CollapsedSlot,
	CollapseContext,
	ConstraintRule,
	Facing,
	GrammarTemplate,
	PoseClass,
	Rect,
	SlotCandidate,
	SlotId,
	SlotSpec,
	TemplateShot,
} from './types';

export const MAX_BACKTRACKS = 64;

export const SHOT_POSE_POOL: Record<TemplateShot, PoseClass[]> = {
	'wide-establishing': ['standing-neutral', 'walking'],
	medium: ['standing-neutral', 'reaching', 'pointing'],
	'medium-dynamic': ['running', 'reaching'],
	'tense-medium': ['standing-neutral', 'reaching'],
	'tight-dramatic': ['pointing', 'reaching'],
	'warm-wide': ['hugging', 'sitting'],
};

export const PROP_LOCALE_COMPAT: Record<string, LocaleBiome[]> = {
	lantern: ['forest', 'seaside', 'mountain', 'desert', 'meadow', 'snowfield', 'jungle', 'urban', 'farm', 'underwater', 'space', 'imaginary'],
	kite: ['seaside', 'meadow', 'urban', 'farm', 'desert', 'imaginary'],
	sandcastle: ['seaside', 'desert'],
	sled: ['snowfield', 'mountain'],
	telescope: ['mountain', 'desert', 'urban', 'space', 'imaginary'],
	seashell: ['seaside', 'underwater'],
	'watering-can': ['forest', 'meadow', 'jungle', 'farm', 'imaginary'],
	map: ['forest', 'seaside', 'mountain', 'desert', 'meadow', 'snowfield', 'jungle', 'urban', 'farm', 'space', 'imaginary'],
	compass: ['forest', 'mountain', 'desert', 'jungle', 'urban', 'farm', 'imaginary'],
	'star-globe': ['urban', 'space', 'imaginary'],
};

interface CandidateRejection {
	candidateIndex: number;
	candidate: SlotCandidate;
	constraintDescriptions: string[];
	messages: string[];
}

interface FailureReport {
	slotId: SlotId;
	rejections: CandidateRejection[];
	note?: string;
}

export class UnsatisfiableLayoutError extends Error {
	readonly slotId: SlotId;
	readonly ctx: CollapseContext;
	readonly rejections: CandidateRejection[];

	constructor(slotId: SlotId, ctx: CollapseContext, rejections: CandidateRejection[], note?: string) {
		const detailLines = rejections.map((rejection) => {
			const descriptions = rejection.constraintDescriptions.join('; ');
			const messages = rejection.messages.length > 0 ? ` (${rejection.messages.join('; ')})` : '';
			return `candidate ${rejection.candidateIndex}: ${descriptions}${messages}`;
		});
		const detail = detailLines.length > 0 ? detailLines.join(' | ') : (note ?? 'no candidates available');
		super(`UnsatisfiableLayoutError slot=${slotId}; ${detail}; ctx=${stableContextString(ctx)}`);
		this.name = 'UnsatisfiableLayoutError';
		this.slotId = slotId;
		this.ctx = ctx;
		this.rejections = rejections;
	}
}

function stableContextString(ctx: CollapseContext): string {
	return JSON.stringify({
		bookId: ctx.bookId,
		spreadIndex: ctx.spreadIndex,
		beatName: ctx.beatName,
		locale: ctx.locale,
		styleId: ctx.styleId,
		castArchetypeIds: ctx.castArchetypeIds,
		focalPropId: ctx.focalPropId,
		pageTurnDirection: ctx.pageTurnDirection,
	});
}

function rectArea(rect: Rect): number {
	return rect.w * rect.h;
}

function intersectionArea(a: Rect, b: Rect): number {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.w, b.x + b.w);
	const y2 = Math.min(a.y + a.h, b.y + b.h);
	if (x2 <= x1 || y2 <= y1) return 0;
	return (x2 - x1) * (y2 - y1);
}

function rectCenterX(rect: Rect): number {
	return rect.x + rect.w / 2;
}

function isRectInBounds(rect: Rect): boolean {
	return rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 && rect.x + rect.w <= 1 && rect.y + rect.h <= 1;
}

function directionFacing(direction: CollapseContext['pageTurnDirection']): Facing {
	return direction === 'rtl' ? 'left' : 'right';
}

function isEarlyPageTurnBeat(beatName: CollapseContext['beatName']): boolean {
	return beatName === 'setup' || beatName === 'catalyst' || beatName === 'midpoint' || beatName === 'trial';
}

export const GLOBAL_CONSTRAINTS: ConstraintRule[] = [
	{
		id: 'text-no-overlap-focal',
		description: 'textZone rect must not intersect heroSlot/sidekickSlot/focalPropSlot rects',
		check(partial) {
			const text = partial.textZone;
			if (!text) return null;
			for (const slotId of ['heroSlot', 'sidekickSlot', 'focalPropSlot'] as const) {
				const slot = partial[slotId];
				if (slot && intersectionArea(text.rect, slot.rect) > 0) {
					return `textZone intersects ${slotId}`;
				}
			}
			return null;
		},
	},
	{
		id: 'facing-page-turn',
		description: 'heroSlot facing must follow reading direction on beats 1-5, with debate facing the sidekick',
		check(partial, ctx) {
			const hero = partial.heroSlot;
			if (!hero) return null;
			if (ctx.beatName === 'debate') {
				const sidekick = partial.sidekickSlot;
				if (!sidekick) return null;
				const heroX = rectCenterX(hero.rect);
				const sidekickX = rectCenterX(sidekick.rect);
				if (heroX < sidekickX && hero.facing === 'right' && sidekick.facing === 'left') return null;
				if (heroX > sidekickX && hero.facing === 'left' && sidekick.facing === 'right') return null;
				return 'debate characters are not facing each other';
			}
			if (!isEarlyPageTurnBeat(ctx.beatName)) return null;
			const expectedFacing = directionFacing(ctx.pageTurnDirection);
			return hero.facing === expectedFacing ? null : `hero faces ${hero.facing}, expected ${expectedFacing}`;
		},
	},
	{
		id: 'prop-locale-compat',
		description: 'focalProp must be allowed in locale per PROP_LOCALE_COMPAT matrix',
		check(partial, ctx) {
			if (!partial.focalPropSlot || !ctx.focalPropId) return null;
			return isPropCompatible(ctx.focalPropId, ctx.locale) ? null : `${ctx.focalPropId} is not compatible with ${ctx.locale}`;
		},
	},
	{
		id: 'slots-in-bounds',
		description: 'every rect must remain within the 0..1 spread bounds',
		check(partial) {
			for (const slot of Object.values(partial)) {
				if (slot && !isRectInBounds(slot.rect)) {
					return `${slot.slotId} is outside spread bounds`;
				}
			}
			return null;
		},
	},
	{
		id: 'characters-no-overlap',
		description: 'heroSlot and sidekickSlot may overlap less than 15% of the smaller rect area',
		check(partial) {
			const hero = partial.heroSlot;
			const sidekick = partial.sidekickSlot;
			if (!hero || !sidekick) return null;
			const smallerArea = Math.min(rectArea(hero.rect), rectArea(sidekick.rect));
			const ratio = smallerArea > 0 ? intersectionArea(hero.rect, sidekick.rect) / smallerArea : 1;
			return ratio < 0.15 ? null : `character overlap ratio ${ratio.toFixed(3)} is too high`;
		},
	},
];

export function isPropCompatible(propId: string, locale: LocaleBiome): boolean {
	return PROP_LOCALE_COMPAT[propId]?.includes(locale) ?? false;
}

export function chooseDefaultFocalProp(locale: LocaleBiome, seed: number): string {
	const compatibleProps = Object.keys(PROP_LOCALE_COMPAT).filter((propId) => isPropCompatible(propId, locale));
	if (compatibleProps.length === 0) {
		throw new Error(`scenegrammar: no compatible props configured for locale "${locale}"`);
	}
	return compatibleProps[seed % compatibleProps.length];
}

function normalizeContext(ctx: CollapseContext, seed: number): CollapseContext {
	const focalPropId = ctx.focalPropId ?? chooseDefaultFocalProp(ctx.locale, seed);
	return {
		bookId: ctx.bookId,
		spreadIndex: ctx.spreadIndex,
		beatName: ctx.beatName,
		locale: ctx.locale,
		styleId: ctx.styleId,
		castArchetypeIds: [...ctx.castArchetypeIds],
		focalPropId,
		pageTurnDirection: ctx.pageTurnDirection ?? 'ltr',
	};
}

function candidateToSlot(slotSpec: SlotSpec, candidateValue: SlotCandidate): CollapsedSlot {
	return {
		slotId: slotSpec.id,
		rect: { ...candidateValue.rect },
		facing: candidateValue.facing ?? 'forward',
		scale: candidateValue.scale,
	};
}

function shuffleCandidates(candidates: SlotCandidate[], rng: () => number): SlotCandidate[] {
	const shuffled = candidates.map((item) => ({ ...item, rect: { ...item.rect } }));
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = shuffled[i];
		shuffled[i] = shuffled[j];
		shuffled[j] = tmp;
	}
	return shuffled;
}

function selectPose(shot: TemplateShot, seed: number, slotId: SlotId): PoseClass {
	const pool = SHOT_POSE_POOL[shot];
	const index = hashSeed(seed, slotId, shot) % pool.length;
	return pool[index];
}

function assetQueryForSlot(slotId: SlotId, ctx: CollapseContext, shot: TemplateShot, seed: number): BankAssetQuery | undefined {
	if (slotId === 'backgroundPlate') {
		return {
			layer: 'A',
			styleId: ctx.styleId,
			locale: ctx.locale,
			beatMood: ctx.beatName,
		};
	}
	if (slotId === 'heroSlot') {
		return {
			layer: 'B',
			styleId: ctx.styleId,
			...(ctx.castArchetypeIds[0] ? { archetypeId: ctx.castArchetypeIds[0] } : {}),
			poseClass: selectPose(shot, seed, slotId),
		};
	}
	if (slotId === 'sidekickSlot') {
		return {
			layer: 'B',
			styleId: ctx.styleId,
			...(ctx.castArchetypeIds[1] ? { archetypeId: ctx.castArchetypeIds[1] } : {}),
			poseClass: selectPose(shot, seed, slotId),
		};
	}
	if (slotId === 'focalPropSlot') {
		return {
			layer: 'C',
			styleId: ctx.styleId,
			...(ctx.focalPropId ? { propId: ctx.focalPropId } : {}),
		};
	}
	return undefined;
}

function attachAssetQueries(layoutSlots: CollapsedSlot[], ctx: CollapseContext, shot: TemplateShot, seed: number): CollapsedSlot[] {
	return layoutSlots.map((slot) => {
		const assetQuery = assetQueryForSlot(slot.slotId, ctx, shot, seed);
		return assetQuery ? { ...slot, assetQuery } : { ...slot };
	});
}

function orderedSlotSpecs(template: GrammarTemplate): SlotSpec[] {
	return template.slots
		.map((slotSpec, originalIndex) => ({ slotSpec, originalIndex }))
		.sort((a, b) => {
			if (a.slotSpec.required !== b.slotSpec.required) return a.slotSpec.required ? -1 : 1;
			if (a.slotSpec.candidates.length !== b.slotSpec.candidates.length) {
				return a.slotSpec.candidates.length - b.slotSpec.candidates.length;
			}
			return a.originalIndex - b.originalIndex;
		})
		.map(({ slotSpec }) => slotSpec);
}

function constraintFailures(
	partial: Partial<Record<SlotId, CollapsedSlot>>,
	ctx: CollapseContext,
	constraints: ConstraintRule[],
): { descriptions: string[]; messages: string[] } {
	const descriptions: string[] = [];
	const messages: string[] = [];
	for (const constraint of constraints) {
		const message = constraint.check(partial, ctx);
		if (message) {
			descriptions.push(constraint.description);
			messages.push(`${constraint.id}: ${message}`);
		}
	}
	return { descriptions, messages };
}

function propCompatibilityFailure(ctx: CollapseContext): CandidateRejection[] {
	return [
		{
			candidateIndex: 0,
			candidate: { rect: { x: 0, y: 0, w: 1, h: 1 }, scale: 1 },
			constraintDescriptions: [GLOBAL_CONSTRAINTS[2].description],
			messages: [`prop-locale-compat: ${ctx.focalPropId} is not compatible with ${ctx.locale}`],
		},
	];
}

export function collapseLayout(ctx: CollapseContext): CollapsedLayout {
	return collapseTemplateLayout(ctx, getTemplateForBeat(ctx.beatName));
}

export function collapseTemplateLayout(ctx: CollapseContext, template: GrammarTemplate): CollapsedLayout {
	const seedUsed = hashSeed(ctx.bookId, ctx.spreadIndex);
	const normalizedCtx = normalizeContext(ctx, seedUsed);
	if (ctx.focalPropId !== undefined && !isPropCompatible(ctx.focalPropId, ctx.locale)) {
		throw new UnsatisfiableLayoutError('focalPropSlot', normalizedCtx, propCompatibilityFailure(normalizedCtx));
	}
	const rng = mulberry32(seedUsed);
	const constraints = [...GLOBAL_CONSTRAINTS, ...template.constraints];
	const domains = orderedSlotSpecs(template).map((slotSpec) => ({
		slotSpec,
		candidates: shuffleCandidates(slotSpec.candidates, rng),
	}));
	const partial: Partial<Record<SlotId, CollapsedSlot>> = {};
	let backtracks = 0;
	let lastFailure: FailureReport | null = null;

	function solve(index: number): boolean {
		if (backtracks > MAX_BACKTRACKS) return false;
		if (index >= domains.length) return true;
		const { slotSpec, candidates } = domains[index];
		const rejections: CandidateRejection[] = [];

		for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
			const candidateValue = candidates[candidateIndex];
			partial[slotSpec.id] = candidateToSlot(slotSpec, candidateValue);
			const failures = constraintFailures(partial, normalizedCtx, constraints);
			if (failures.descriptions.length === 0) {
				if (solve(index + 1)) return true;
				rejections.push({
					candidateIndex,
					candidate: candidateValue,
					constraintDescriptions: [],
					messages: [`candidate led to dead end after ${slotSpec.id}`],
				});
			} else {
				rejections.push({
					candidateIndex,
					candidate: candidateValue,
					constraintDescriptions: failures.descriptions,
					messages: failures.messages,
				});
			}
			delete partial[slotSpec.id];
		}

		backtracks += 1;
		lastFailure = {
			slotId: slotSpec.id,
			rejections,
			note: `exhausted ${candidates.length} candidates`,
		};
		return false;
	}

	if (!solve(0)) {
		const failure = lastFailure ?? { slotId: domains[0]?.slotSpec.id ?? 'heroSlot', rejections: [], note: 'search exhausted' };
		throw new UnsatisfiableLayoutError(failure.slotId, normalizedCtx, failure.rejections, failure.note);
	}

	const slotsInTemplateOrder = template.slots.map((slotSpec) => {
		const slot = partial[slotSpec.id];
		if (!slot) {
			throw new UnsatisfiableLayoutError(slotSpec.id, normalizedCtx, [], 'slot missing after collapse');
		}
		return slot;
	});

	return {
		seedUsed,
		ctx: normalizedCtx,
		slots: attachAssetQueries(slotsInTemplateOrder, normalizedCtx, BEAT_SHOT_MAP[template.beatName], seedUsed),
		backtracks,
	};
}

export function availableGrammarTemplates(): GrammarTemplate[] {
	return GRAMMAR_TEMPLATES.map((template) => ({
		...template,
		slots: template.slots.map((slotSpec) => ({
			...slotSpec,
			candidates: slotSpec.candidates.map((candidateValue) => ({
				...candidateValue,
				rect: { ...candidateValue.rect },
			})),
		})),
		constraints: [...template.constraints],
	}));
}
