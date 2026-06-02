import { describe, it, expect } from 'vitest';
import {
	overlayName,
	overlayBookNames,
	replaceHeroName
} from '$lib/services/assemble/NameOverlayCompositor';
import { tinyPng } from './_fixtures';

describe('replaceHeroName', () => {
	it('replaces every {HERO_NAME} occurrence', () => {
		expect(replaceHeroName('Hi {HERO_NAME}, ready {HERO_NAME}?', 'Eli')).toBe(
			'Hi Eli, ready Eli?'
		);
	});

	it('leaves text untouched when placeholder absent', () => {
		expect(replaceHeroName('Hi there.', 'Eli')).toBe('Hi there.');
	});

	it('returns original text when kidName empty (no crash)', () => {
		expect(replaceHeroName('Hi {HERO_NAME}', '')).toBe('Hi {HERO_NAME}');
	});
});

describe('overlayName (node fallback)', () => {
	it('throws when kidName blank — privacy keystone explicit-input rule', async () => {
		await expect(
			overlayName({ wbPng: tinyPng(), spreadText: 'hi', kidName: ' ' })
		).rejects.toThrow(/kidName required/);
	});

	it('returns resolvedText with placeholder substituted', async () => {
		const out = await overlayName({
			wbPng: tinyPng(),
			spreadText: 'Hello {HERO_NAME}!',
			kidName: 'Eli'
		});
		expect(out.resolvedText).toBe('Hello Eli!');
		expect(out.composedPng).toBeInstanceOf(Blob);
		expect(out.composedPng.type).toBe('image/png');
	});

	it('preserves PNG bytes in node fallback (no browser canvas)', async () => {
		const src = tinyPng();
		const out = await overlayName({
			wbPng: src,
			spreadText: 'x',
			kidName: 'Eli'
		});
		expect(out.composedPng.size).toBe(src.size);
	});
});

describe('overlayBookNames', () => {
	it('composes name across multiple spreads + dedication', async () => {
		const out = await overlayBookNames({
			spreads: [
				{ wbPng: tinyPng(), spreadText: '{HERO_NAME} walks', kidName: 'Eli' },
				{ wbPng: tinyPng(), spreadText: 'and {HERO_NAME} smiles', kidName: 'Eli' }
			],
			dedicationPagePng: tinyPng(),
			kidName: 'Eli',
			dedication: 'For Eli.'
		});
		expect(out.spreads).toHaveLength(2);
		expect(out.spreads[0].resolvedText).toBe('Eli walks');
		expect(out.spreads[1].resolvedText).toBe('and Eli smiles');
		expect(out.dedicationPng).toBeInstanceOf(Blob);
	});

	it('skips dedication overlay when no PNG provided', async () => {
		const out = await overlayBookNames({
			spreads: [{ wbPng: tinyPng(), spreadText: 'x', kidName: 'A' }],
			kidName: 'A',
			dedication: ''
		});
		expect(out.dedicationPng).toBeUndefined();
	});
});
