import { findAsset } from './BankManifestStore';
import { isSlotRequiredForBeat } from './GrammarTemplates';
import type {
	BankAssetQuery,
	BankManifest,
	CollapsedLayout,
	CompositionPlan,
	SlotId,
} from './types';

function requiredForLayout(layout: CollapsedLayout, slotId: SlotId): boolean {
	return isSlotRequiredForBeat(layout.ctx.beatName, slotId);
}

export function planComposition(layout: CollapsedLayout, manifest: BankManifest | null): CompositionPlan {
	const resolvedAssets: CompositionPlan['resolvedAssets'] = [];
	const allMisses: BankAssetQuery[] = [];
	const requiredMisses: BankAssetQuery[] = [];

	for (const slot of layout.slots) {
		const query = slot.assetQuery;
		if (!query) continue;
		const required = requiredForLayout(layout, slot.slotId);
		if (!manifest) {
			allMisses.push(query);
			if (required) requiredMisses.push(query);
			continue;
		}
		const asset = findAsset(manifest, query);
		if (asset) {
			resolvedAssets.push({ slotId: slot.slotId, assetId: asset.assetId, file: asset.file });
			continue;
		}
		allMisses.push(query);
		if (required) requiredMisses.push(query);
	}

	const fallbackToDirectGen = manifest === null || requiredMisses.length > 0;
	return {
		layout,
		mode: fallbackToDirectGen ? 'direct-gen' : 'bank-composite',
		resolvedAssets,
		missingAssets: fallbackToDirectGen ? allMisses : [],
		fallbackToDirectGen,
	};
}
