// @graph-layer: private
// @rationale: private (talks to the local GPU box over Tailscale)
//
// src/lib/services/imagegen/LocalGpuProvider.ts
//
// ImageGenProvider backed by the headless ComfyUI serving stack on the 4090
// box (Windows-native — no WSL2: native CUDA, simpler networking), launched
// as a service with `--listen <tailscale-ip> --port 8188` and reached
// cross-machine over the Tailscale network at IMAGE_GEN_SERVER_URL
// (default http://100.101.215.25:8188).
//
// Batch generation is driven programmatically via the /prompt HTTP API with
// the exported workflow-JSON templates in ./workflows (pillar-gen,
// spread-gen-multi-ref, lora-spread, upscale). Completion is detected by
// polling /history/{prompt_id} (poll-based rather than the websocket — far
// simpler to make robust across reconnects, and latency is dominated by
// diffusion time anyway). Result images are pulled via /view.
//
// Like StripeCheckoutService / LuluFulfillmentService, all network IO is
// wrapped behind an injectable ComfyHttpClient interface; tests pass an
// in-memory mock, production wires the default fetch-based impl.

import { secureRandomInt, secureRandomString } from '$lib/services/subscription/secureRandom';
import {
	ImageGenError,
	MAX_SEED_EXCLUSIVE,
	classifyRefs,
	parseLoraStyleId,
	validateImageGenRequest,
	type ImageGenProvider,
	type ImageGenRequest,
	type ImageGenResult,
	type UpscaleRequest,
	type UpscaleResult,
} from './types';
import {
	UPSCALE_MODEL_FACTOR,
	WORKFLOW_TEMPLATES,
	instantiateWorkflow,
	type ComfyWorkflowGraph,
	type WorkflowSlotValues,
	type WorkflowTemplate,
} from './workflows';

// ---------------------------------------------------------------------------
// HTTP boundary (injectable)
// ---------------------------------------------------------------------------

export interface ComfyImageRef {
	filename: string;
	subfolder: string;
	type: string;
}

export interface ComfyQueueResponse {
	prompt_id: string;
	number?: number;
	node_errors?: Record<string, unknown>;
}

export interface ComfyHistoryOutput {
	images?: ComfyImageRef[];
}

export interface ComfyHistoryEntry {
	status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
	outputs?: Record<string, ComfyHistoryOutput>;
}

export interface ComfyUploadResponse {
	name: string;
	subfolder?: string;
	type?: string;
}

export interface ComfyHttpClient {
	/** POST /prompt — queue a workflow graph; returns the prompt id. */
	postPrompt(graph: ComfyWorkflowGraph, clientId: string): Promise<ComfyQueueResponse>;
	/** GET /history/{promptId} — null until the run shows up in history. */
	getHistory(promptId: string): Promise<ComfyHistoryEntry | null>;
	/** GET /view — fetch one output image. */
	getImage(ref: ComfyImageRef): Promise<Blob>;
	/** POST /upload/image — push a reference/source image to the server. */
	uploadImage(image: Blob, filename: string): Promise<ComfyUploadResponse>;
}

export const DEFAULT_IMAGE_GEN_SERVER_URL = 'http://100.101.215.25:8188';

export function createFetchComfyHttpClient(
	baseUrl: string = DEFAULT_IMAGE_GEN_SERVER_URL,
	fetchImpl: typeof fetch = fetch,
): ComfyHttpClient {
	const base = baseUrl.replace(/\/+$/, '');

	function expectOk(res: Response, what: string): Response {
		if (!res.ok) {
			throw new ImageGenError('http', `ComfyUI ${what} failed: HTTP ${res.status}`);
		}
		return res;
	}

	return {
		async postPrompt(graph, clientId) {
			const res = expectOk(
				await fetchImpl(`${base}/prompt`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ prompt: graph, client_id: clientId }),
				}),
				'POST /prompt',
			);
			return (await res.json()) as ComfyQueueResponse;
		},
		async getHistory(promptId) {
			const res = expectOk(
				await fetchImpl(`${base}/history/${encodeURIComponent(promptId)}`),
				'GET /history',
			);
			const all = (await res.json()) as Record<string, ComfyHistoryEntry>;
			return all[promptId] ?? null;
		},
		async getImage(ref) {
			const qs = new URLSearchParams({
				filename: ref.filename,
				subfolder: ref.subfolder ?? '',
				type: ref.type ?? 'output',
			});
			const res = expectOk(await fetchImpl(`${base}/view?${qs.toString()}`), 'GET /view');
			return await res.blob();
		},
		async uploadImage(image, filename) {
			const form = new FormData();
			form.append('image', image, filename);
			form.append('overwrite', 'true');
			const res = expectOk(
				await fetchImpl(`${base}/upload/image`, { method: 'POST', body: form }),
				'POST /upload/image',
			);
			return (await res.json()) as ComfyUploadResponse;
		},
	};
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface LocalGpuProviderOpts {
	http: ComfyHttpClient;
	/** Poll cadence against /history (default 750ms). */
	pollIntervalMs?: number;
	/** Hard deadline per run (default 180s — covers cold model load). */
	timeoutMs?: number;
	nowSource?: () => number;
	sleep?: (ms: number) => Promise<void>;
	clientId?: string;
	/** Injectable CSPRNG upload id source (tests pass deterministic values). */
	uploadIdSource?: () => string;
}

const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_TIMEOUT_MS = 180_000;
const UPLOAD_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectImageRefs(entry: ComfyHistoryEntry): ComfyImageRef[] {
	const refs: ComfyImageRef[] = [];
	for (const output of Object.values(entry.outputs ?? {})) {
		for (const img of output.images ?? []) refs.push(img);
	}
	return refs;
}

export class LocalGpuProvider implements ImageGenProvider {
	readonly name = 'local-gpu';

	private _http: ComfyHttpClient;
	private _pollIntervalMs: number;
	private _timeoutMs: number;
	private _now: () => number;
	private _sleep: (ms: number) => Promise<void>;
	private _clientId: string;
	private _uploadIdSource: () => string;

	constructor(opts: LocalGpuProviderOpts) {
		this._http = opts.http;
		this._pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this._timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this._now = opts.nowSource ?? (() => Date.now());
		this._sleep = opts.sleep ?? defaultSleep;
		this._clientId = opts.clientId ?? 'storybook-workshop';
		this._uploadIdSource =
			opts.uploadIdSource ?? (() => secureRandomString(16, UPLOAD_ID_ALPHABET));
	}

	async generate(req: ImageGenRequest): Promise<ImageGenResult> {
		validateImageGenRequest(req);
		const started = this._now();
		const seed = req.seed ?? secureRandomInt(MAX_SEED_EXCLUSIVE);
		const lora = parseLoraStyleId(req.styleId);
		const refs = classifyRefs(req.characterRefs ?? []);

		const slots: WorkflowSlotValues = {
			prompt: req.prompt,
			negativePrompt: req.negativePrompt ?? '',
			width: req.width,
			height: req.height,
			seed,
			batchCount: req.batchCount ?? 1,
		};

		// Template routing: refs win (PRIMARY consistency path — 2511
		// multi-reference conditioning); LoRA styleId is the FALLBACK path.
		let template: WorkflowTemplate;
		if (refs.kind !== 'none') {
			template = WORKFLOW_TEMPLATES['spread-gen-multi-ref'];
			slots.refImages =
				refs.kind === 'string' ? refs.names : await this._uploadRefs(refs.blobs);
		} else if (lora) {
			template = WORKFLOW_TEMPLATES['lora-spread'];
			slots.loraName = lora.path;
			slots.loraStrength = lora.scale;
		} else {
			template = WORKFLOW_TEMPLATES['pillar-gen'];
		}

		const graph = instantiateWorkflow(template, slots);
		const { promptId } = await this._queue(graph, template);
		const entry = await this._pollHistory(promptId);
		const imageRefs = collectImageRefs(entry);
		if (imageRefs.length === 0) {
			throw new ImageGenError('provider', `ComfyUI run ${promptId} completed with no images`);
		}
		const images = await Promise.all(imageRefs.map((r) => this._http.getImage(r)));

		return {
			images,
			seed,
			providerMeta: {
				provider: this.name,
				workflowId: template.id,
				promptId,
				durationMs: this._now() - started,
			},
		};
	}

	async upscale(req: UpscaleRequest): Promise<UpscaleResult> {
		const scale = req.scale ?? UPSCALE_MODEL_FACTOR;
		if (!Number.isFinite(scale) || scale <= 0 || scale > 8) {
			throw new ImageGenError('invalid-request', `imagegen: upscale scale must be in (0, 8] (got ${scale})`);
		}
		const started = this._now();
		const sourceImage =
			typeof req.image === 'string'
				? req.image
				: (await this._uploadRefs([req.image]))[0];

		const template = WORKFLOW_TEMPLATES['upscale'];
		const graph = instantiateWorkflow(template, {
			sourceImage,
			postScaleBy: scale / UPSCALE_MODEL_FACTOR,
		});
		const { promptId } = await this._queue(graph, template);
		const entry = await this._pollHistory(promptId);
		const imageRefs = collectImageRefs(entry);
		if (imageRefs.length === 0) {
			throw new ImageGenError('provider', `ComfyUI upscale ${promptId} completed with no images`);
		}
		const image = await this._http.getImage(imageRefs[0]);
		return {
			image,
			providerMeta: {
				provider: this.name,
				workflowId: template.id,
				promptId,
				durationMs: this._now() - started,
			},
		};
	}

	// -----------------------------------------------------------------------

	private async _queue(
		graph: ComfyWorkflowGraph,
		template: WorkflowTemplate,
	): Promise<{ promptId: string }> {
		const queued = await this._http.postPrompt(graph, this._clientId);
		if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
			throw new ImageGenError(
				'provider',
				`ComfyUI rejected workflow ${template.id}: ${JSON.stringify(queued.node_errors)}`,
				queued.node_errors,
			);
		}
		if (!queued.prompt_id) {
			throw new ImageGenError('provider', `ComfyUI /prompt returned no prompt_id for ${template.id}`);
		}
		return { promptId: queued.prompt_id };
	}

	private async _pollHistory(promptId: string): Promise<ComfyHistoryEntry> {
		const deadline = this._now() + this._timeoutMs;
		// First poll happens immediately; deadline is checked between polls.
		for (;;) {
			const entry = await this._http.getHistory(promptId);
			if (entry) {
				if (entry.status?.status_str === 'error') {
					throw new ImageGenError(
						'provider',
						`ComfyUI run ${promptId} failed (status=error)`,
						entry.status,
					);
				}
				if (entry.status?.completed === true || collectImageRefs(entry).length > 0) {
					return entry;
				}
			}
			if (this._now() >= deadline) {
				throw new ImageGenError('timeout', `ComfyUI run ${promptId} timed out after ${this._timeoutMs}ms`);
			}
			await this._sleep(this._pollIntervalMs);
		}
	}

	private async _uploadRefs(blobs: Blob[]): Promise<string[]> {
		const uploadId = this._uploadIdSource();
		const names: string[] = [];
		for (let i = 0; i < blobs.length; i++) {
			const up = await this._http.uploadImage(blobs[i], `storybook-ref-${uploadId}-${i}.png`);
			if (!up?.name) {
				throw new ImageGenError('provider', 'ComfyUI /upload/image returned no name');
			}
			names.push(up.subfolder ? `${up.subfolder}/${up.name}` : up.name);
		}
		return names;
	}
}
