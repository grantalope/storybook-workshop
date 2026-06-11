// @ts-nocheck

import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

function joinUrl(serverUrl, path) {
	return `${String(serverUrl).replace(/\/+$/, '')}${path}`;
}

async function parseJsonResponse(response, context) {
	if (!response.ok) {
		throw new Error(`${context}: HTTP ${response.status}`);
	}
	return response.json();
}

function extractOutputs(history, promptId) {
	const candidate = history?.[promptId] ?? history;
	return candidate?.outputs ?? null;
}

function extractImages(outputs) {
	const images = [];
	for (const output of Object.values(outputs ?? {})) {
		if (Array.isArray(output?.images)) {
			images.push(...output.images);
		}
	}
	return images;
}

export function createComfyClient({
	serverUrl,
	fetchImpl = fetch,
	pollIntervalMs = 1500,
	timeoutMs = 180000,
} = {}) {
	if (!serverUrl) throw new Error('createComfyClient requires serverUrl');

	async function health() {
		const response = await fetchImpl(joinUrl(serverUrl, '/system_stats'));
		return parseJsonResponse(response, 'ComfyUI health');
	}

	async function queuePrompt(graph) {
		const response = await fetchImpl(joinUrl(serverUrl, '/prompt'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ prompt: graph }),
		});
		const json = await parseJsonResponse(response, 'ComfyUI queue prompt');
		if (typeof json?.prompt_id !== 'string' || json.prompt_id.length === 0) {
			throw new Error('ComfyUI queue prompt: response missing prompt_id');
		}
		return json.prompt_id;
	}

	async function awaitOutputs(promptId) {
		const started = performance.now();
		let lastStatus = 'not requested';

		while (true) {
			const response = await fetchImpl(joinUrl(serverUrl, `/history/${encodeURIComponent(promptId)}`));
			lastStatus = `HTTP ${response.status}`;
			if (!response.ok) {
				throw new Error(`ComfyUI history prompt_id=${promptId}: ${lastStatus}`);
			}
			const history = await response.json();
			const outputs = extractOutputs(history, promptId);
			if (outputs) {
				return {
					promptId,
					history,
					outputs,
					images: extractImages(outputs),
				};
			}

			if (performance.now() - started >= timeoutMs) {
				throw new Error(`ComfyUI history timeout prompt_id=${promptId}; last status ${lastStatus}`);
			}
			await delay(pollIntervalMs);
		}
	}

	async function fetchImage({ filename, subfolder = '', type = 'output' }) {
		const params = new URLSearchParams({ filename, subfolder, type });
		const response = await fetchImpl(joinUrl(serverUrl, `/view?${params.toString()}`));
		if (!response.ok) {
			throw new Error(`ComfyUI image fetch ${filename}: HTTP ${response.status}`);
		}
		return new Uint8Array(await response.arrayBuffer());
	}

	async function generateOne({ graph }) {
		const promptId = await queuePrompt(graph);
		const result = await awaitOutputs(promptId);
		const firstImage = result.images[0];
		if (!firstImage) {
			throw new Error(`ComfyUI history prompt_id=${promptId}: outputs contained no images`);
		}
		return fetchImage(firstImage);
	}

	return { health, queuePrompt, awaitOutputs, fetchImage, generateOne };
}
