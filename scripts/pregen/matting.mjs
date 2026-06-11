#!/usr/bin/env node
// @ts-nocheck

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pngjs from 'pngjs';
import { parseArgs } from './lib/cli.mjs';

const { PNG } = pngjs;

async function pathExists(filePath) {
	try {
		await stat(filePath);
		return true;
	} catch (err) {
		if (err?.code === 'ENOENT') return false;
		throw err;
	}
}

async function listPngs(inputPath) {
	const info = await stat(inputPath);
	if (info.isFile()) return inputPath.endsWith('.png') && !inputPath.endsWith('.matted.png') ? [inputPath] : [];

	const out = [];
	for (const entry of await readdir(inputPath, { withFileTypes: true })) {
		const child = path.join(inputPath, entry.name);
		if (entry.isDirectory()) {
			out.push(...await listPngs(child));
		} else if (entry.isFile() && entry.name.endsWith('.png') && !entry.name.endsWith('.matted.png')) {
			out.push(child);
		}
	}
	return out.sort();
}

function pixelOffset(png, x, y) {
	return (png.width * y + x) << 2;
}

function pixelAt(png, x, y) {
	const offset = pixelOffset(png, x, y);
	return [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
}

function colorKey(png) {
	const corners = [
		pixelAt(png, 0, 0),
		pixelAt(png, png.width - 1, 0),
		pixelAt(png, 0, png.height - 1),
		pixelAt(png, png.width - 1, png.height - 1),
	];
	const counts = new Map();
	for (const color of corners) {
		const key = color.join(',');
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
		.split(',')
		.map(Number);
}

function distance(a, b) {
	return Math.sqrt(
		((a[0] - b[0]) ** 2) +
		((a[1] - b[1]) ** 2) +
		((a[2] - b[2]) ** 2),
	);
}

export function chromaKeyPng(png, { tolerance = 48 } = {}) {
	const key = colorKey(png);
	const transparent = new Uint8Array(png.width * png.height);

	for (let y = 0; y < png.height; y += 1) {
		for (let x = 0; x < png.width; x += 1) {
			const offset = pixelOffset(png, x, y);
			if (distance([png.data[offset], png.data[offset + 1], png.data[offset + 2]], key) <= tolerance) {
				png.data[offset + 3] = 0;
				transparent[png.width * y + x] = 1;
			}
		}
	}

	for (let y = 0; y < png.height; y += 1) {
		for (let x = 0; x < png.width; x += 1) {
			const index = png.width * y + x;
			if (transparent[index]) continue;
			const neighbors = [
				x > 0 ? transparent[index - 1] : 0,
				x < png.width - 1 ? transparent[index + 1] : 0,
				y > 0 ? transparent[index - png.width] : 0,
				y < png.height - 1 ? transparent[index + png.width] : 0,
			];
			if (neighbors.some(Boolean)) {
				const offset = pixelOffset(png, x, y);
				png.data[offset + 3] = Math.min(png.data[offset + 3], 192);
			}
		}
	}

	return png;
}

export async function matteFile(inputPath, { tolerance = 48 } = {}) {
	const outputPath = inputPath.replace(/\.png$/i, '.matted.png');
	if (await pathExists(outputPath)) return { inputPath, outputPath, skipped: true };
	const png = PNG.sync.read(await readFile(inputPath));
	const matted = chromaKeyPng(png, { tolerance });
	await writeFile(outputPath, PNG.sync.write(matted));
	return { inputPath, outputPath, skipped: false };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
	const args = parseArgs(argv, { required: ['in'], defaults: { tolerance: 48 } });
	const files = await listPngs(args.in);
	const results = [];
	const logger = deps.logger ?? console.log;
	for (const file of files) {
		const result = await matteFile(file, { tolerance: args.tolerance });
		results.push(result);
		logger(`[pregen] matte ${path.relative(args.in, file)} ${result.skipped ? 'skipped' : 'matted'}`);
	}
	return {
		total: results.length,
		matted: results.filter((result) => !result.skipped).length,
		skipped: results.filter((result) => result.skipped).length,
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err?.stack ?? err);
		process.exitCode = 1;
	});
}
