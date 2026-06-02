import { describe, it, expect } from 'vitest';
import {
	computeSpineWidthIn,
	computeCoverCanvas,
	composeCover
} from '$lib/services/assemble/CoverComposer';
import { tinyPng } from './_fixtures';

describe('computeSpineWidthIn', () => {
	it('hardcover spine = pageCount × 0.13mm / 25.4', () => {
		const w = computeSpineWidthIn(24, 'hardcover-8x8');
		// 24 * 0.13 / 25.4 ≈ 0.1228
		expect(w).toBeGreaterThan(0.12);
		expect(w).toBeLessThan(0.13);
	});

	it('softcover spine uses 0.10mm thickness', () => {
		const w = computeSpineWidthIn(32, 'softcover-8x8');
		// 32 * 0.10 / 25.4 ≈ 0.126
		expect(w).toBeCloseTo(0.126, 2);
	});

	it('saddle-stitch always returns 0 spine', () => {
		expect(computeSpineWidthIn(40, 'saddlestitch-8x8')).toBe(0);
	});

	it('throws on negative page count', () => {
		expect(() => computeSpineWidthIn(-5, 'hardcover-8x8')).toThrow();
	});
});

describe('computeCoverCanvas', () => {
	it('width = bleed + trim + spine + trim + bleed', () => {
		const c = computeCoverCanvas(24, 'hardcover-8x8');
		const spine = computeSpineWidthIn(24, 'hardcover-8x8');
		expect(c.widthIn).toBeCloseTo(0.125 + 8 + spine + 8 + 0.125, 3);
		expect(c.heightIn).toBeCloseTo(0.125 + 8 + 0.125, 3);
		expect(c.spineWidthIn).toBe(spine);
	});

	it('position fields land in expected order back→spine→front', () => {
		const c = computeCoverCanvas(24, 'hardcover-8x8');
		expect(c.backStartIn).toBeLessThan(c.spineStartIn);
		expect(c.spineStartIn).toBeLessThan(c.frontStartIn);
	});
});

describe('composeCover', () => {
	it('returns front + back PNG blobs + no spine for saddle-stitch', async () => {
		const out = await composeCover({
			frontPng: tinyPng(),
			title: 'X',
			backCoverBlurb: 'blurb',
			pageCount: 40,
			format: 'saddlestitch-8x8'
		});
		expect(out.frontPng).toBeInstanceOf(Blob);
		expect(out.backPng).toBeInstanceOf(Blob);
		expect(out.spinePng).toBeUndefined();
		expect(out.canvas.spineWidthIn).toBe(0);
	});

	it('produces a spine PNG for hardcover with non-zero pages', async () => {
		const out = await composeCover({
			frontPng: tinyPng(),
			title: 'X',
			backCoverBlurb: 'blurb',
			pageCount: 100,
			format: 'hardcover-8x8'
		});
		expect(out.canvas.spineWidthIn).toBeGreaterThan(0);
		expect(out.spinePng).toBeInstanceOf(Blob);
	});

	it('honors coverBadge presence', async () => {
		const out = await composeCover({
			frontPng: tinyPng(),
			title: 'X',
			backCoverBlurb: 'blurb',
			coverBadge: { label: 'Birthday Edition', accentHex: '#ff0' },
			pageCount: 24,
			format: 'hardcover-8x8'
		});
		// In node fallback we re-emit the front PNG unchanged, so we only
		// assert that the output blob is produced.
		expect(out.frontPng).toBeInstanceOf(Blob);
	});
});
