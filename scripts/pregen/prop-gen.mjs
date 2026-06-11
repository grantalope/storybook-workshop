#!/usr/bin/env node
// @ts-nocheck

import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { buildPropJobs, applyJobFilters, runJobs } from './lib/jobs.mjs';
import { loadStylePrompts } from './lib/style-prompts.mjs';

export async function main(argv = process.argv.slice(2), deps = {}) {
	const args = parseArgs(argv, { required: ['server', 'out', 'styles'] });
	const stylePrompts = await loadStylePrompts(args.stylePrompts);
	const jobs = applyJobFilters(buildPropJobs({ styles: args.styles, stylePrompts }), args);
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
