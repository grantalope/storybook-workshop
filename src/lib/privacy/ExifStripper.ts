// @graph-layer: join
// @rationale: join (privacy/federation/guardrail subsystem — sits on the layer boundary)

/**
 * ExifStripper — explicit EXIF removal for JPEG blobs.
 *
 * Audit finding (B-SKILL-03 part c): the photo-capture path is `getUserMedia
 * → ImageCapture.grabFrame() → canvas → JPEG blob`. Canvas re-encode does in
 * practice drop EXIF on Chromium / Firefox, but the audit flagged this as
 * "accidental property of the encoding pipeline" — not guaranteed across
 * WebKit/Safari or future browser changes. This module makes the strip
 * explicit and verifiable: we scan the JPEG segment stream and emit a clone
 * without any APP1 (EXIF) segments.
 *
 * Implementation notes:
 *   - JPEG structure: SOI (0xFFD8), 0+ segments (0xFF<marker> + length + body),
 *     entropy-coded image data, EOI (0xFFD9).
 *   - APP1 segments (0xFFE1) hold EXIF (and XMP for some encoders). We drop
 *     them all — quest matching uses pixel-space embeddings, not metadata.
 *   - APP0 (JFIF), APP2 (ICC profile), and other markers are preserved so the
 *     image renders correctly across all browsers.
 *   - Non-JPEG inputs (PNG, WebP, etc.) are returned untouched — strip is
 *     a no-op rather than a corruption risk. The capture path always emits
 *     JPEG so this is a defensive case.
 *
 * PR-G — pre-launch claw consent. Spec: section-04-skill-integrations.md
 * B-SKILL-03(c).
 */

const SOI = 0xd8;
const EOI = 0xd9;
const APP1 = 0xe1;
const SOS = 0xda; // Start of Scan — entropy-coded data follows

function isJpeg(bytes: Uint8Array): boolean {
	return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === SOI;
}

/**
 * Walk the JPEG segment stream and copy every byte except APP1/EXIF
 * segments into a fresh Uint8Array.
 *
 * Returns a new Blob. The input blob is left untouched.
 */
export async function stripExif(blob: Blob): Promise<Blob> {
	const buf = new Uint8Array(await blob.arrayBuffer());
	if (!isJpeg(buf)) {
		// Not a JPEG — pass through as-is. Caller chose the encoding; we don't
		// re-encode (would change pixel data and break the similarity score).
		return blob;
	}

	const out: number[] = [];
	let i = 0;

	// Copy SOI.
	out.push(buf[i++], buf[i++]);

	while (i < buf.length) {
		// Every segment starts with 0xFF<marker>. Skip past any 0xFF padding.
		while (i < buf.length && buf[i] !== 0xff) i++;
		if (i >= buf.length) break;
		const ffStart = i;
		// Skip consecutive 0xFF bytes; the marker is the first non-FF byte.
		while (i < buf.length && buf[i] === 0xff) i++;
		if (i >= buf.length) break;
		const marker = buf[i++];

		// EOI: emit and stop.
		if (marker === EOI) {
			// Preserve only the single 0xFF<EOI> pair, drop padding.
			out.push(0xff, EOI);
			return new Blob([new Uint8Array(out)], { type: 'image/jpeg' });
		}

		// SOS: entropy-coded image data follows up to the EOI marker. Copy
		// the SOS header (segment length first 2 bytes) and then stream raw
		// bytes until we hit 0xFF<EOI>.
		if (marker === SOS) {
			// SOS has a length-prefixed header, then raw data until EOI.
			// First copy the SOS marker.
			out.push(0xff, SOS);
			if (i + 1 >= buf.length) break;
			const segLen = (buf[i] << 8) | buf[i + 1];
			// Copy SOS header (segLen bytes including the 2 length bytes).
			for (let k = 0; k < segLen && i + k < buf.length; k++) out.push(buf[i + k]);
			i += segLen;
			// Now copy entropy-coded bytes verbatim until we hit 0xFF<non-zero>.
			// Stuffed 0xFF<00> sequences inside scan data are part of the
			// payload; only 0xFF<non-zero> is a real marker.
			while (i < buf.length) {
				const b = buf[i];
				if (b === 0xff && i + 1 < buf.length && buf[i + 1] !== 0x00) {
					// Hit the next marker — let the outer loop handle it.
					break;
				}
				out.push(b);
				i++;
			}
			continue;
		}

		// Markers with no payload (RST0–RST7 = 0xD0..0xD7; TEM=0x01).
		if (marker >= 0xd0 && marker <= 0xd7) {
			out.push(0xff, marker);
			continue;
		}

		// Length-prefixed segment: next 2 bytes = big-endian length INCLUDING
		// the 2 length bytes themselves. Skip APP1 (EXIF) entirely; copy others.
		if (i + 1 >= buf.length) break;
		const segLen = (buf[i] << 8) | buf[i + 1];
		if (marker === APP1) {
			// Drop the entire segment — ignore the 0xFF<APP1> bytes we read,
			// and skip past the segLen bytes of body.
			i += segLen;
			// Suppress unused-var lint for ffStart.
			void ffStart;
			continue;
		}
		// Copy the marker + segment body intact.
		out.push(0xff, marker);
		const bodyEnd = Math.min(i + segLen, buf.length);
		for (let k = i; k < bodyEnd; k++) out.push(buf[k]);
		i = bodyEnd;
	}

	return new Blob([new Uint8Array(out)], { type: 'image/jpeg' });
}
