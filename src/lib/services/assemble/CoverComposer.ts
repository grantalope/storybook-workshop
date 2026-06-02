// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * CoverComposer — front + spine + back-cover assembly
 *
 * Spec ref: §3.9, Phase 3 of goal file. Owns the cover-PDF interior:
 *  - Spine width formula = pageCount × pageThicknessMm + 2 × bleedIn (converted to inches)
 *  - Title via Pretext typography pipeline (handed off from goal #4)
 *  - Cover badge (e.g. "Birthday Edition")
 *  - Author byline
 *  - Back-cover blurb
 *
 * NameOverlayCompositor (separate service) handles the kid's name on the
 * cover front — CoverComposer composes the canvas around it.
 */

import type { BookFormat, CoverBadge, FormatDimensions } from './types';
import { FORMAT_DIMENSIONS } from './types';

const MM_PER_IN = 25.4;

/** Spine width in inches given page count + format. */
export function computeSpineWidthIn(pageCount: number, format: BookFormat): number {
	if (pageCount < 0) throw new Error('CoverComposer: pageCount must be non-negative');
	const dims = FORMAT_DIMENSIONS[format];
	if (!dims) throw new Error(`CoverComposer: unknown format ${format}`);
	// Saddle-stitch: no spine width (folded sheets).
	if (format === 'saddlestitch-8x8') return 0;
	const spineIn = (pageCount * dims.pageThicknessMm) / MM_PER_IN;
	return Number(spineIn.toFixed(4));
}

/** Cover canvas dimensions in inches (front + spine + back + 2× bleed all sides). */
export interface CoverCanvasDimensions {
	widthIn: number;
	heightIn: number;
	frontStartIn: number;
	spineStartIn: number;
	backStartIn: number;
	bleedIn: number;
	spineWidthIn: number;
}

export function computeCoverCanvas(pageCount: number, format: BookFormat): CoverCanvasDimensions {
	const dims = FORMAT_DIMENSIONS[format];
	const spineWidthIn = computeSpineWidthIn(pageCount, format);
	const bleedIn = dims.bleedIn;
	const trimW = dims.trimWidthIn;
	const trimH = dims.trimHeightIn;
	const widthIn = bleedIn + trimW + spineWidthIn + trimW + bleedIn;
	const heightIn = bleedIn + trimH + bleedIn;
	return {
		widthIn: Number(widthIn.toFixed(4)),
		heightIn: Number(heightIn.toFixed(4)),
		frontStartIn: bleedIn + trimW + spineWidthIn,
		spineStartIn: bleedIn + trimW,
		backStartIn: bleedIn,
		bleedIn,
		spineWidthIn
	};
}

export interface CoverComposerInput {
	frontPng: Blob;
	backPng?: Blob;
	title: string;
	authorByline?: string;
	backCoverBlurb: string;
	coverBadge?: CoverBadge;
	pageCount: number;
	format: BookFormat;
}

export interface CoverComposerOutput {
	frontPng: Blob;
	spinePng?: Blob;
	backPng: Blob;
	canvas: CoverCanvasDimensions;
}

function hasBrowserCanvas(): boolean {
	return typeof globalThis !== 'undefined'
		&& typeof (globalThis as any).document !== 'undefined'
		&& typeof (globalThis as any).Image !== 'undefined';
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob);
	try {
		return await new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new (globalThis as any).Image();
			img.onload = () => resolve(img);
			img.onerror = (e) => reject(e);
			img.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function composeFrontCover(input: CoverComposerInput, canvasDims: CoverCanvasDimensions): Promise<Blob> {
	if (!hasBrowserCanvas()) {
		const buf = await input.frontPng.arrayBuffer();
		return new Blob([buf], { type: 'image/png' });
	}
	const img = await blobToImage(input.frontPng);
	const canvas: any = (globalThis as any).document.createElement('canvas');
	const dpi = 300;
	canvas.width = Math.round((FORMAT_DIMENSIONS[input.format].trimWidthIn + 2 * canvasDims.bleedIn) * dpi);
	canvas.height = Math.round((FORMAT_DIMENSIONS[input.format].trimHeightIn + 2 * canvasDims.bleedIn) * dpi);
	const ctx: any = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	// Title typography overlay
	ctx.fillStyle = '#ffffff';
	ctx.textAlign = 'center';
	ctx.font = `bold 168px "Georgia", serif`;
	ctx.fillText(input.title, canvas.width / 2, canvas.height * 0.18);
	if (input.coverBadge) {
		ctx.fillStyle = input.coverBadge.accentHex ?? '#e7c84a';
		ctx.font = `italic 64px "Georgia", serif`;
		ctx.fillText(input.coverBadge.label, canvas.width / 2, canvas.height * 0.92);
	}
	if (input.authorByline) {
		ctx.fillStyle = '#f5f1e6';
		ctx.font = `48px "Georgia", serif`;
		ctx.fillText(input.authorByline, canvas.width / 2, canvas.height * 0.97);
	}
	return await new Promise<Blob>((res, rej) => {
		canvas.toBlob((b: Blob | null) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png');
	});
}

async function composeBackCover(input: CoverComposerInput, canvasDims: CoverCanvasDimensions): Promise<Blob> {
	if (!hasBrowserCanvas()) {
		const buf = (input.backPng ?? input.frontPng);
		const ab = await buf.arrayBuffer();
		return new Blob([ab], { type: 'image/png' });
	}
	const canvas: any = (globalThis as any).document.createElement('canvas');
	const dpi = 300;
	canvas.width = Math.round((FORMAT_DIMENSIONS[input.format].trimWidthIn + 2 * canvasDims.bleedIn) * dpi);
	canvas.height = Math.round((FORMAT_DIMENSIONS[input.format].trimHeightIn + 2 * canvasDims.bleedIn) * dpi);
	const ctx: any = canvas.getContext('2d');
	if (input.backPng) {
		const img = await blobToImage(input.backPng);
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	} else {
		ctx.fillStyle = '#2a2622';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	// Back-cover blurb — word-wrapped paragraph
	ctx.fillStyle = '#f5f1e6';
	ctx.font = `36px "Georgia", serif`;
	ctx.textAlign = 'left';
	const blurb = input.backCoverBlurb;
	const padX = canvas.width * 0.08;
	const lineHeight = 52;
	const maxLineW = canvas.width - 2 * padX;
	const words = blurb.split(/\s+/);
	let line = '';
	let y = canvas.height * 0.2;
	for (const w of words) {
		const test = line ? line + ' ' + w : w;
		if (ctx.measureText(test).width > maxLineW) {
			ctx.fillText(line, padX, y);
			y += lineHeight;
			line = w;
		} else line = test;
	}
	if (line) ctx.fillText(line, padX, y);
	return await new Promise<Blob>((res, rej) => {
		canvas.toBlob((b: Blob | null) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png');
	});
}

async function composeSpine(canvasDims: CoverCanvasDimensions, title: string): Promise<Blob | undefined> {
	if (canvasDims.spineWidthIn <= 0) return undefined;
	if (!hasBrowserCanvas()) return new Blob([new Uint8Array([0])], { type: 'image/png' });
	const canvas: any = (globalThis as any).document.createElement('canvas');
	const dpi = 300;
	canvas.width = Math.max(1, Math.round(canvasDims.spineWidthIn * dpi));
	canvas.height = Math.round(canvasDims.heightIn * dpi);
	const ctx: any = canvas.getContext('2d');
	ctx.fillStyle = '#1a1815';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	if (canvas.width >= 60) {
		ctx.save();
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate(-Math.PI / 2);
		ctx.textAlign = 'center';
		ctx.fillStyle = '#f5f1e6';
		ctx.font = `bold ${Math.min(48, canvas.width - 20)}px "Georgia", serif`;
		ctx.fillText(title, 0, 0);
		ctx.restore();
	}
	return await new Promise<Blob>((res, rej) => {
		canvas.toBlob((b: Blob | null) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png');
	});
}

export async function composeCover(input: CoverComposerInput): Promise<CoverComposerOutput> {
	const canvas = computeCoverCanvas(input.pageCount, input.format);
	const [frontPng, backPng, spinePng] = await Promise.all([
		composeFrontCover(input, canvas),
		composeBackCover(input, canvas),
		composeSpine(canvas, input.title)
	]);
	return { frontPng, backPng, spinePng, canvas };
}
