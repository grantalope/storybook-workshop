#!/usr/bin/env node
/**
 * compose-pilot.mjs — first real WFC-composed spreads from the pregen bank.
 *
 * Pipeline per spread (setup / climax / resolution):
 *   1. LayoutCollapser.collapseLayout(ctx)        — grammar template -> collapsed slots
 *   2. CompositionPlanner.planComposition(layout) — resolve slot asset queries vs bank manifest
 *   3. PIL compositor (spawned python3)           — plate base + pose sprites + 1 prop,
 *      bottom-center grounded, textZone left clear (marked with a translucent panel).
 *
 * The scenegrammar engine is TypeScript; this script bundles it on the fly with the
 * esbuild that ships inside the repo's vite dependency (all `$lib` imports in the
 * engine are `import type` and are erased by the bundler).
 *
 * Usage:
 *   node scripts/pregen/compose-pilot.mjs \
 *     --bank ~/devbox/storybook-workshop-codex-t5/scripts/pregen/.bank \
 *     [--manifest static/pregen-bank/manifest.json] \
 *     [--out scripts/pregen/.compose-pilot] [--width 1536] [--book-id pilot-1]
 *
 * If CompositionPlanner returns fallbackToDirectGen for a combo, the missing asset
 * queries are logged verbatim and the next archetype/locale/prop combo is tried.
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
	const args = {
		manifest: join(REPO_ROOT, 'static', 'pregen-bank', 'manifest.json'),
		bank: null,
		out: join(REPO_ROOT, 'scripts', 'pregen', '.compose-pilot'),
		width: 1536,
		bookId: 'pilot-1',
	};
	for (let i = 2; i < argv.length; i++) {
		const key = argv[i];
		const value = argv[i + 1];
		if (key === '--manifest') { args.manifest = resolve(value); i++; }
		else if (key === '--bank') { args.bank = resolve(value); i++; }
		else if (key === '--out') { args.out = resolve(value); i++; }
		else if (key === '--width') { args.width = Number(value); i++; }
		else if (key === '--book-id') { args.bookId = value; i++; }
		else throw new Error(`compose-pilot: unknown arg ${key}`);
	}
	return args;
}

// ---------------------------------------------------------------------------
// Engine loading (bundle src/lib/services/scenegrammar with repo-local esbuild)
// ---------------------------------------------------------------------------
async function loadEngine(outDir) {
	const selfRequire = createRequire(import.meta.url);
	// esbuild is not a direct dependency; reach it through vite's own require scope.
	const viteRequire = createRequire(selfRequire.resolve('vite/package.json'));
	const esbuild = viteRequire('esbuild');
	const enginePath = join(outDir, 'scenegrammar-engine.bundle.mjs');
	await esbuild.build({
		entryPoints: [join(REPO_ROOT, 'src', 'lib', 'services', 'scenegrammar', 'index.ts')],
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		outfile: enginePath,
		logLevel: 'silent',
	});
	return import(pathToFileURL(enginePath).href);
}

// ---------------------------------------------------------------------------
// Combo selection: archetypes with full pose coverage + locale plates + bank prop
// ---------------------------------------------------------------------------
const PILOT_SPREADS = [
	{ spreadIndex: 0, beatName: 'setup' },
	{ spreadIndex: 5, beatName: 'climax' },
	{ spreadIndex: 6, beatName: 'resolution' },
];
const STYLE_ID = 'flat-painted';
const FULL_POSE_COUNT = 8;

function buildCombos(engine, manifest) {
	const poseCoverage = new Map();
	const plateBeatsByLocale = new Map();
	const bankPropIds = new Set();
	for (const entry of manifest.entries) {
		if (entry.styleId !== STYLE_ID) continue;
		if (entry.layer === 'B' && entry.archetypeId && entry.poseClass) {
			if (!poseCoverage.has(entry.archetypeId)) poseCoverage.set(entry.archetypeId, new Set());
			poseCoverage.get(entry.archetypeId).add(entry.poseClass);
		} else if (entry.layer === 'A' && entry.locale && entry.beatMood) {
			if (!plateBeatsByLocale.has(entry.locale)) plateBeatsByLocale.set(entry.locale, new Set());
			plateBeatsByLocale.get(entry.locale).add(entry.beatMood);
		} else if (entry.layer === 'C' && entry.propId) {
			bankPropIds.add(entry.propId);
		}
	}

	const fullPoseArchetypes = [...poseCoverage.keys()]
		.filter((id) => poseCoverage.get(id).size >= FULL_POSE_COUNT)
		.sort();
	if (fullPoseArchetypes.length < 2) {
		throw new Error(`compose-pilot: need >=2 full-pose archetypes, found ${fullPoseArchetypes.length}`);
	}

	const neededBeats = PILOT_SPREADS.map((s) => s.beatName);
	const viableLocales = [...plateBeatsByLocale.keys()]
		.filter((locale) => neededBeats.every((beat) => plateBeatsByLocale.get(locale).has(beat)))
		.sort();

	const combos = [];
	for (const locale of viableLocales) {
		// focal prop must satisfy BOTH the grammar's locale-compat matrix and exist in the bank
		const props = Object.keys(engine.PROP_LOCALE_COMPAT)
			.filter((propId) => engine.isPropCompatible(propId, locale) && bankPropIds.has(propId))
			.sort();
		for (const propId of props) {
			for (let a = 0; a + 1 < fullPoseArchetypes.length; a++) {
				combos.push({
					locale,
					focalPropId: propId,
					castArchetypeIds: [fullPoseArchetypes[a], fullPoseArchetypes[a + 1]],
				});
			}
		}
	}
	return combos;
}

// ---------------------------------------------------------------------------
// Plan -> compose spec
// ---------------------------------------------------------------------------
const SLOT_Z = { backgroundPlate: 0, skyband: 1, focalPropSlot: 2, sidekickSlot: 3, heroSlot: 4, textZone: 5 };

function buildSpreadSpec(engine, manifest, bankPath, ctx, spread, outDir) {
	const layout = engine.collapseLayout({ ...ctx, spreadIndex: spread.spreadIndex, beatName: spread.beatName });
	const plan = engine.planComposition(layout, manifest);
	if (plan.fallbackToDirectGen) {
		return { plan, spec: null };
	}
	const fileBySlot = new Map(plan.resolvedAssets.map((a) => [a.slotId, a]));
	const slotById = new Map(layout.slots.map((s) => [s.slotId, s]));

	const plateAsset = fileBySlot.get('backgroundPlate');
	if (!plateAsset) throw new Error(`compose-pilot: no backgroundPlate resolved for ${spread.beatName}`);

	const layers = [];
	for (const slotId of ['focalPropSlot', 'sidekickSlot', 'heroSlot']) {
		const asset = fileBySlot.get(slotId);
		const slot = slotById.get(slotId);
		if (!asset || !slot) continue;
		const file = join(bankPath, asset.file);
		if (!existsSync(file)) throw new Error(`compose-pilot: bank file missing on disk: ${file}`);
		layers.push({
			slotId,
			assetId: asset.assetId,
			file,
			rect: slot.rect,
			scale: slot.scale,
			facing: slot.facing,
			z: SLOT_Z[slotId],
		});
	}
	layers.sort((a, b) => a.z - b.z);

	const textZone = slotById.get('textZone');
	const plateFile = join(bankPath, plateAsset.file);
	if (!existsSync(plateFile)) throw new Error(`compose-pilot: plate missing on disk: ${plateFile}`);

	return {
		plan,
		spec: {
			name: `${spread.spreadIndex.toString().padStart(2, '0')}-${spread.beatName}`,
			out: join(outDir, `spread-${spread.spreadIndex.toString().padStart(2, '0')}-${spread.beatName}.png`),
			plate: plateFile,
			plateAssetId: plateAsset.assetId,
			layers,
			textZone: textZone ? textZone.rect : null,
			seedUsed: layout.seedUsed,
			backtracks: layout.backtracks,
		},
	};
}

// ---------------------------------------------------------------------------
// PIL compositor (spawned python3). Grounding rule: sprites are cropped to their
// alpha bbox, scaled to height = min(slot.scale, rect.h) * canvasH (clamped to
// 1.3x rect width), anchored bottom-center of the slot rect. facing 'left'
// mirrors the sprite (bank sprites default right/forward). textZone gets a
// translucent panel so reviewers can verify it stayed clear of art.
// ---------------------------------------------------------------------------
const PY_COMPOSITOR = `
import json, sys, time
from PIL import Image, ImageDraw

spec = json.load(open(sys.argv[1]))
W = int(spec['width'])
results = []
for spread in spec['spreads']:
    t0 = time.time()
    plate = Image.open(spread['plate']).convert('RGB')
    H = round(W * plate.height / plate.width)
    canvas = plate.resize((W, H), Image.LANCZOS).convert('RGBA')
    clamped = []
    for layer in spread['layers']:
        im = Image.open(layer['file']).convert('RGBA')
        bbox = im.getchannel('A').getbbox()
        if bbox is None:
            raise SystemExit('empty-alpha sprite: ' + layer['file'])
        im = im.crop(bbox)
        if layer.get('facing') == 'left':
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        r = layer['rect']
        target_h = max(1, round(min(layer['scale'], r['h']) * H))
        target_w = max(1, round(target_h * im.width / im.height))
        max_w = round(r['w'] * W * 1.3)
        if target_w > max_w:
            clamped.append(layer['slotId'])
            target_w = max_w
            target_h = max(1, round(target_w * im.height / im.width))
        im = im.resize((target_w, target_h), Image.LANCZOS)
        x = round((r['x'] + r['w'] / 2) * W - target_w / 2)
        y = round((r['y'] + r['h']) * H - target_h)
        canvas.paste(im, (x, y), im)
    tz = spread.get('textZone')
    if tz:
        overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        x0, y0 = tz['x'] * W, tz['y'] * H
        x1, y1 = (tz['x'] + tz['w']) * W, (tz['y'] + tz['h']) * H
        draw.rectangle([x0, y0, x1, y1], fill=(255, 255, 255, 52), outline=(255, 255, 255, 130), width=3)
        canvas = Image.alpha_composite(canvas, overlay)
    canvas.convert('RGB').save(spread['out'], 'PNG')
    results.append({'out': spread['out'], 'ms': round((time.time() - t0) * 1000), 'size': [W, H], 'clamped': clamped})
print(json.dumps(results))
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
	const args = parseArgs(process.argv);
	mkdirSync(args.out, { recursive: true });

	const engine = await loadEngine(args.out);
	const manifest = engine.loadBankManifest(JSON.parse(readFileSync(args.manifest, 'utf8')));
	const bankPath = args.bank ?? resolve(REPO_ROOT, manifest.bankRoot);
	if (!existsSync(bankPath)) {
		throw new Error(`compose-pilot: bank dir not found at ${bankPath} (pass --bank; full-res bank lives outside git, see docs/pregen-bank.md)`);
	}

	const combos = buildCombos(engine, manifest);
	if (combos.length === 0) throw new Error('compose-pilot: no viable archetype/locale/prop combos in manifest');

	let chosen = null;
	let specs = null;
	const rejections = [];
	for (const combo of combos) {
		const ctx = {
			bookId: args.bookId,
			spreadIndex: 0,
			beatName: 'setup',
			locale: combo.locale,
			styleId: STYLE_ID,
			castArchetypeIds: combo.castArchetypeIds,
			focalPropId: combo.focalPropId,
			pageTurnDirection: 'ltr',
		};
		const trial = [];
		let failed = false;
		for (const spread of PILOT_SPREADS) {
			const { plan, spec } = buildSpreadSpec(engine, manifest, bankPath, ctx, spread, args.out);
			if (plan.fallbackToDirectGen) {
				const why = JSON.stringify(plan.missingAssets);
				console.error(`[compose-pilot] combo ${JSON.stringify(combo)} -> fallbackToDirectGen on ${spread.beatName}; missing assets: ${why}`);
				rejections.push({ combo, beatName: spread.beatName, missingAssets: plan.missingAssets });
				failed = true;
				break;
			}
			trial.push({ spread, spec, plan });
		}
		if (!failed) {
			chosen = combo;
			specs = trial;
			break;
		}
	}
	if (!chosen || !specs) {
		throw new Error(`compose-pilot: every combo fell back to direct-gen; rejections: ${JSON.stringify(rejections, null, 2)}`);
	}

	console.log(`[compose-pilot] combo: locale=${chosen.locale} prop=${chosen.focalPropId} cast=${chosen.castArchetypeIds.join(',')}`);
	for (const { spread, spec } of specs) {
		console.log(`[compose-pilot] ${spread.beatName}: seed=${spec.seedUsed} backtracks=${spec.backtracks} plate=${spec.plateAssetId} layers=${spec.layers.map((l) => l.assetId).join(' | ')}`);
	}

	const composeSpec = { width: args.width, spreads: specs.map((s) => s.spec) };
	const specPath = join(args.out, 'compose-spec.json');
	writeFileSync(specPath, JSON.stringify(composeSpec, null, '\t'));

	const t0 = performance.now();
	const py = spawnSync('python3', ['-c', PY_COMPOSITOR, specPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	if (py.status !== 0) {
		throw new Error(`compose-pilot: PIL compositor failed (exit ${py.status}):\n${py.stderr}`);
	}
	const totalMs = performance.now() - t0;
	const results = JSON.parse(py.stdout.trim());

	const report = {
		bookId: args.bookId,
		styleId: STYLE_ID,
		combo: chosen,
		rejections,
		spreads: specs.map(({ spread, spec }, i) => ({
			spreadIndex: spread.spreadIndex,
			beatName: spread.beatName,
			seedUsed: spec.seedUsed,
			backtracks: spec.backtracks,
			plate: spec.plateAssetId,
			layers: spec.layers.map((l) => ({ slotId: l.slotId, assetId: l.assetId, rect: l.rect, scale: l.scale, facing: l.facing })),
			textZone: spec.textZone,
			out: spec.out,
			compositeMs: results[i]?.ms ?? null,
			clampedSlots: results[i]?.clamped ?? [],
			size: results[i]?.size ?? null,
		})),
		totalCompositeMs: Math.round(totalMs),
		msPerSpread: Math.round(totalMs / specs.length),
	};
	writeFileSync(join(args.out, 'compose-report.json'), JSON.stringify(report, null, '\t'));

	for (const s of report.spreads) {
		console.log(`[compose-pilot] composed ${s.out} (${s.size?.[0]}x${s.size?.[1]}) in ${s.compositeMs}ms${s.clampedSlots.length ? ` (width-clamped: ${s.clampedSlots.join(',')})` : ''}`);
	}
	console.log(`[compose-pilot] 3 spreads in ${report.totalCompositeMs}ms total (${report.msPerSpread}ms/spread). Report: ${join(args.out, 'compose-report.json')}`);
	console.log('[compose-pilot] NOTE: raw bank composite — no harmonization pass yet. Lighting/palette unification via img2img on the 4090 is the next step.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
