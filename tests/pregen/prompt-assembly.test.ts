// @ts-nocheck
import { describe, expect, it } from 'vitest';

import {
	buildPlatePrompt,
	buildPosePrompt,
	buildPropPrompt,
} from '../../scripts/pregen/lib/jobs.mjs';

const stylePrompts = {
	'storybook-ink': {
		prefix: 'storybook ink wash prefix',
		suffix: 'soft hand-painted suffix',
		negative: 'muddy colors',
	},
};

describe('pregen prompt assembly', () => {
	it('builds empty-stage plate prompts with locale, mood, and character negatives', () => {
		const prompt = buildPlatePrompt({
			locale: 'forest',
			beatMood: 'setup',
			styleId: 'storybook-ink',
			stylePrompts,
		});

		expect(prompt.positive).toContain('storybook ink wash prefix');
		expect(prompt.positive).toContain('empty stage');
		expect(prompt.positive).toContain('open negative space');
		expect(prompt.positive).toContain('locale biome: forest');
		expect(prompt.positive).toContain('beat mood: setup');
		expect(prompt.negative).toContain('characters');
		expect(prompt.negative).toContain('muddy colors');
	});

	it('builds pose prompts with dnaPrompt verbatim, pose wording, and chroma key', () => {
		const archetype = {
			id: 'p001',
			dnaPrompt: 'A young girl with warm tan-brown skin and round glasses.',
		};
		const prompt = buildPosePrompt({
			archetype,
			poseClass: 'pointing',
			styleId: 'storybook-ink',
			stylePrompts,
		});

		expect(prompt.positive).toContain(archetype.dnaPrompt);
		expect(prompt.positive).toContain('pointing with one hand');
		expect(prompt.positive).toContain('solid uniform chroma green background');
		expect(prompt.negative).toContain('cropped limbs');
	});

	it('builds prop prompts with style prefix and solid-key isolation', () => {
		const prompt = buildPropPrompt({
			prop: { propId: 'lantern', label: 'warm paper lantern' },
			styleId: 'storybook-ink',
			stylePrompts,
		});

		expect(prompt.positive).toContain('storybook ink wash prefix');
		expect(prompt.positive).toContain('warm paper lantern');
		expect(prompt.positive).toContain('solid uniform chroma green background');
		expect(prompt.positive).toContain('centered object');
	});
});
