// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * BookAssembler — orchestrator
 *
 * Spec ref: §3.9 Phase 9. Sequences:
 *   a. NameOverlayCompositor (privacy keystone) → composited PNGs + resolved spread text
 *   b. CoverComposer → front + back + spine
 *   c. PdfBuilder → PDF blob
 *   d. LuluPdfSpecValidator → throw on fail
 *   e. EpubBuilder → ePub3 blob
 *   f. ReadAlongBundleBuilder → web bundle + shortcode
 *   g. sha-256(pdfBlob) → audit.pdfHash for Stripe-dispute defense
 *   h. return AssembledBook
 *
 * THIS IS THE ONLY SERVICE THAT TOUCHES THE KID'S NAME. See
 * NameOverlayCompositor.ts header for the privacy contract.
 */

import type { AssembledBook, AssemblyAudit, BookAssetBundle, ReadAlongBundle } from './types';
import { overlayBookNames } from './NameOverlayCompositor';
import { composeCover, computeSpineWidthIn } from './CoverComposer';
import { buildPdf } from './PdfBuilder';
import type { PageImageFormat, PageRasterEncoder } from './encodePageRaster';
import { validatePdf } from './LuluPdfSpecValidator';
import { buildEpub } from './EpubBuilder';
import { buildReadAlongBundle } from './ReadAlongBundleBuilder';

export interface AssembleOptions {
	/** Optional spread-text source: spreadIndex → text containing {HERO_NAME}. */
	spreadTexts?: string[];
	/** Optional focal-point hints per spread for name overlay. */
	spreadFocalHints?: Array<{ x: number; y: number; maxWidthFrac?: number } | undefined>;
	/** Optional pre-rendered title/dedication/endpaper PNGs. */
	endpaperPng?: Blob;
	titlePagePng?: Blob;
	dedicationPagePng?: Blob;
	/** Shortcode collision check — usually backed by backend lookup. */
	isShortcodeFree?: (s: string) => Promise<boolean>;
	rng?: () => number;
	/** Optional registrar called with the ReadAlongBundle once minted. */
	registerBundle?: (bundle: ReadAlongBundle) => Promise<string | undefined>;
	/** Interior page raster embed format. Default 'jpeg' (q≈0.88, ~6× smaller PDF). */
	pageImageFormat?: PageImageFormat;
	/** JPEG quality in 0..1. Default 0.88. Ignored when pageImageFormat='png'. */
	pageImageQuality?: number;
	/** Injectable raster transcoder (tests / custom pipelines). */
	encodePageRaster?: PageRasterEncoder;
	/** Optional override for testing the validator pre-check. */
	skipValidation?: boolean;
}

async function sha256Hex(blob: Blob): Promise<string> {
	const buf = await blob.arrayBuffer();
	const cryptoSubtle = (globalThis as any).crypto?.subtle;
	if (cryptoSubtle?.digest) {
		const hash = await cryptoSubtle.digest('SHA-256', buf);
		return Array.from(new Uint8Array(hash))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
	}
	// Node fallback (vitest run without webcrypto polyfill)
	const { createHash } = await import('node:crypto');
	const h = createHash('sha256');
	h.update(Buffer.from(buf));
	return h.digest('hex');
}

function orderedScenes(bundle: BookAssetBundle): string[] {
	if (bundle.sceneOrder?.length) return bundle.sceneOrder;
	return Array.from(bundle.wbPngsByScene.keys());
}

function flattenWbPngs(bundle: BookAssetBundle): Blob[] {
	const out: Blob[] = [];
	for (const sceneId of orderedScenes(bundle)) {
		const arr = bundle.wbPngsByScene.get(sceneId) ?? [];
		for (const png of arr) out.push(png);
	}
	return out;
}

export class AssemblyValidationError extends Error {
	readonly errors: Array<{ code: string; message: string; hint?: string }>;
	constructor(errors: Array<{ code: string; message: string; hint?: string }>) {
		super(`Lulu PDF spec validation failed: ${errors.map(e => e.code).join(', ')}`);
		this.name = 'AssemblyValidationError';
		this.errors = errors;
	}
}

export async function assemble(
	bundle: BookAssetBundle,
	options: AssembleOptions = {}
): Promise<AssembledBook> {
	// ── (a) NameOverlayCompositor ───────────────────────────────────────────
	const wbPngs = flattenWbPngs(bundle);
	const spreadCount = wbPngs.length;
	if (spreadCount === 0) {
		throw new Error('BookAssembler.assemble: bundle.wbPngsByScene is empty');
	}
	const spreadTexts = options.spreadTexts ?? wbPngs.map(() => '');
	if (spreadTexts.length !== spreadCount) {
		throw new Error(
			`BookAssembler.assemble: spreadTexts length ${spreadTexts.length} ≠ spread count ${spreadCount}`
		);
	}
	const spreadInputs = wbPngs.map((wbPng, i) => ({
		wbPng,
		spreadText: spreadTexts[i],
		kidName: bundle.kidName,
		focalPoint: options.spreadFocalHints?.[i]
	}));
	const overlay = await overlayBookNames({
		spreads: spreadInputs,
		dedicationPagePng: options.dedicationPagePng,
		coverPng: undefined,                   // cover handled by CoverComposer
		kidName: bundle.kidName,
		dedication: bundle.dedication
	});
	const composedSpreadPngs = overlay.spreads.map(s => s.composedPng);
	const resolvedSpreadTexts = overlay.spreads.map(s => s.resolvedText);

	// ── (b) CoverComposer ──────────────────────────────────────────────────
	// Pick the first spread PNG as a stand-in front-cover seed if no dedicated
	// front-cover PNG is in the bundle. Real cover seed comes from goal #4 +
	// the workshop UI's Station 6 generation step.
	const frontSeed = composedSpreadPngs[0];
	const cover = await composeCover({
		frontPng: frontSeed,
		backPng: undefined,
		title: bundle.title,
		authorByline: bundle.authorByline,
		backCoverBlurb: bundle.backCoverBlurb,
		coverBadge: bundle.coverBadge,
		pageCount: bundle.pages,
		format: bundle.format
	});

	// ── (c) PdfBuilder ─────────────────────────────────────────────────────
	const pdf = await buildPdf({
		bundle,
		composedSpreadPngs,
		coverFrontPng: cover.frontPng,
		coverBackPng: cover.backPng,
		endpaperPng: options.endpaperPng,
		titlePagePng: options.titlePagePng,
		dedicationPagePng: overlay.dedicationPng ?? options.dedicationPagePng,
		spineWidthIn: cover.canvas.spineWidthIn,
		pageImageFormat: options.pageImageFormat,
		pageImageQuality: options.pageImageQuality,
		encodePageRaster: options.encodePageRaster
	});

	// ── (d) LuluPdfSpecValidator ───────────────────────────────────────────
	if (!options.skipValidation) {
		const report = await validatePdf({
			pdfBlob: pdf.pdfBlob,
			format: bundle.format,
			interiorPageCount: bundle.pages,
			declaredSpineWidthIn: cover.canvas.spineWidthIn,
			bleedMarkCount: pdf.bleedMarkCount,
			fontEmbedSummary: pdf.fontEmbedSummary,
			cmykMarkerPresent: pdf.cmykMarkerPresent
		});
		if (!report.valid) throw new AssemblyValidationError(report.errors);
	}

	// ── (e) EpubBuilder ────────────────────────────────────────────────────
	const epub = await buildEpub({
		bundle,
		resolvedSpreadTexts,
		composedSpreadPngs
	});

	// ── (f) ReadAlongBundleBuilder ─────────────────────────────────────────
	const readAlong = await buildReadAlongBundle({
		bundle,
		resolvedSpreadTexts,
		composedSpreadPngs,
		isShortcodeFree: options.isShortcodeFree,
		rng: options.rng
	});
	const readAlongBundleUrl = options.registerBundle
		? await options.registerBundle(readAlong.bundle)
		: `/storybook-workshop/preview/${readAlong.bundle.shortcode}`;

	// ── (g) sha-256 PDF hash ───────────────────────────────────────────────
	const pdfHash = await sha256Hex(pdf.pdfBlob);

	// ── (h) AssembledBook ──────────────────────────────────────────────────
	const audit: AssemblyAudit = {
		pdfHash,
		pageCount: pdf.pageCount,
		ts: Date.now(),
		fontEmbedSummary: pdf.fontEmbedSummary,
		bleedValidated: pdf.bleedMarkCount >= 8,
		cmykValidated: pdf.cmykMarkerPresent,
		shortcode: readAlong.bundle.shortcode,
		spineWidthIn: computeSpineWidthIn(bundle.pages, bundle.format)
	};

	return {
		pdfBlob: pdf.pdfBlob,
		epubBlob: epub.epubBlob,
		readAlongBundleUrl,
		shortcode: readAlong.bundle.shortcode,
		audit
	};
}
