// tests/imagegen/workflows-split-loader.test.ts
//
// The pillar-gen template must target the split-loader Qwen-Image-2512 stack
// actually installed on the GPU server (UNETLoader fp8 + CLIPLoader
// qwen_image + VAELoader + Lightning-8step LoRA at 8 steps / cfg 1.0) — the
// graph proven end-to-end by scripts/e2e/generate-real-book.mjs. The old
// CheckpointLoaderSimple checkpoint does not exist on the server.

import { describe, expect, it } from 'vitest';

import {
	AURAFLOW_SHIFT,
	LIGHTNING_CFG,
	LIGHTNING_STEPS,
	LOCAL_SPLIT_MODELS,
	PILLAR_GEN_TEMPLATE,
	instantiateWorkflow,
} from '$lib/services/imagegen';

describe('pillar-gen split-loader stack', () => {
	const graph = PILLAR_GEN_TEMPLATE.graph;

	it('contains no CheckpointLoaderSimple node', () => {
		const classes = Object.values(graph).map((n) => n.class_type);
		expect(classes).not.toContain('CheckpointLoaderSimple');
	});

	it('loads the fp8 UNET via UNETLoader', () => {
		expect(graph['1'].class_type).toBe('UNETLoader');
		expect(graph['1'].inputs.unet_name).toBe(LOCAL_SPLIT_MODELS.unet);
		expect(LOCAL_SPLIT_MODELS.unet).toMatch(/fp8/);
	});

	it('loads CLIP via a qwen_image CLIPLoader feeding both text encoders', () => {
		expect(graph['20'].class_type).toBe('CLIPLoader');
		expect(graph['20'].inputs.clip_name).toBe(LOCAL_SPLIT_MODELS.clip);
		expect(graph['20'].inputs.type).toBe('qwen_image');
		expect(graph['2'].class_type).toBe('CLIPTextEncode');
		expect(graph['2'].inputs.clip).toEqual(['20', 0]);
		expect(graph['3'].inputs.clip).toEqual(['20', 0]);
	});

	it('loads the VAE via VAELoader feeding the decode', () => {
		expect(graph['21'].class_type).toBe('VAELoader');
		expect(graph['21'].inputs.vae_name).toBe(LOCAL_SPLIT_MODELS.vae);
		expect(graph['6'].class_type).toBe('VAEDecode');
		expect(graph['6'].inputs.vae).toEqual(['21', 0]);
	});

	it('chains UNET → Lightning LoRA → AuraFlow shift → KSampler at 8 steps cfg 1.0', () => {
		expect(graph['8'].class_type).toBe('LoraLoaderModelOnly');
		expect(graph['8'].inputs.lora_name).toBe(LOCAL_SPLIT_MODELS.lightningLora);
		expect(graph['8'].inputs.strength_model).toBe(1.0);
		expect(graph['8'].inputs.model).toEqual(['1', 0]);

		expect(graph['9'].class_type).toBe('ModelSamplingAuraFlow');
		expect(graph['9'].inputs.shift).toBe(AURAFLOW_SHIFT);
		expect(graph['9'].inputs.model).toEqual(['8', 0]);

		expect(graph['5'].class_type).toBe('KSampler');
		expect(graph['5'].inputs.model).toEqual(['9', 0]);
		expect(graph['5'].inputs.steps).toBe(LIGHTNING_STEPS);
		expect(graph['5'].inputs.cfg).toBe(LIGHTNING_CFG);
		expect(LIGHTNING_STEPS).toBe(8);
		expect(LIGHTNING_CFG).toBe(1.0);
	});

	it('uses the SD3-family empty latent and keeps the storybook/pillar prefix', () => {
		expect(graph['4'].class_type).toBe('EmptySD3LatentImage');
		expect(graph['7'].class_type).toBe('SaveImage');
		expect(graph['7'].inputs.filename_prefix).toBe('storybook/pillar');
	});

	it('instantiates with slots into a JSON-serializable graph without mutating the constant', () => {
		const filled = instantiateWorkflow(PILLAR_GEN_TEMPLATE, {
			prompt: 'a cozy lighthouse',
			negativePrompt: 'blurry',
			width: 768,
			height: 512,
			seed: 41,
			batchCount: 2,
		});
		expect(filled['2'].inputs.text).toBe('a cozy lighthouse');
		expect(filled['3'].inputs.text).toBe('blurry');
		expect(filled['4'].inputs).toMatchObject({ width: 768, height: 512, batch_size: 2 });
		expect(filled['5'].inputs.seed).toBe(41);
		// Round-trips through JSON (the /prompt API wire format).
		expect(JSON.parse(JSON.stringify(filled))).toEqual(filled);
		// Constant untouched.
		expect(graph['2'].inputs.text).toBe('');
		expect(graph['5'].inputs.seed).toBe(0);
	});
});
