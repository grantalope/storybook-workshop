#!/usr/bin/env node
// @ts-nocheck

import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { buildPoseJobs, applyJobFilters, loadTaxonomy, runJobs } from './lib/jobs.mjs';
import { loadStylePrompts } from './lib/style-prompts.mjs';

export async function main(argv = process.argv.slice(2), deps = {}) {
	const args = parseArgs(argv, { required: ['server', 'out', 'styles', 'taxonomy'] });
	const [stylePrompts, archetypes] = await Promise.all([
		loadStylePrompts(args.stylePrompts),
		loadTaxonomy(args.taxonomy),
	]);
	const jobs = applyJobFilters(buildPoseJobs({ archetypes, styles: args.styles, stylePrompts }), args);
	return runJobs({
		jobs,
		out: args.out,
		server: args.server,
		steps: args.steps,
		dryRun: args.dryRun,
		fetchImpl: deps.fetchImpl,
		client: deps.client,
		logger: deps.logger,
		pollIntervalMs: args.pollIntervalMs,
		timeoutMs: args.timeoutMs,
		generatedAtIso: deps.generatedAtIso,
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err?.stack ?? err);
		process.exitCode = 1;
	});
}
