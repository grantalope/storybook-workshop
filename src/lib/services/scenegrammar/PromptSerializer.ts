import { BEAT_SHOT_MAP } from './GrammarTemplates';
import type {
	BankAssetQuery,
	CollapsedLayout,
	CollapsedSlot,
	Rect,
} from './types';

function center(rect: Rect): { x: number; y: number } {
	return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function horizontalPosition(rect: Rect): string {
	const { x } = center(rect);
	if (x < 0.34) return 'left third';
	if (x > 0.66) return 'right third';
	return 'center';
}

function textPosition(rect: Rect): string {
	const { x, y } = center(rect);
	const vertical = y < 0.34 ? 'upper' : y > 0.66 ? 'lower' : 'middle';
	const horizontal = x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'center';
	return `${vertical} ${horizontal}`;
}

function scaleWord(scale: number): string {
	if (scale >= 0.45) return 'large';
	if (scale >= 0.34) return 'medium';
	return 'small';
}

function slotPhrase(slot: CollapsedSlot): string {
	if (slot.slotId === 'backgroundPlate') return 'background plate fills the spread';
	if (slot.slotId === 'skyband') return `skyband across the top ${Math.round(slot.rect.h * 100)} percent`;
	if (slot.slotId === 'textZone') return `text zone reserved at ${textPosition(slot.rect)}`;
	return `${slot.slotId} on the ${horizontalPosition(slot.rect)}, facing ${slot.facing}, ${scaleWord(slot.scale)}`;
}

export function serializeDirectGenPrompt(layout: CollapsedLayout, sceneBrief: string): string {
	const shot = BEAT_SHOT_MAP[layout.ctx.beatName];
	const textZone = layout.slots.find((slot) => slot.slotId === 'textZone');
	const textZonePosition = textZone ? textPosition(textZone.rect) : 'designated text zone';
	const slotClauses = layout.slots.map(slotPhrase).join('; ');
	return [
		`Shot: ${shot} ${layout.ctx.beatName} picture-book spread in ${layout.ctx.locale}.`,
		`Composition: ${slotClauses}.`,
		`Scene brief: ${sceneBrief}`,
		`clear empty area at ${textZonePosition} for text.`,
	].join(' ');
}

function describeQuery(query: BankAssetQuery): string {
	const parts = [
		`style ${query.styleId}`,
		query.locale ? `locale ${query.locale}` : undefined,
		query.beatMood ? `beat mood ${query.beatMood}` : undefined,
		query.archetypeId ? `archetype ${query.archetypeId}` : undefined,
		query.poseClass ? `pose ${query.poseClass}` : undefined,
		query.propId ? `prop ${query.propId}` : undefined,
	].filter((part): part is string => Boolean(part));
	return parts.join(', ');
}

export function serializeBankPreGenPrompts(
	query: BankAssetQuery,
	dnaPrompt?: string,
): { positive: string; negative: string } {
	if (query.layer === 'A') {
		return {
			positive: `Layer A empty stage background plate, ${describeQuery(query)}, explicit negative-space composition, no focal characters.`,
			negative: 'people, characters, text, watermark',
		};
	}
	if (query.layer === 'B') {
		const dna = dnaPrompt ? `${dnaPrompt}, ` : '';
		return {
			positive: `Layer B character sprite, ${dna}${describeQuery(query)}, solid uniform green background, full body isolated asset.`,
			negative: 'text, watermark, props, scenic background',
		};
	}
	return {
		positive: `Layer C isolated prop sprite, ${describeQuery(query)}, solid uniform green background, clean silhouette.`,
		negative: 'people, characters, text, watermark, scenic background',
	};
}
