// @graph-layer: private
// @rationale: private (workflow templates carry story prompts at runtime)
//
// src/lib/services/imagegen/workflows.ts
//
// ComfyUI workflow-JSON templates, encoded as code constants with injectable
// slots (prompt / seed / dimensions / refs / lora / upscale source). One
// template per pipeline:
//
//   - pillar-gen            txt2img base — split-loader Qwen-Image-2512
//                           stack (UNETLoader fp8 + CLIPLoader qwen_image +
//                           VAELoader + Lightning-8step LoRA, 8 steps
//                           cfg 1.0). This is what's actually installed on
//                           the 4090 server (models live in
//                           diffusion_models/ as split UNET+CLIP+VAE) and
//                           was proven end-to-end by
//                           scripts/e2e/generate-real-book.mjs
//                           (feat/e2e-real-book @ ca00d61). The previous
//                           CheckpointLoaderSimple graph targeted a
//                           checkpoint that does not exist on the server.
//   - spread-gen-multi-ref  PRIMARY character-consistency path: condition
//                           every spread on the hero + sidekick character
//                           sheets via Qwen-Image-Edit-2511 multi-reference
//                           conditioning (sheets generated once per book via
//                           the 2511 multiple-angles LoRA — front/side/back)
//   - lora-spread           FALLBACK character-consistency path: per-character
//                           LoRA trained locally with ai-toolkit
//                           (train_lora_qwen_image_24gb.yaml, 20-40
//                           sheet-derived images, ~2000 steps ≈ 2h on the
//                           4090), loaded via LoraLoader
//   - upscale               print-res upscaling (4x ESRGAN-family model +
//                           lanczos post-scale to hit exact target factor)
//
// `instantiateWorkflow` deep-clones a template and fills its slots; the
// constants themselves are never mutated.

import { ImageGenError } from './types';

// ---------------------------------------------------------------------------
// Graph shapes (ComfyUI /prompt API format)
// ---------------------------------------------------------------------------

export interface ComfyNode {
	class_type: string;
	inputs: Record<string, unknown>;
	_meta?: { title?: string };
}

export type ComfyWorkflowGraph = Record<string, ComfyNode>;

export type WorkflowId = 'pillar-gen' | 'spread-gen-multi-ref' | 'lora-spread' | 'upscale';

export interface WorkflowSlotValues {
	prompt?: string;
	negativePrompt?: string;
	width?: number;
	height?: number;
	seed?: number;
	batchCount?: number;
	/** ComfyUI-side image names (already uploaded) for reference conditioning. */
	refImages?: string[];
	loraName?: string;
	loraStrength?: number;
	/** ComfyUI-side image name of the upscale source. */
	sourceImage?: string;
	/** Lanczos post-scale factor applied after the fixed 4x model pass. */
	postScaleBy?: number;
}

interface SlotBinding {
	nodeId: string;
	inputKey: string;
}

export interface WorkflowTemplate {
	id: WorkflowId;
	graph: ComfyWorkflowGraph;
	bindings: Partial<Record<keyof WorkflowSlotValues, SlotBinding[]>>;
	/**
	 * Reference-image slots, in order. At instantiation, slots beyond
	 * `refImages.length` are pruned: the LoadImage node is dropped and every
	 * consumer input that pointed at it is deleted.
	 */
	refSlots?: Array<{ loadNodeId: string; consumers: SlotBinding[] }>;
}

// ---------------------------------------------------------------------------
// Model constants
// ---------------------------------------------------------------------------

export const LOCAL_CHECKPOINTS = Object.freeze({
	txt2img: 'qwen-image-2512-fp8.safetensors',
	edit: 'qwen-image-edit-2511-fp8.safetensors',
});

/**
 * Split-loader model files actually installed on the GPU server (verified
 * via /object_info + /models by the e2e real-book run): UNET + CLIP + VAE
 * load separately, with the Lightning 8-step distillation LoRA on top.
 */
export const LOCAL_SPLIT_MODELS = Object.freeze({
	unet: 'qwen_image_2512_fp8_e4m3fn.safetensors',
	clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
	vae: 'qwen_image_vae.safetensors',
	lightningLora: 'Qwen-Image-2512-Lightning-8steps-V1.0-bf16.safetensors',
});

/** Lightning-8step distillation sampling params (proven cfg/steps pair). */
export const LIGHTNING_STEPS = 8;
export const LIGHTNING_CFG = 1.0;
/** ModelSamplingAuraFlow shift used with the Lightning LoRA. */
export const AURAFLOW_SHIFT = 3.1;

export const UPSCALE_MODEL_NAME = '4x-UltraSharp.pth';
/** The upscale model's intrinsic factor; postScaleBy trims to target. */
export const UPSCALE_MODEL_FACTOR = 4;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * (a) txt2img base — pillar generation. Split-loader Qwen-Image-2512 stack
 * proven by the e2e real-book run: UNETLoader (fp8) → Lightning-8step LoRA →
 * ModelSamplingAuraFlow → KSampler at 8 steps / cfg 1.0, with a standalone
 * qwen_image CLIPLoader feeding both text encoders and a standalone
 * VAELoader feeding the decode.
 */
export const PILLAR_GEN_TEMPLATE: WorkflowTemplate = Object.freeze({
	id: 'pillar-gen' as const,
	graph: {
		'1': {
			class_type: 'UNETLoader',
			inputs: { unet_name: LOCAL_SPLIT_MODELS.unet, weight_dtype: 'default' },
			_meta: { title: 'Qwen-Image-2512 fp8 UNET' },
		},
		'8': {
			class_type: 'LoraLoaderModelOnly',
			inputs: {
				lora_name: LOCAL_SPLIT_MODELS.lightningLora,
				strength_model: 1.0,
				model: ['1', 0],
			},
			_meta: { title: 'Lightning 8-step' },
		},
		'9': {
			class_type: 'ModelSamplingAuraFlow',
			inputs: { shift: AURAFLOW_SHIFT, model: ['8', 0] },
		},
		'20': {
			class_type: 'CLIPLoader',
			inputs: { clip_name: LOCAL_SPLIT_MODELS.clip, type: 'qwen_image' },
		},
		'21': {
			class_type: 'VAELoader',
			inputs: { vae_name: LOCAL_SPLIT_MODELS.vae },
		},
		'2': {
			class_type: 'CLIPTextEncode',
			inputs: { text: '', clip: ['20', 0] },
			_meta: { title: 'positive prompt' },
		},
		'3': {
			class_type: 'CLIPTextEncode',
			inputs: { text: '', clip: ['20', 0] },
			_meta: { title: 'negative prompt' },
		},
		'4': {
			class_type: 'EmptySD3LatentImage',
			inputs: { width: 1024, height: 1024, batch_size: 1 },
		},
		'5': {
			class_type: 'KSampler',
			inputs: {
				seed: 0,
				steps: LIGHTNING_STEPS,
				cfg: LIGHTNING_CFG,
				sampler_name: 'euler',
				scheduler: 'simple',
				denoise: 1.0,
				model: ['9', 0],
				positive: ['2', 0],
				negative: ['3', 0],
				latent_image: ['4', 0],
			},
		},
		'6': {
			class_type: 'VAEDecode',
			inputs: { samples: ['5', 0], vae: ['21', 0] },
		},
		'7': {
			class_type: 'SaveImage',
			inputs: { images: ['6', 0], filename_prefix: 'storybook/pillar' },
		},
	},
	bindings: {
		prompt: [{ nodeId: '2', inputKey: 'text' }],
		negativePrompt: [{ nodeId: '3', inputKey: 'text' }],
		width: [{ nodeId: '4', inputKey: 'width' }],
		height: [{ nodeId: '4', inputKey: 'height' }],
		batchCount: [{ nodeId: '4', inputKey: 'batch_size' }],
		seed: [{ nodeId: '5', inputKey: 'seed' }],
	},
});

/** (b) character-consistent spread gen — Qwen-Image-Edit-2511 multi-ref. */
export const SPREAD_GEN_MULTI_REF_TEMPLATE: WorkflowTemplate = Object.freeze({
	id: 'spread-gen-multi-ref' as const,
	graph: {
		'1': {
			class_type: 'CheckpointLoaderSimple',
			inputs: { ckpt_name: LOCAL_CHECKPOINTS.edit },
			_meta: { title: 'Qwen-Image-Edit-2511 checkpoint' },
		},
		'10': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'character ref 1' } },
		'11': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'character ref 2' } },
		'12': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'character ref 3' } },
		'2': {
			class_type: 'TextEncodeQwenImageEditPlus',
			inputs: {
				prompt: '',
				clip: ['1', 1],
				vae: ['1', 2],
				image1: ['10', 0],
				image2: ['11', 0],
				image3: ['12', 0],
			},
			_meta: { title: 'positive multi-ref conditioning' },
		},
		'3': {
			class_type: 'TextEncodeQwenImageEditPlus',
			inputs: {
				prompt: '',
				clip: ['1', 1],
				vae: ['1', 2],
				image1: ['10', 0],
				image2: ['11', 0],
				image3: ['12', 0],
			},
			_meta: { title: 'negative multi-ref conditioning' },
		},
		'4': {
			class_type: 'EmptyLatentImage',
			inputs: { width: 1024, height: 1024, batch_size: 1 },
		},
		'5': {
			class_type: 'KSampler',
			inputs: {
				seed: 0,
				steps: 28,
				cfg: 4.0,
				sampler_name: 'euler',
				scheduler: 'simple',
				denoise: 1.0,
				model: ['1', 0],
				positive: ['2', 0],
				negative: ['3', 0],
				latent_image: ['4', 0],
			},
		},
		'6': {
			class_type: 'VAEDecode',
			inputs: { samples: ['5', 0], vae: ['1', 2] },
		},
		'7': {
			class_type: 'SaveImage',
			inputs: { images: ['6', 0], filename_prefix: 'storybook/spread' },
		},
	},
	bindings: {
		prompt: [{ nodeId: '2', inputKey: 'prompt' }],
		negativePrompt: [{ nodeId: '3', inputKey: 'prompt' }],
		width: [{ nodeId: '4', inputKey: 'width' }],
		height: [{ nodeId: '4', inputKey: 'height' }],
		batchCount: [{ nodeId: '4', inputKey: 'batch_size' }],
		seed: [{ nodeId: '5', inputKey: 'seed' }],
	},
	refSlots: [
		{
			loadNodeId: '10',
			consumers: [
				{ nodeId: '2', inputKey: 'image1' },
				{ nodeId: '3', inputKey: 'image1' },
			],
		},
		{
			loadNodeId: '11',
			consumers: [
				{ nodeId: '2', inputKey: 'image2' },
				{ nodeId: '3', inputKey: 'image2' },
			],
		},
		{
			loadNodeId: '12',
			consumers: [
				{ nodeId: '2', inputKey: 'image3' },
				{ nodeId: '3', inputKey: 'image3' },
			],
		},
	],
});

/** (b-fallback) per-character LoRA spread gen (ai-toolkit-trained). */
export const LORA_SPREAD_TEMPLATE: WorkflowTemplate = Object.freeze({
	id: 'lora-spread' as const,
	graph: {
		'1': {
			class_type: 'CheckpointLoaderSimple',
			inputs: { ckpt_name: LOCAL_CHECKPOINTS.txt2img },
			_meta: { title: 'Qwen-Image-2512 checkpoint' },
		},
		'8': {
			class_type: 'LoraLoader',
			inputs: {
				lora_name: '',
				strength_model: 0.9,
				strength_clip: 1.0,
				model: ['1', 0],
				clip: ['1', 1],
			},
			_meta: { title: 'character LoRA' },
		},
		'2': {
			class_type: 'CLIPTextEncode',
			inputs: { text: '', clip: ['8', 1] },
			_meta: { title: 'positive prompt' },
		},
		'3': {
			class_type: 'CLIPTextEncode',
			inputs: { text: '', clip: ['8', 1] },
			_meta: { title: 'negative prompt' },
		},
		'4': {
			class_type: 'EmptyLatentImage',
			inputs: { width: 1024, height: 1024, batch_size: 1 },
		},
		'5': {
			class_type: 'KSampler',
			inputs: {
				seed: 0,
				steps: 28,
				cfg: 4.0,
				sampler_name: 'euler',
				scheduler: 'simple',
				denoise: 1.0,
				model: ['8', 0],
				positive: ['2', 0],
				negative: ['3', 0],
				latent_image: ['4', 0],
			},
		},
		'6': {
			class_type: 'VAEDecode',
			inputs: { samples: ['5', 0], vae: ['1', 2] },
		},
		'7': {
			class_type: 'SaveImage',
			inputs: { images: ['6', 0], filename_prefix: 'storybook/lora-spread' },
		},
	},
	bindings: {
		prompt: [{ nodeId: '2', inputKey: 'text' }],
		negativePrompt: [{ nodeId: '3', inputKey: 'text' }],
		width: [{ nodeId: '4', inputKey: 'width' }],
		height: [{ nodeId: '4', inputKey: 'height' }],
		batchCount: [{ nodeId: '4', inputKey: 'batch_size' }],
		seed: [{ nodeId: '5', inputKey: 'seed' }],
		loraName: [{ nodeId: '8', inputKey: 'lora_name' }],
		loraStrength: [{ nodeId: '8', inputKey: 'strength_model' }],
	},
});

/** (c) upscale-to-print-res. */
export const UPSCALE_TEMPLATE: WorkflowTemplate = Object.freeze({
	id: 'upscale' as const,
	graph: {
		'1': { class_type: 'LoadImage', inputs: { image: '' }, _meta: { title: 'upscale source' } },
		'2': {
			class_type: 'UpscaleModelLoader',
			inputs: { model_name: UPSCALE_MODEL_NAME },
		},
		'3': {
			class_type: 'ImageUpscaleWithModel',
			inputs: { upscale_model: ['2', 0], image: ['1', 0] },
		},
		'4': {
			class_type: 'ImageScaleBy',
			inputs: { image: ['3', 0], upscale_method: 'lanczos', scale_by: 1.0 },
		},
		'7': {
			class_type: 'SaveImage',
			inputs: { images: ['4', 0], filename_prefix: 'storybook/print' },
		},
	},
	bindings: {
		sourceImage: [{ nodeId: '1', inputKey: 'image' }],
		postScaleBy: [{ nodeId: '4', inputKey: 'scale_by' }],
	},
});

export const WORKFLOW_TEMPLATES: Readonly<Record<WorkflowId, WorkflowTemplate>> = Object.freeze({
	'pillar-gen': PILLAR_GEN_TEMPLATE,
	'spread-gen-multi-ref': SPREAD_GEN_MULTI_REF_TEMPLATE,
	'lora-spread': LORA_SPREAD_TEMPLATE,
	upscale: UPSCALE_TEMPLATE,
});

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

const SLOT_NAMES: ReadonlyArray<keyof WorkflowSlotValues> = [
	'prompt',
	'negativePrompt',
	'width',
	'height',
	'seed',
	'batchCount',
	'refImages',
	'loraName',
	'loraStrength',
	'sourceImage',
	'postScaleBy',
];

/**
 * Deep-clone `template.graph` and inject the provided slot values. The
 * template constant is never mutated. Unused reference slots are pruned.
 */
export function instantiateWorkflow(
	template: WorkflowTemplate,
	slots: WorkflowSlotValues,
): ComfyWorkflowGraph {
	const graph: ComfyWorkflowGraph = structuredClone(template.graph) as ComfyWorkflowGraph;

	for (const slotName of SLOT_NAMES) {
		if (slotName === 'refImages') continue; // handled via refSlots below
		const value = slots[slotName];
		const bindings = template.bindings[slotName];
		if (value === undefined || !bindings) continue;
		for (const b of bindings) {
			const node = graph[b.nodeId];
			if (!node) {
				throw new ImageGenError(
					'provider',
					`workflow ${template.id}: slot ${String(slotName)} targets missing node ${b.nodeId}`,
				);
			}
			node.inputs[b.inputKey] = value;
		}
	}

	if (template.refSlots) {
		const refs = slots.refImages ?? [];
		if (refs.length === 0) {
			throw new ImageGenError(
				'invalid-request',
				`workflow ${template.id}: at least one reference image required`,
			);
		}
		if (refs.length > template.refSlots.length) {
			throw new ImageGenError(
				'invalid-request',
				`workflow ${template.id}: supports at most ${template.refSlots.length} reference images (got ${refs.length})`,
			);
		}
		template.refSlots.forEach((slot, i) => {
			if (i < refs.length) {
				graph[slot.loadNodeId].inputs['image'] = refs[i];
			} else {
				delete graph[slot.loadNodeId];
				for (const c of slot.consumers) {
					const node = graph[c.nodeId];
					if (node) delete node.inputs[c.inputKey];
				}
			}
		});
	}

	return graph;
}
