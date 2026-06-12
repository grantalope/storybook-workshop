// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * encodePageRaster — page-raster transcode boundary for PdfBuilder.
 *
 * WHY: 29 print-res PNGs embedded raw produced a 353MB interior PDF. Lulu
 * accepts it but it is unwieldy to upload/store. JPEG q≈88 at 300dpi is
 * visually lossless for print (text is part of the raster anyway), and cuts
 * the file by ~6×. This module owns the PNG→JPEG transcode so PdfBuilder
 * stays a pure pdf-lib composer.
 *
 * Environment matrix (probed in order, all failures degrade gracefully):
 *   1. Input already JPEG            → passthrough (no double-encode).
 *   2. Target format 'png'          → passthrough (legacy behavior knob).
 *   3. Browser canvas               → OffscreenCanvas.convertToBlob /
 *                                      HTMLCanvas.toBlob('image/jpeg', q),
 *                                      white-flattened (JPEG has no alpha).
 *   4. Node `sharp` (if installed)  → sharp().flatten().jpeg({ quality }).
 *   5. Nothing available            → passthrough as PNG. The PDF still
 *                                      builds; it is just not compressed.
 *
 * The encoder is injectable (`PageRasterEncoder`) so tests and callers with
 * their own pipeline (e.g. a worker pool) can substitute implementations.
 */

/** Interior page raster target format. */
export type PageImageFormat = 'jpeg' | 'png';

export interface EncodePageRasterOptions {
	/** Target format. 'png' is a passthrough (legacy behavior). */
	format: PageImageFormat;
	/** JPEG quality in 0..1. Default 0.88 — visually lossless at 300dpi. */
	quality?: number;
}

export interface EncodedPageRaster {
	bytes: Uint8Array;
	/** ACTUAL format of `bytes` — may stay 'png' when no encoder is available. */
	format: PageImageFormat;
}

export type PageRasterEncoder = (
	blob: Blob,
	opts: EncodePageRasterOptions
) => Promise<EncodedPageRaster>;

export const DEFAULT_JPEG_QUALITY = 0.88;

/** Sniff actual image format from magic bytes. */
export function sniffImageFormat(bytes: Uint8Array): PageImageFormat | 'unknown' {
	if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return 'png';
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'jpeg';
	}
	return 'unknown';
}

function clampQuality(q: number | undefined): number {
	const v = q ?? DEFAULT_JPEG_QUALITY;
	return Math.min(1, Math.max(0.01, v));
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

function hasOffscreenCanvas(): boolean {
	const g = globalThis as any;
	return typeof g.createImageBitmap === 'function' && typeof g.OffscreenCanvas === 'function';
}

function hasDomCanvas(): boolean {
	const g = globalThis as any;
	return typeof g.document?.createElement === 'function' && typeof g.Image === 'function';
}

/** Browser path: draw onto a white-filled canvas, encode image/jpeg. */
async function encodeJpegViaCanvas(blob: Blob, quality: number): Promise<Uint8Array> {
	const g = globalThis as any;
	if (hasOffscreenCanvas()) {
		const bmp = await g.createImageBitmap(blob);
		try {
			const canvas = new g.OffscreenCanvas(bmp.width, bmp.height);
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
			ctx.fillStyle = '#ffffff'; // JPEG has no alpha — flatten onto white
			ctx.fillRect(0, 0, bmp.width, bmp.height);
			ctx.drawImage(bmp, 0, 0);
			const out: Blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
			return blobToBytes(out);
		} finally {
			bmp.close?.();
		}
	}
	// HTMLCanvas fallback
	const url = g.URL.createObjectURL(blob);
	try {
		const img: any = await new Promise((resolve, reject) => {
			const el = new g.Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error('Image decode failed'));
			el.src = url;
		});
		const canvas: any = g.document.createElement('canvas');
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('canvas 2d context unavailable');
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(img, 0, 0);
		const out: Blob = await new Promise((resolve, reject) => {
			canvas.toBlob(
				(b: Blob | null) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
				'image/jpeg',
				quality
			);
		});
		return blobToBytes(out);
	} finally {
		g.URL.revokeObjectURL(url);
	}
}

/** Node path: optional `sharp` (NOT a declared dependency — probed at runtime). */
async function encodeJpegViaSharp(bytes: Uint8Array, quality: number): Promise<Uint8Array> {
	const specifier = 'sharp'; // variable specifier keeps Vite from pre-bundling
	const mod: any = await import(/* @vite-ignore */ specifier);
	const sharp = mod?.default ?? mod;
	const buf = await sharp(Buffer.from(bytes))
		.flatten({ background: '#ffffff' })
		.jpeg({ quality: Math.round(quality * 100) })
		.toBuffer();
	return new Uint8Array(buf);
}

/**
 * Default page-raster encoder. Never throws on missing encoders — degrades
 * to PNG passthrough so PDF assembly always succeeds.
 */
export async function encodePageRaster(
	blob: Blob,
	opts: EncodePageRasterOptions
): Promise<EncodedPageRaster> {
	const bytes = await blobToBytes(blob);
	const inputFormat = sniffImageFormat(bytes);

	// Already-JPEG input: never re-encode (generation loss + wasted work).
	if (inputFormat === 'jpeg') return { bytes, format: 'jpeg' };

	// PNG target (or unsniffable input): passthrough untouched.
	if (opts.format === 'png' || inputFormat === 'unknown') {
		return { bytes, format: 'png' };
	}

	const quality = clampQuality(opts.quality);

	if (hasOffscreenCanvas() || hasDomCanvas()) {
		try {
			return { bytes: await encodeJpegViaCanvas(blob, quality), format: 'jpeg' };
		} catch {
			// fall through to sharp / passthrough
		}
	}

	try {
		return { bytes: await encodeJpegViaSharp(bytes, quality), format: 'jpeg' };
	} catch {
		// sharp not installed (it is optional) or encode failed — passthrough.
	}

	return { bytes, format: 'png' };
}
