// @ts-nocheck

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createComfyClient } from './comfy-client.mjs';
import { T2I_LIGHTNING_GRAPH, patchGraph } from './graph-templates.mjs';
import {
	BEAT_MOOD_LIGHTING,
	BEAT_MOODS,
	LOCALES,
	LOCALE_SCENERY,
	POSE_CLASSES,
	POSE_DESCRIPTIONS,
} from './grids.mjs';
import { PROPS } from './props.mjs';
import { seedFor } from './seed.mjs';
import { stylePromptFor } from './style-prompts.mjs';

const PLATE_NEGATIVE = 'people, characters, faces, text, watermark, border';
const POSE_NEGATIVE = 'background scenery, landscape, text, multiple people, cropped limbs';
const PROP_NEGATIVE = 'background scenery, landscape, text, hands, people, cropped object';

function joinPrompt(parts) {
	return parts.map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');
}

function joinNegative(parts) {
	return [...new Set(parts.flatMap((part) => String(part ?? '').split(',')).map((part) => part.trim()).filter(Boolean))]
		.join(', ');
}

function filenamePrefix(assetId) {
	return assetId.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function relativeFileForAsset(assetId) {
	return `${assetId}.png`;
}

export function outputPathForAsset(bankRoot, assetId) {
	return path.join(bankRoot, ...relativeFileForAsset(assetId).split('/'));
}

export function sidecarPathForAsset(bankRoot, assetId) {
	return `${outputPathForAsset(bankRoot, assetId)}.json`;
}

async function pathExists(filePath) {
	try {
		await stat(filePath);
		return true;
	} catch (err) {
		if (err?.code === 'ENOENT') return false;
		throw err;
	}
}

function makeJob(base) {
	return {
		...base,
		file: relativeFileForAsset(base.assetId),
		seed: seedFor(base.assetId),
		filenamePrefix: filenamePrefix(base.assetId),
	};
}

export function buildPlatePrompt({ locale, beatMood, styleId, stylePrompts = {} }) {
	const style = stylePromptFor(stylePrompts, styleId);
	return {
		positive: joinPrompt([
			style.prefix,
			'empty stage negative-space composition',
			LOCALE_SCENERY[locale],
			BEAT_MOOD_LIGHTING[beatMood],
			'wide empty foreground, open negative space at center, no people, no characters, no animals, no text',
			style.suffix,
		]),
		negative: joinNegative([PLATE_NEGATIVE, style.negative]),
	};
}

export function buildPosePrompt({ archetype, poseClass, styleId, stylePrompts = {} }) {
	const style = stylePromptFor(stylePrompts, styleId);
	return {
		positive: joinPrompt([
			style.prefix,
			archetype.dnaPrompt,
			'full body',
			POSE_DESCRIPTIONS[poseClass],
			'on a solid uniform chroma green background',
			'no scenery',
			'single character',
			'feet visible',
			style.suffix,
		]),
		negative: joinNegative([POSE_NEGATIVE, style.negative]),
	};
}

export function buildPropPrompt({ prop, styleId, stylePrompts = {} }) {
	const style = stylePromptFor(stylePrompts, styleId);
	return {
		positive: joinPrompt([
			style.prefix,
			`${prop.label}, single standalone kid-book prop`,
			'on a solid uniform chroma green background',
			'centered object, clean silhouette, no scenery, no text',
			style.suffix,
		]),
		negative: joinNegative([PROP_NEGATIVE, style.negative]),
	};
}

export function buildPlateJobs({ styles, stylePrompts = {} }) {
	const jobs = [];
	for (const locale of LOCALES) {
		for (const beatMood of BEAT_MOODS) {
			for (const styleId of styles) {
				const assetId = `plateA/${locale}/${beatMood}/${styleId}`;
				jobs.push(makeJob({
					assetId,
					layer: 'A',
					styleId,
					locale,
					beatMood,
					width: 1328,
					height: 1024,
					...buildPlatePrompt({ locale, beatMood, styleId, stylePrompts }),
				}));
			}
		}
	}
	return jobs;
}

export async function loadTaxonomy(taxonomyPath) {
	const raw = await readFile(taxonomyPath, 'utf8');
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed?.archetypes)) {
		throw new Error('--taxonomy must point to JSON with an archetypes array');
	}
	return parsed.archetypes.map((archetype, index) => {
		if (typeof archetype?.id !== 'string' || typeof archetype?.dnaPrompt !== 'string') {
			throw new Error(`taxonomy archetypes[${index}] requires id and dnaPrompt`);
		}
		return archetype;
	});
}

export function buildPoseJobs({ archetypes, styles, stylePrompts = {} }) {
	const jobs = [];
	for (const archetype of archetypes) {
		for (const poseClass of POSE_CLASSES) {
			for (const styleId of styles) {
				const assetId = `poseB/${archetype.id}/${poseClass}/${styleId}`;
				jobs.push(makeJob({
					assetId,
					layer: 'B',
					styleId,
					archetypeId: archetype.id,
					poseClass,
					width: 1024,
					height: 1328,
					...buildPosePrompt({ archetype, poseClass, styleId, stylePrompts }),
				}));
			}
		}
	}
	return jobs;
}

export function buildPropJobs({ styles, stylePrompts = {} }) {
	const jobs = [];
	for (const prop of PROPS) {
		for (const styleId of styles) {
			const assetId = `propC/${prop.propId}/${styleId}`;
			jobs.push(makeJob({
				assetId,
				layer: 'C',
				styleId,
				propId: prop.propId,
				width: 768,
				height: 768,
				...buildPropPrompt({ prop, styleId, stylePrompts }),
			}));
		}
	}
	return jobs;
}

export function applyJobFilters(jobs, { filter, limit } = {}) {
	let selected = jobs;
	if (filter) {
		const regex = filter instanceof RegExp ? filter : new RegExp(filter);
		selected = selected.filter((job) => regex.test(job.assetId));
	}
	if (limit !== undefined) {
		selected = selected.slice(0, limit);
	}
	return selected;
}

export function graphForJob(job, { steps = 4 } = {}) {
	return patchGraph(T2I_LIGHTNING_GRAPH, {
		positive: job.positive,
		negative: job.negative,
		width: job.width,
		height: job.height,
		seed: job.seed,
		steps,
		filenamePrefix: job.filenamePrefix,
	});
}

export function sidecarEntryForJob(job, bankRoot, generatedAtIso = new Date().toISOString()) {
	return {
		assetId: job.assetId,
		layer: job.layer,
		styleId: job.styleId,
		...(job.locale ? { locale: job.locale } : {}),
		...(job.beatMood ? { beatMood: job.beatMood } : {}),
		...(job.archetypeId ? { archetypeId: job.archetypeId } : {}),
		...(job.poseClass ? { poseClass: job.poseClass } : {}),
		...(job.propId ? { propId: job.propId } : {}),
		file: path.relative(bankRoot, outputPathForAsset(bankRoot, job.assetId)).split(path.sep).join('/'),
		seed: job.seed,
		generatedAtIso,
	};
}

export async function writeSidecarForJob({ bankRoot, job, generatedAtIso }) {
	const outputPath = outputPathForAsset(bankRoot, job.assetId);
	const sidecarPath = `${outputPath}.json`;
	await mkdir(path.dirname(sidecarPath), { recursive: true });
	await writeFile(sidecarPath, `${JSON.stringify(sidecarEntryForJob(job, bankRoot, generatedAtIso), null, 2)}\n`);
}

function progressLine({ index, total, job, startedAt, status }) {
	const elapsed = Math.max(0, (performance.now() - startedAt) / 1000);
	const average = index > 0 ? elapsed / index : 0;
	const eta = Math.max(0, average * (total - index));
	return `[pregen] ${index}/${total} ${job.assetId} seed=${job.seed} ${status} (elapsed ${elapsed.toFixed(0)}s, eta ${eta.toFixed(0)}s)`;
}

export async function runJobs({
	jobs,
	out,
	server,
	steps = 4,
	dryRun = false,
	fetchImpl,
	client,
	logger = console.log,
	pollIntervalMs = 1500,
	timeoutMs = 180000,
	generatedAtIso,
} = {}) {
	if (dryRun) {
		logger(`[pregen] dry-run ${jobs.length} job(s)`);
		for (const job of jobs) {
			logger(`[pregen] ${job.assetId} seed=${job.seed}`);
		}
		for (const job of jobs.slice(0, 3)) {
			logger(`[pregen] prompt ${job.assetId}\nPOSITIVE: ${job.positive}\nNEGATIVE: ${job.negative}`);
		}
		return { total: jobs.length, generated: 0, skipped: 0, dryRun: true };
	}

	const startedAt = performance.now();
	let generated = 0;
	let skipped = 0;
	let comfy = client;
	let healthChecked = false;

	for (let index = 0; index < jobs.length; index += 1) {
		const job = jobs[index];
		const outputPath = outputPathForAsset(out, job.assetId);
		if (await pathExists(outputPath)) {
			skipped += 1;
			if (!(await pathExists(`${outputPath}.json`))) {
				await writeSidecarForJob({ bankRoot: out, job, generatedAtIso });
			}
			logger(progressLine({ index: index + 1, total: jobs.length, job, startedAt, status: 'skipped' }));
			continue;
		}

		if (!comfy) {
			comfy = createComfyClient({ serverUrl: server, fetchImpl, pollIntervalMs, timeoutMs });
		}
		if (!healthChecked && typeof comfy.health === 'function') {
			await comfy.health();
			healthChecked = true;
		}

		const graph = graphForJob(job, { steps });
		const pngBytes = await comfy.generateOne({ graph });
		await mkdir(path.dirname(outputPath), { recursive: true });
		await writeFile(outputPath, pngBytes);
		await writeSidecarForJob({ bankRoot: out, job, generatedAtIso });
		generated += 1;
		logger(progressLine({ index: index + 1, total: jobs.length, job, startedAt, status: 'generated' }));
	}

	return { total: jobs.length, generated, skipped, dryRun: false };
}
