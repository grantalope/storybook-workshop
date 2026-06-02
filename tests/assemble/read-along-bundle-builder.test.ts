import { describe, it, expect } from 'vitest';
import {
	buildReadAlongBundle,
	generateShortcode
} from '$lib/services/assemble/ReadAlongBundleBuilder';
import { tinyPng, makeBundle } from './_fixtures';

describe('generateShortcode', () => {
	it('produces 8-char base32 (alphabet excludes 0/1/l/o)', () => {
		for (let i = 0; i < 50; i++) {
			const s = generateShortcode();
			expect(s).toMatch(/^[a-z2-9]{8}$/);
			expect(s).not.toMatch(/[01lo]/);
		}
	});

	it('deterministic when seeded with a deterministic rng', () => {
		const det = (() => {
			let n = 0;
			return () => (n++ % 10) / 10;
		})();
		const a = generateShortcode(det);
		const b = generateShortcode(() => 0.1);
		expect(a.length).toBe(8);
		expect(b.length).toBe(8);
	});
});

describe('buildReadAlongBundle', () => {
	it('passes through manifest + spread shape', async () => {
		const bundle = makeBundle();
		const out = await buildReadAlongBundle({
			bundle,
			resolvedSpreadTexts: ['x', 'y'],
			composedSpreadPngs: [tinyPng(), tinyPng()]
		});
		expect(out.bundle.shortcode.length).toBe(8);
		expect(out.bundle.manifest.spreadCount).toBe(2);
		expect(out.bundle.spreads[0].text).toBe('x');
		expect(out.bundle.spreads[1].text).toBe('y');
	});

	it('falls back to a default animation manifest when none provided', async () => {
		const bundle = makeBundle();
		bundle.animationManifests.clear();
		const out = await buildReadAlongBundle({
			bundle,
			resolvedSpreadTexts: ['x'],
			composedSpreadPngs: [tinyPng()]
		});
		expect(out.bundle.spreads[0].animation.effect).toBe('flow');
		expect(out.bundle.spreads[0].animation.beat).toBe('setup');
	});

	it('honors voiceOver + dedicationAudio presence', async () => {
		const bundle = makeBundle({
			voiceOver: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
			dedicationAudio: new Blob([new Uint8Array([2])], { type: 'audio/wav' })
		});
		const out = await buildReadAlongBundle({
			bundle,
			resolvedSpreadTexts: ['a'],
			composedSpreadPngs: [tinyPng()]
		});
		expect(out.bundle.manifest.hasVoiceOver).toBe(true);
		expect(out.bundle.manifest.hasDedicationAudio).toBe(true);
		expect(out.bundle.voiceOver).toBeInstanceOf(Blob);
		expect(out.bundle.dedicationAudio).toBeInstanceOf(Blob);
	});

	it('uses isShortcodeFree to dedupe shortcodes', async () => {
		const bundle = makeBundle();
		let calls = 0;
		const isShortcodeFree = async () => {
			calls++;
			return calls > 1;   // first attempt collides, second is free
		};
		const out = await buildReadAlongBundle({
			bundle,
			resolvedSpreadTexts: ['a'],
			composedSpreadPngs: [tinyPng()],
			isShortcodeFree
		});
		expect(calls).toBe(2);
		expect(out.bundle.shortcode.length).toBe(8);
	});

	it('throws when no free shortcode found in 8 attempts', async () => {
		const bundle = makeBundle();
		await expect(
			buildReadAlongBundle({
				bundle,
				resolvedSpreadTexts: ['a'],
				composedSpreadPngs: [tinyPng()],
				isShortcodeFree: async () => false
			})
		).rejects.toThrow(/failed to mint unique shortcode/);
	});
});
