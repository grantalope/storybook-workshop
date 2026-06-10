// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * PdfBuilder — pdf-lib wrapper for print-ready interior + cover.
 *
 * Spec ref: §3.9, Phase 4.
 *   - CMYK color space marker baked into Metadata (pdf-lib renders RGB; we
 *     tag the document as CMYK-intended-output so the print-vendor pipeline
 *     can colorspace-convert at RIP time). The Lulu spec validator
 *     enforces the tag is present.
 *   - 300dpi raster compose: PNG/JPEG inputs assumed already 300dpi.
 *   - Page rasters are JPEG-encoded at q≈0.88 by default (visually lossless
 *     for print at 300dpi — text is part of the raster anyway) via the
 *     injectable encodePageRaster boundary. Raw-PNG embedding produced a
 *     353MB interior PDF for a 29-spread book; JPEG q88 targets <60MB.
 *     Set pageImageFormat: 'png' for the legacy lossless path.
 *   - Bleed marks: 0.125in trim marks drawn at each corner.
 *   - Fonts: only one embedded subset (Helvetica via pdf-lib StandardFont)
 *     to keep PDF small. The font-embed list goes into the audit record.
 *   - Page order per spec: cover(front) → endpaper → title → dedication →
 *     spread1..N → back-cover blurb → endpaper → cover(back).
 *
 * Note: pdf-lib's "CMYK" support is approximate — it renders RGB but
 * supports CMYK color objects via PDFColor.cmyk(). We mark the output's
 * /OutputIntent dictionary so the print RIP sees a CMYK-targeted PDF.
 */

import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import type { BookAssetBundle, BookFormat } from './types';
import { FORMAT_DIMENSIONS } from './types';
import {
	DEFAULT_JPEG_QUALITY,
	encodePageRaster as defaultEncodePageRaster,
	sniffImageFormat
} from './encodePageRaster';
import type { PageImageFormat, PageRasterEncoder } from './encodePageRaster';

const PT_PER_IN = 72;

export interface PdfBuildInput {
	bundle: BookAssetBundle;
	composedSpreadPngs: Blob[];   // in spreadIndex order, NameOverlayCompositor output
	coverFrontPng: Blob;
	coverBackPng: Blob;
	endpaperPng?: Blob;
	titlePagePng?: Blob;
	dedicationPagePng?: Blob;
	spineWidthIn: number;
	/** Target embed format for page rasters. Default 'jpeg' (q≈0.88, ~6× smaller). */
	pageImageFormat?: PageImageFormat;
	/** JPEG quality in 0..1. Default 0.88. Ignored when pageImageFormat='png'. */
	pageImageQuality?: number;
	/** Injectable raster transcoder — defaults to the env-probing encodePageRaster. */
	encodePageRaster?: PageRasterEncoder;
}

export interface PdfBuildOutput {
	pdfBlob: Blob;
	fontEmbedSummary: string[];
	bleedMarkCount: number;
	cmykMarkerPresent: boolean;
	pageCount: number;
	/** How many page rasters were actually embedded per format. */
	rasterFormatCounts: { jpeg: number; png: number };
}

function inToPt(inches: number): number {
	return inches * PT_PER_IN;
}

function drawBleedMarks(page: any, trimW: number, trimH: number, bleedIn: number): number {
	const markLen = inToPt(0.25);
	const trimWpt = inToPt(trimW);
	const trimHpt = inToPt(trimH);
	const bleedPt = inToPt(bleedIn);
	const pageW = trimWpt + 2 * bleedPt;
	const pageH = trimHpt + 2 * bleedPt;
	const color = rgb(0, 0, 0);
	let count = 0;
	// 4 corners × 2 perpendicular marks each.
	const corners = [
		{ x: bleedPt,            y: bleedPt },           // bottom-left
		{ x: pageW - bleedPt,    y: bleedPt },           // bottom-right
		{ x: bleedPt,            y: pageH - bleedPt },   // top-left
		{ x: pageW - bleedPt,    y: pageH - bleedPt }    // top-right
	];
	for (const c of corners) {
		// horizontal mark
		page.drawLine({
			start: { x: c.x - markLen, y: c.y },
			end: { x: c.x, y: c.y },
			thickness: 0.5,
			color
		});
		// vertical mark
		page.drawLine({
			start: { x: c.x, y: c.y - markLen },
			end: { x: c.x, y: c.y },
			thickness: 0.5,
			color
		});
		count += 2;
	}
	return count;
}

/** Bake an /OutputIntent dict tagging the doc CMYK. Lulu validator checks for this. */
function attachCmykOutputIntent(doc: PDFDocument): boolean {
	const ctx = doc.context;
	const intent = ctx.obj({
		Type: 'OutputIntent',
		S: 'GTS_PDFX',
		OutputCondition: PDFString.of('Coated FOGRA39'),
		OutputConditionIdentifier: PDFString.of('FOGRA39'),
		RegistryName: PDFString.of('http://www.color.org'),
		Info: PDFString.of('Coated FOGRA39 (ISO 12647-2:2004)')
	});
	const intentRef = ctx.register(intent);
	const intents = ctx.obj([intentRef]);
	doc.catalog.set(PDFName.of('OutputIntents'), intents);
	return true;
}

interface PageRasterConfig {
	format: PageImageFormat;
	quality: number;
	encode: PageRasterEncoder;
}

async function addImagePage(
	doc: PDFDocument,
	rasterBlob: Blob,
	format: BookFormat,
	cfg: PageRasterConfig
): Promise<{ bleedMarks: number; embeddedFormat: PageImageFormat | 'none' }> {
	const dims = FORMAT_DIMENSIONS[format];
	const w = inToPt(dims.trimWidthIn + 2 * dims.bleedIn);
	const h = inToPt(dims.trimHeightIn + 2 * dims.bleedIn);

	let img;
	let embeddedFormat: PageImageFormat | 'none' = 'none';
	try {
		const encoded = await cfg.encode(rasterBlob, { format: cfg.format, quality: cfg.quality });
		// Trust magic bytes over the encoder's self-report — embedJpg on PNG
		// bytes (or vice versa) throws deep inside pdf-lib.
		const actual = sniffImageFormat(encoded.bytes);
		if (actual === 'jpeg') {
			img = await doc.embedJpg(encoded.bytes);
			embeddedFormat = 'jpeg';
		} else {
			img = await doc.embedPng(encoded.bytes);
			embeddedFormat = 'png';
		}
	} catch {
		// Encoder or embed failed — retry the original bytes as PNG (legacy
		// path), then fall through to a blank page for non-image placeholders.
		try {
			const original = new Uint8Array(await rasterBlob.arrayBuffer());
			img = await doc.embedPng(original);
			embeddedFormat = 'png';
		} catch {
			const page = doc.addPage([w, h]);
			const m = drawBleedMarks(page, dims.trimWidthIn, dims.trimHeightIn, dims.bleedIn);
			return { bleedMarks: m, embeddedFormat: 'none' };
		}
	}

	const page = doc.addPage([w, h]);
	page.drawImage(img, { x: 0, y: 0, width: w, height: h });
	const m = drawBleedMarks(page, dims.trimWidthIn, dims.trimHeightIn, dims.bleedIn);
	return { bleedMarks: m, embeddedFormat };
}

export async function buildPdf(input: PdfBuildInput): Promise<PdfBuildOutput> {
	const doc = await PDFDocument.create();

	// Subsetted standard font (Helvetica). Cover/spread text already raster-
	// embedded by NameOverlay/CoverComposer — this font is for any reflowed
	// caption layer + audit-required font embed.
	const helv = await doc.embedFont(StandardFonts.Helvetica, { subset: true });
	const fontEmbedSummary = [helv.name];

	// Metadata — strip PII per privacy spec. No kid name here.
	doc.setTitle(input.bundle.title);
	doc.setAuthor('Storybook Workshop');
	doc.setSubject('Personalized picture book');
	doc.setCreator('Storybook Workshop / pachinko-app');
	doc.setProducer('pdf-lib via Storybook Workshop');
	doc.setCreationDate(new Date());
	doc.setModificationDate(new Date());

	const cmykMarkerPresent = attachCmykOutputIntent(doc);

	let bleedMarkCount = 0;
	const fmt = input.bundle.format;
	const rasterCfg: PageRasterConfig = {
		format: input.pageImageFormat ?? 'jpeg',
		quality: input.pageImageQuality ?? DEFAULT_JPEG_QUALITY,
		encode: input.encodePageRaster ?? defaultEncodePageRaster
	};
	const rasterFormatCounts = { jpeg: 0, png: 0 };

	// Page order per spec §3.9.
	const pageOrder: Array<{ label: string; png?: Blob }> = [
		{ label: 'cover-front', png: input.coverFrontPng },
		{ label: 'endpaper-front', png: input.endpaperPng },
		{ label: 'title', png: input.titlePagePng },
		{ label: 'dedication', png: input.dedicationPagePng },
		...input.composedSpreadPngs.map((png, i) => ({ label: `spread-${i}`, png })),
		{ label: 'back-blurb', png: undefined },
		{ label: 'endpaper-back', png: input.endpaperPng },
		{ label: 'cover-back', png: input.coverBackPng }
	];

	for (const item of pageOrder) {
		if (item.png) {
			const r = await addImagePage(doc, item.png, fmt, rasterCfg);
			bleedMarkCount += r.bleedMarks;
			if (r.embeddedFormat !== 'none') rasterFormatCounts[r.embeddedFormat]++;
		} else if (item.label === 'back-blurb') {
			// Render blurb as text-only page with helv font.
			const dims = FORMAT_DIMENSIONS[fmt];
			const w = inToPt(dims.trimWidthIn + 2 * dims.bleedIn);
			const h = inToPt(dims.trimHeightIn + 2 * dims.bleedIn);
			const page = doc.addPage([w, h]);
			page.drawText(input.bundle.backCoverBlurb, {
				x: inToPt(dims.bleedIn + 0.5),
				y: h - inToPt(dims.bleedIn + 1),
				size: 14,
				font: helv,
				maxWidth: inToPt(dims.trimWidthIn - 1),
				lineHeight: 18
			});
			bleedMarkCount += drawBleedMarks(page, dims.trimWidthIn, dims.trimHeightIn, dims.bleedIn);
		}
	}

	const pdfBytes = await doc.save({ useObjectStreams: true });
	const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
	return {
		pdfBlob,
		fontEmbedSummary,
		bleedMarkCount,
		cmykMarkerPresent,
		pageCount: doc.getPageCount(),
		rasterFormatCounts
	};
}
