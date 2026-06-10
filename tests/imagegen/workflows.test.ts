// tests/imagegen/workflows.test.ts
//
// Workflow-JSON template constants + slot instantiation.

import { describe, it, expect } from 'vitest';
import {
	WORKFLOW_TEMPLATES,
	PILLAR_GEN_TEMPLATE,
	SPREAD_GEN_MULTI_REF_TEMPLATE,
	UPSCALE_TEMPLATE,
	instantiateWorkflow,
	ImageGenError,
} from '$lib/services/imagegen';

describe('workflow templates', () => {
	it('exposes one template per pipeline', () => {
		expect(Object.keys(WORKFLOW_TEMPLATES).sort()).toEqual([
			'lora-spread',
			'pillar-gen',
			'spread-gen-multi-ref',
			'upscale',
		]);
		for (const [id, template] of Object.entries(WORKFLOW_TEMPLATES)) {
			expect(template.id).toBe(id);
			expect(Object.keys(template.graph).length).toBeGreaterThan(0);
		}
	});

	it('instantiateWorkflow injects slots without mutating the template constant', () => {
		const graph = instantiateWorkflow(PILLAR_GEN_TEMPLATE, {
			prompt: 'a cozy lighthouse',
			negativePrompt: 'blurry',
			width: 768,
			height: 512,
			seed: 99,
			batchCount: 2,
		});
		expect(graph['2'].inputs.text).toBe('a cozy lighthouse');
		expect(graph['3'].inputs.text).toBe('blurry');
		expect(graph['4'].inputs).toMatchObject({ width: 768, height: 512, batch_size: 2 });
		expect(graph['5'].inputs.seed).toBe(99);
		// Template constant untouched.
		expect(PILLAR_GEN_TEMPLATE.graph['2'].inputs.text).toBe('');
		expect(PILLAR_GEN_TEMPLATE.graph['5'].inputs.seed).toBe(0);
	});

	it('prunes unused reference slots (LoadImage node + consumer inputs)', () => {
		const graph = instantiateWorkflow(SPREAD_GEN_MULTI_REF_TEMPLATE, {
			prompt: 'spread 3',
			refImages: ['hero-sheet.png', 'sidekick-sheet.png'],
		});
		expect(graph['10'].inputs.image).toBe('hero-sheet.png');
		expect(graph['11'].inputs.image).toBe('sidekick-sheet.png');
		expect(graph['12']).toBeUndefined();
		expect(graph['2'].inputs.image1).toEqual(['10', 0]);
		expect(graph['2'].inputs.image2).toEqual(['11', 0]);
		expect('image3' in graph['2'].inputs).toBe(false);
		expect('image3' in graph['3'].inputs).toBe(false);
	});

	it('multi-ref template requires 1..3 reference images', () => {
		expect(() =>
			instantiateWorkflow(SPREAD_GEN_MULTI_REF_TEMPLATE, { prompt: 'x', refImages: [] }),
		).toThrowError(ImageGenError);
		expect(() =>
			instantiateWorkflow(SPREAD_GEN_MULTI_REF_TEMPLATE, {
				prompt: 'x',
				refImages: ['a', 'b', 'c', 'd'],
			}),
		).toThrowError(/at most 3/);
	});

	it('upscale template binds source image + lanczos post-scale', () => {
		const graph = instantiateWorkflow(UPSCALE_TEMPLATE, {
			sourceImage: 'spread-04.png',
			postScaleBy: 0.5,
		});
		expect(graph['1'].inputs.image).toBe('spread-04.png');
		expect(graph['2'].class_type).toBe('UpscaleModelLoader');
		expect(graph['4'].inputs.scale_by).toBe(0.5);
	});
});
