// @graph-layer: private
// @rationale: private (dev/test-only synthetic image encoder)
//
// src/lib/services/imagegen/mockPng.ts
//
// Tiny dependency-free PNG encoder + 5x7 bitmap-font label renderer for the
// mock image-gen provider. Emits valid 8-bit truecolor (RGB) PNGs using
// STORED (uncompressed) zlib deflate blocks — no zlib / CompressionStream
// dependency, byte-deterministic across Node and browsers, fast enough for
// dev previews and vitest.

// ---------------------------------------------------------------------------
// CRC32 / Adler32
// ---------------------------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
	if (CRC_TABLE) return CRC_TABLE;
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	CRC_TABLE = t;
	return t;
}

function crc32(bytes: Uint8Array): number {
	const t = crcTable();
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (let i = 0; i < bytes.length; i++) {
		a = (a + bytes[i]) % 65521;
		b = (b + a) % 65521;
	}
	return (((b << 16) >>> 0) + a) >>> 0;
}

// ---------------------------------------------------------------------------
// PNG encoding (stored-deflate)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** Wrap raw bytes in a zlib stream of STORED deflate blocks. */
function zlibStore(raw: Uint8Array): Uint8Array {
	const blockCount = Math.max(1, Math.ceil(raw.length / 65535));
	const out = new Uint8Array(2 + raw.length + blockCount * 5 + 4);
	const dv = new DataView(out.buffer);
	let o = 0;
	out[o++] = 0x78; // CMF: deflate, 32k window
	out[o++] = 0x01; // FLG: check bits, no dict, fastest
	for (let i = 0; i < blockCount; i++) {
		const start = i * 65535;
		const len = Math.min(65535, raw.length - start);
		out[o++] = i === blockCount - 1 ? 1 : 0; // BFINAL, BTYPE=00 (stored)
		out[o++] = len & 0xff;
		out[o++] = (len >>> 8) & 0xff;
		out[o++] = ~len & 0xff;
		out[o++] = (~len >>> 8) & 0xff;
		out.set(raw.subarray(start, start + len), o);
		o += len;
	}
	dv.setUint32(o, adler32(raw));
	o += 4;
	return out.subarray(0, o);
}

/** Encode an RGB pixel buffer (width*height*3 bytes) as a PNG. */
export function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Uint8Array {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
		throw new Error(`encodeRgbPng: invalid dimensions ${width}x${height}`);
	}
	if (rgb.length !== width * height * 3) {
		throw new Error(`encodeRgbPng: rgb buffer size ${rgb.length} != ${width * height * 3}`);
	}
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type: truecolor RGB
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	const stride = 1 + width * 3;
	const raw = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		raw[y * stride] = 0; // filter: none
		raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * stride + 1);
	}

	const parts = [
		PNG_SIGNATURE,
		chunk('IHDR', ihdr),
		chunk('IDAT', zlibStore(raw)),
		chunk('IEND', new Uint8Array(0)),
	];
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/** Read `{ width, height }` from a PNG's IHDR. Throws on non-PNG bytes. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
	if (bytes.length < 24) throw new Error('readPngSize: too short to be a PNG');
	for (let i = 0; i < PNG_SIGNATURE.length; i++) {
		if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('readPngSize: bad PNG signature');
	}
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (uppercase + digits + label punctuation)
// ---------------------------------------------------------------------------

const FONT: Record<string, number[]> = {
	A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
	B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
	C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
	D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
	E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
	F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
	G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
	H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
	I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
	J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
	K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
	L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
	M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
	N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
	O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
	P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
	Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
	R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
	S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
	T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
	U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
	V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
	W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
	X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
	Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
	Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
	'0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
	'1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
	'2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
	'3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
	'4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
	'5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
	'6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
	'7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
	'8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
	'9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
	' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
	':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
	'-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
	'.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
	'#': [0x0a, 0x1f, 0x0a, 0x0a, 0x0a, 0x1f, 0x0a],
	'/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
	'?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

/**
 * Stamp `text` (uppercased; unknown chars render as '?') onto an RGB pixel
 * buffer with a dark backing strip so labels stay readable on any gradient.
 */
export function drawLabel(
	rgb: Uint8Array,
	width: number,
	height: number,
	text: string,
	x: number,
	y: number,
	pixelScale = 2,
): void {
	const chars = text.toUpperCase().split('');
	const cellW = (GLYPH_W + 1) * pixelScale;
	const stripW = Math.min(width - x, chars.length * cellW + pixelScale * 2);
	const stripH = (GLYPH_H + 2) * pixelScale;

	// Dark backing strip.
	for (let sy = 0; sy < stripH; sy++) {
		const py = y + sy;
		if (py < 0 || py >= height) continue;
		for (let sx = 0; sx < stripW; sx++) {
			const px = x + sx;
			if (px < 0 || px >= width) continue;
			const idx = (py * width + px) * 3;
			rgb[idx] = 24;
			rgb[idx + 1] = 24;
			rgb[idx + 2] = 32;
		}
	}

	// Glyphs.
	for (let ci = 0; ci < chars.length; ci++) {
		const glyph = FONT[chars[ci]] ?? FONT['?'];
		const gx = x + pixelScale + ci * cellW;
		const gy = y + pixelScale;
		for (let row = 0; row < GLYPH_H; row++) {
			const bits = glyph[row];
			for (let col = 0; col < GLYPH_W; col++) {
				if (!(bits & (1 << (GLYPH_W - 1 - col)))) continue;
				for (let dy = 0; dy < pixelScale; dy++) {
					for (let dx = 0; dx < pixelScale; dx++) {
						const px = gx + col * pixelScale + dx;
						const py = gy + row * pixelScale + dy;
						if (px < 0 || px >= width || py < 0 || py >= height) continue;
						const idx = (py * width + px) * 3;
						rgb[idx] = 245;
						rgb[idx + 1] = 245;
						rgb[idx + 2] = 245;
					}
				}
			}
		}
	}
}
