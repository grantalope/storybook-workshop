/**
 * JPEG-in-PDF compression tests — fix for the 353MB raw-PNG interior PDF.
 *
 * Covers:
 *   - encodePageRaster format sniffing + passthrough + graceful degradation
 *   - browser-canvas encode branch (stubbed OffscreenCanvas)
 *   - buildPdf default options (jpeg @ q0.88) + injectable encoder
 *   - jpeg-built PDF strictly smaller than png-built PDF for same fixture
 *   - Lulu spec validator still passes; page dimensions unchanged
 *   - fallback to original PNG when the encoder explodes
 *   - AssembleOptions.pageImageFormat plumbing through BookAssembler
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { buildPdf } from '$lib/services/assemble/PdfBuilder';
import {
	encodePageRaster,
	sniffImageFormat,
	DEFAULT_JPEG_QUALITY,
	type EncodePageRasterOptions,
	type PageRasterEncoder
} from '$lib/services/assemble/encodePageRaster';
import { validatePdf } from '$lib/services/assemble/LuluPdfSpecValidator';
import { assemble } from '$lib/services/assemble/BookAssembler';
import { makeBundle, tinyPng } from './_fixtures';

// ── fixtures ───────────────────────────────────────────────────────────────

/** 1×1 baseline JPEG (3-component YCbCr) — embeddable by pdf-lib embedJpg. */
const TINY_JPEG_BYTES = new Uint8Array(
	Buffer.from(
		'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
		'base64'
	)
);

function tinyJpeg(): Blob {
	return new Blob([TINY_JPEG_BYTES], { type: 'image/jpeg' });
}

// Deterministic PRNG so the noisy PNG is stable across runs.
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function crc32(bytes: Uint8Array): number {
	let crc = ~0;
	for (let i = 0; i < bytes.length; i++) {
		crc ^= bytes[i];
		for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return ~crc >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(8 + data.length + 4);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/**
 * Build a real (pdf-lib-parseable) 8-bit RGB PNG full of incompressible
 * noise — stands in for a print-res painted page raster, which is exactly
 * the content class that bloated the 353MB PDF.
 */
function noisyPng(width = 64, height = 64, seed = 1234): Blob {
	const rand = mulberry32(seed);
	const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 2;  // color type RGB
	const raw = new Uint8Array(height * (1 + width * 3));
	let p = 0;
	for (let y = 0; y < height; y++) {
		raw[p++] = 0; // filter: none
		for (let x = 0; x < width * 3; x++) raw[p++] = Math.floor(rand() * 256);
	}
	const idat = new Uint8Array(deflateSync(raw));
	const png = new Uint8Array([
		...sig,
		...pngChunk('IHDR', ihdr),
		...pngChunk('IDAT', idat),
		...pngChunk('IEND', new Uint8Array(0))
	]);
	return new Blob([png], { type: 'image/png' });
}

/** Injectable encoder simulating a real JPEG compressor (canvas/sharp). */
const fakeJpegEncoder: PageRasterEncoder = async (blob, opts) => {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	if (opts.format === 'png') return { bytes, format: 'png' as const };
	return { bytes: TINY_JPEG_BYTES, format: 'jpeg' as const };
};

afterEach(() => {
	vi.unstubAllGlobals();
});

// ── encodePageRaster unit tests ────────────────────────────────────────────

describe('sniffImageFormat', () => {
	it('identifies png, jpeg, and unknown byte streams', async () => {
		const png = new Uint8Array(await tinyPng().arrayBuffer());
		expect(sniffImageFormat(png)).toBe('png');
		expect(sniffImageFormat(TINY_JPEG_BYTES)).toBe('jpeg');
		expect(sniffImageFormat(new Uint8Array([1, 2, 3, 4, 5]))).toBe('unknown');
	});
});

describe('encodePageRaster', () => {
	it('passes already-JPEG input through untouched (no double encode)', async () => {
		const out = await encodePageRaster(tinyJpeg(), { format: 'jpeg', quality: 0.88 });
		expect(out.format).toBe('jpeg');
		expect(out.bytes).toEqual(TINY_JPEG_BYTES);
	});

	it('passes PNG through untouched when target format is png', async () => {
		const src = new Uint8Array(await tinyPng().arrayBuffer());
		const out = await encodePageRaster(tinyPng(), { format: 'png' });
		expect(out.format).toBe('png');
		expect(out.bytes).toEqual(src);
	});

	it('never throws when no encoder backend exists — degrades to png passthrough', async () => {
		// vitest node env: no OffscreenCanvas/document, sharp not a dependency.
		const out = await encodePageRaster(noisyPng(8, 8), { format: 'jpeg', quality: 0.88 });
		// Whatever backend (if any) handled it, the reported format must match
		// the actual bytes, and the result must be embeddable.
		expect(sniffImageFormat(out.bytes)).toBe(out.format);
	});

	it('uses the browser OffscreenCanvas path when available', async () => {
		const convertToBlob = vi.fn(async (o: { type: string; quality: number }) => {
			expect(o.type).toBe('image/jpeg');
			expect(o.quality).toBeCloseTo(0.88, 5);
			return tinyJpeg();
		});
		const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
		class FakeOffscreenCanvas {
			width: number; height: number;
			constructor(w: number, h: number) { this.width = w; this.height = h; }
			getContext() { return ctx; }
			convertToBlob = convertToBlob;
		}
		vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
		vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 8, height: 8, close: vi.fn() })));

		const out = await encodePageRaster(noisyPng(8, 8), { format: 'jpeg', quality: 0.88 });
		expect(convertToBlob).toHaveBeenCalledTimes(1);
		expect(out.format).toBe('jpeg');
		expect(sniffImageFormat(out.bytes)).toBe('jpeg');
		expect(ctx.fillRect).toHaveBeenCalled(); // white-flatten before draw (JPEG has no alpha)
	});
});

// ── buildPdf integration tests ─────────────────────────────────────────────

describe('buildPdf jpeg compression', () => {
	it('defaults to jpeg @ q0.88 and forwards opts to the injected encoder', async () => {
		const seen: EncodePageRasterOptions[] = [];
		const spy: PageRasterEncoder = async (blob, opts) => {
			seen.push(opts);
			return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'png' };
		};
		const out = await buildPdf({
			bundle: makeBundle(),
			composedSpreadPngs: [tinyPng()],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			spineWidthIn: 0.13,
			encodePageRaster: spy
		});
		expect(seen.length).toBeGreaterThan(0);
		for (const o of seen) {
			expect(o.format).toBe('jpeg');
			expect(o.quality).toBeCloseTo(DEFAULT_JPEG_QUALITY, 5);
		}
		expect(out.pageCount).toBe(4);
	});

	it('produces a smaller PDF with jpeg page rasters than with png for the same fixture', async () => {
		const spreads = [noisyPng(64, 64, 1), noisyPng(64, 64, 2), noisyPng(64, 64, 3)];
		const common = {
			bundle: makeBundle(),
			coverFrontPng: noisyPng(64, 64, 4),
			coverBackPng: noisyPng(64, 64, 5),
			spineWidthIn: 0.13
		};
		const pngOut = await buildPdf({
			...common,
			composedSpreadPngs: spreads,
			pageImageFormat: 'png'
		});
		const jpegOut = await buildPdf({
			...common,
			composedSpreadPngs: spreads,
			pageImageFormat: 'jpeg',
			encodePageRaster: fakeJpegEncoder
		});
		expect(pngOut.rasterFormatCounts.png).toBe(5);
		expect(jpegOut.rasterFormatCounts.jpeg).toBe(5);
		expect(jpegOut.pdfBlob.size).toBeLessThan(pngOut.pdfBlob.size);
	});

	it('jpeg-built PDF still passes the Lulu spec validator', async () => {
		const out = await buildPdf({
			bundle: makeBundle(),
			composedSpreadPngs: [noisyPng(64, 64, 7), noisyPng(64, 64, 8)],
			coverFrontPng: noisyPng(64, 64, 9),
			coverBackPng: noisyPng(64, 64, 10),
			spineWidthIn: 0.13,
			encodePageRaster: fakeJpegEncoder
		});
		const report = await validatePdf({
			pdfBlob: out.pdfBlob,
			format: 'hardcover-8x8',
			interiorPageCount: 24,
			declaredSpineWidthIn: 0.13,
			bleedMarkCount: out.bleedMarkCount,
			fontEmbedSummary: out.fontEmbedSummary,
			cmykMarkerPresent: out.cmykMarkerPresent
		});
		expect(report.errors).toEqual([]);
		expect(report.valid).toBe(true);
	});

	it('keeps page dimensions identical between jpeg and png builds (dpi unchanged)', async () => {
		const mk = (format: 'jpeg' | 'png') =>
			buildPdf({
				bundle: makeBundle(),
				composedSpreadPngs: [noisyPng(32, 32, 11)],
				coverFrontPng: noisyPng(32, 32, 12),
				coverBackPng: noisyPng(32, 32, 13),
				spineWidthIn: 0.13,
				pageImageFormat: format,
				encodePageRaster: format === 'jpeg' ? fakeJpegEncoder : undefined
			});
		const [jpegOut, pngOut] = await Promise.all([mk('jpeg'), mk('png')]);
		const [jpegDoc, pngDoc] = await Promise.all([
			PDFDocument.load(new Uint8Array(await jpegOut.pdfBlob.arrayBuffer())),
			PDFDocument.load(new Uint8Array(await pngOut.pdfBlob.arrayBuffer()))
		]);
		expect(jpegDoc.getPageCount()).toBe(pngDoc.getPageCount());
		// hardcover-8x8: (8 + 2×0.125)in × 72 = 594pt square, every page.
		for (const doc of [jpegDoc, pngDoc]) {
			for (const page of doc.getPages()) {
				const { width, height } = page.getSize();
				expect(width).toBeCloseTo(594, 1);
				expect(height).toBeCloseTo(594, 1);
			}
		}
	});

	it('falls back to embedding the original PNG when the encoder throws', async () => {
		const explosive: PageRasterEncoder = async () => {
			throw new Error('encoder exploded');
		};
		const out = await buildPdf({
			bundle: makeBundle(),
			composedSpreadPngs: [noisyPng(16, 16, 21)],
			coverFrontPng: noisyPng(16, 16, 22),
			coverBackPng: noisyPng(16, 16, 23),
			spineWidthIn: 0.13,
			encodePageRaster: explosive
		});
		expect(out.rasterFormatCounts).toEqual({ jpeg: 0, png: 3 });
		expect(out.pageCount).toBe(4);
		expect(out.pdfBlob.size).toBeGreaterThan(200);
	});

	it('still blanks out non-image placeholder blobs (legacy fallback preserved)', async () => {
		const garbage = new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'application/octet-stream' });
		const out = await buildPdf({
			bundle: makeBundle(),
			composedSpreadPngs: [garbage],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			spineWidthIn: 0.13
		});
		expect(out.pageCount).toBe(4); // blank page still added
		expect(out.bleedMarkCount).toBeGreaterThanOrEqual(32);
	});

	it('embeds already-JPEG inputs directly via embedJpg', async () => {
		const out = await buildPdf({
			bundle: makeBundle(),
			composedSpreadPngs: [tinyJpeg()],
			coverFrontPng: tinyJpeg(),
			coverBackPng: tinyJpeg(),
			spineWidthIn: 0.13
		});
		expect(out.rasterFormatCounts.jpeg).toBe(3);
		expect(out.rasterFormatCounts.png).toBe(0);
		expect(out.pageCount).toBe(4);
	});
});

// ── BookAssembler plumbing ─────────────────────────────────────────────────

describe('AssembleOptions.pageImageFormat plumbing', () => {
	it('threads pageImageFormat/quality/encoder through assemble() to PdfBuilder', async () => {
		const seen: EncodePageRasterOptions[] = [];
		const spy: PageRasterEncoder = async (blob, opts) => {
			seen.push(opts);
			return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'png' };
		};
		const book = await assemble(makeBundle(), {
			pageImageFormat: 'jpeg',
			pageImageQuality: 0.75,
			encodePageRaster: spy
		});
		expect(book.pdfBlob.size).toBeGreaterThan(0);
		expect(seen.length).toBeGreaterThan(0);
		for (const o of seen) {
			expect(o.format).toBe('jpeg');
			expect(o.quality).toBeCloseTo(0.75, 5);
		}
	});
});
