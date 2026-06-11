#!/usr/bin/env node
// @ts-nocheck

import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { writeManifestAndReport } from './lib/manifest.mjs';

export async function main(argv = process.argv.slice(2), deps = {}) {
	const args = parseArgs(argv, { required: ['bank', 'expectStyles'] });
	const result = await writeManifestAndReport({
		bank: args.bank,
		styles: args.expectStyles,
		taxonomyPath: args.taxonomy,
	});
	const logger = deps.logger ?? console.log;
	logger(JSON.stringify({
		entries: result.manifest.entries.length,
		coverageRatio: result.report.coverageRatio,
		missing: result.report.missing.length,
	}, null, 2));
	return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main()
		.then((result) => {
			process.exitCode = result.exitCode;
		})
		.catch((err) => {
			console.error(err?.stack ?? err);
			process.exitCode = 1;
		});
}
