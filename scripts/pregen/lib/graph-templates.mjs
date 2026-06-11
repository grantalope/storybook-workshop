// @ts-nocheck

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) {
			deepFreeze(child);
		}
	}
	return value;
}

export const T2I_LIGHTNING_GRAPH = deepFreeze({
	'37': {
		class_type: 'UNETLoader',
		inputs: { unet_name: 'qwen_image_2512_fp8_e4m3fn.safetensors', weight_dtype: 'default' },
	},
	'70': {
		class_type: 'LoraLoaderModelOnly',
		inputs: {
			lora_name: 'Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors',
			strength_model: 1.0,
			model: ['37', 0],
		},
	},
	'38': {
		class_type: 'CLIPLoader',
		inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default' },
	},
	'39': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
	'66': { class_type: 'ModelSamplingAuraFlow', inputs: { shift: 3.1, model: ['70', 0] } },
	'6': { class_type: 'CLIPTextEncode', inputs: { text: 'POSITIVE', clip: ['38', 0] } },
	'7': { class_type: 'CLIPTextEncode', inputs: { text: 'NEGATIVE', clip: ['38', 0] } },
	'58': { class_type: 'EmptySD3LatentImage', inputs: { width: 1328, height: 1328, batch_size: 1 } },
	'3': {
		class_type: 'KSampler',
		inputs: {
			seed: 42,
			steps: 4,
			cfg: 1.0,
			sampler_name: 'euler',
			scheduler: 'simple',
			denoise: 1.0,
			model: ['66', 0],
			positive: ['6', 0],
			negative: ['7', 0],
			latent_image: ['58', 0],
		},
	},
	'8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['39', 0] } },
	'60': { class_type: 'SaveImage', inputs: { filename_prefix: 'PREFIX', images: ['8', 0] } },
});

function cloneGraph(graph) {
	return JSON.parse(JSON.stringify(graph));
}

export function patchGraph(graph, patch) {
	const next = cloneGraph(graph);
	if (patch.positive !== undefined) next['6'].inputs.text = patch.positive;
	if (patch.negative !== undefined) next['7'].inputs.text = patch.negative;
	if (patch.width !== undefined) next['58'].inputs.width = patch.width;
	if (patch.height !== undefined) next['58'].inputs.height = patch.height;
	if (patch.seed !== undefined) next['3'].inputs.seed = patch.seed;
	if (patch.steps !== undefined) next['3'].inputs.steps = patch.steps;
	if (patch.filenamePrefix !== undefined) next['60'].inputs.filename_prefix = patch.filenamePrefix;
	return next;
}
