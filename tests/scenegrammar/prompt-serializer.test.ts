import { describe, expect, it } from 'vitest';

import {
	collapseLayout,
	serializeBankPreGenPrompts,
	serializeDirectGenPrompt,
} from '$lib/services/scenegrammar';

describe('scenegrammar prompt serializer', () => {
	it('serializes direct-gen prompts deterministically with shot, facing, text zone, and scene brief', () => {
		const layout = collapseLayout({
			bookId: 'prompt-book',
			spreadIndex: 6,
			beatName: 'catalyst',
			locale: 'meadow',
			styleId: 'opaque-style',
			castArchetypeIds: ['hero-fox', 'sidekick-moon'],
			focalPropId: 'lantern',
			pageTurnDirection: 'ltr',
		});
		const sceneBrief = 'the hero discovers a glowing lantern beside the path';
		const first = serializeDirectGenPrompt(layout, sceneBrief);
		const second = serializeDirectGenPrompt(layout, sceneBrief);
		expect(second).toBe(first);
		expect(first).toContain('Shot: medium');
		expect(first).toContain('facing');
		expect(first).toContain('clear empty area at');
		expect(first).toContain(sceneBrief);
	});

	it('serializes Layer A bank prompts with empty stage wording and character negatives', () => {
		const prompts = serializeBankPreGenPrompts({
			layer: 'A',
			styleId: 'opaque-style',
			locale: 'forest',
			beatMood: 'setup',
		});
		expect(prompts.positive).toContain('empty stage');
		expect(prompts.negative).toContain('characters');
	});
});
