import { describe, expect, it } from 'vitest';

import { BEAT_NAMES, LOCALE_BIOMES } from '$lib/services/author/types';
import {
	BEAT_MOODS,
	LOCALES,
	POSE_CLASSES,
} from '../../scripts/pregen/lib/grids.mjs';
import {
	T2I_LIGHTNING_GRAPH,
	patchGraph,
} from '../../scripts/pregen/lib/graph-templates.mjs';
import {
	buildPlateJobs,
	graphForJob,
} from '../../scripts/pregen/lib/jobs.mjs';
import { seedFor } from '../../scripts/pregen/lib/seed.mjs';

describe('pregen graph patching and grid drift guards', () => {
	it('patches only the Comfy target nodes and leaves the frozen template untouched', () => {
		const patched = patchGraph(T2I_LIGHTNING_GRAPH, {
			positive: 'positive text',
			negative: 'negative text',
			width: 1024,
			height: 768,
			seed: 123,
			steps: 8,
			filenamePrefix: 'prefix',
		});

		expect(patched['6'].inputs.text).toBe('positive text');
		expect(patched['7'].inputs.text).toBe('negative text');
		expect(patched['58'].inputs).toMatchObject({ width: 1024, height: 768 });
		expect(patched['3'].inputs).toMatchObject({ seed: 123, steps: 8 });
		expect(patched['60'].inputs.filename_prefix).toBe('prefix');
		expect(T2I_LIGHTNING_GRAPH['6'].inputs.text).toBe('POSITIVE');
		expect(Object.isFrozen(T2I_LIGHTNING_GRAPH['3'].inputs)).toBe(true);
	});

	it('derives stable seeds and identical patched graphs for the same asset id', () => {
		const [jobA] = buildPlateJobs({ styles: ['s1'] });
		const [jobB] = buildPlateJobs({ styles: ['s1'] });

		expect(jobA.seed).toBe(seedFor(jobA.assetId));
		expect(jobA.seed).toBe(jobB.seed);
		expect(graphForJob(jobA, { steps: 4 })).toEqual(graphForJob(jobB, { steps: 4 }));
		expect(seedFor('plateA/forest/setup/s1')).not.toBe(seedFor('plateA/forest/setup/s2'));
	});

	it('keeps duplicated Node grids aligned with TypeScript source constants', () => {
		expect(LOCALES).toEqual([...LOCALE_BIOMES]);
		expect(BEAT_MOODS).toEqual(Object.values(BEAT_NAMES));
		expect(POSE_CLASSES).toEqual([
			'standing-neutral',
			'walking',
			'running',
			'sitting',
			'reaching',
			'pointing',
			'hugging',
			'sleeping',
		]);
	});
});
