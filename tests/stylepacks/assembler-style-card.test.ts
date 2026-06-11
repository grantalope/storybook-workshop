import { describe, expect, it } from 'vitest';
import { assemble } from '$lib/services/assemble/BookAssembler';
import type { ReadAlongBundle } from '$lib/services/assemble/types';
import { makeBundle } from '../assemble/_fixtures';

const SPREAD_TEXTS = Array.from({ length: 7 }, (_, i) => `Spread ${i + 1}`);

describe('BookAssembler art-history style card', () => {
	it('adds a non-legacy style card and pads saddle-stitch pages to the format multiple', async () => {
		const baseline = await assemble(makeBundle({ format: 'saddlestitch-8x8', pages: 8 }), {
			spreadTexts: SPREAD_TEXTS,
			includeStyleCard: false,
		});
		const styled = await assemble(makeBundle({ format: 'saddlestitch-8x8', pages: 8 }), {
			spreadTexts: SPREAD_TEXTS,
			stylePackId: 'ukiyo-e-woodblock',
			includeStyleCard: true,
		});

		expect(styled.audit.pageCount).toBeGreaterThan(baseline.audit.pageCount);
		expect(styled.audit.pageCount - baseline.audit.pageCount).toBe(4);
		expect(styled.audit.spineWidthIn).toBe(0);
	});

	it('keeps page count identical when the style card is explicitly off', async () => {
		const baseline = await assemble(makeBundle({ pages: 24 }), { spreadTexts: SPREAD_TEXTS });
		const off = await assemble(makeBundle({ pages: 24 }), {
			spreadTexts: SPREAD_TEXTS,
			stylePackId: 'ukiyo-e-woodblock',
			includeStyleCard: false,
		});

		expect(off.audit.pageCount).toBe(baseline.audit.pageCount);
	});

	it('defaults on for non-legacy style ids and stays unchanged when absent', async () => {
		const defaultOn = await assemble(makeBundle({ pages: 24 }), {
			spreadTexts: SPREAD_TEXTS,
			stylePackId: 'ukiyo-e-woodblock',
		});
		const explicitOn = await assemble(makeBundle({ pages: 24 }), {
			spreadTexts: SPREAD_TEXTS,
			stylePackId: 'ukiyo-e-woodblock',
			includeStyleCard: true,
		});
		const absent = await assemble(makeBundle({ pages: 24 }), { spreadTexts: SPREAD_TEXTS });
		const absentOff = await assemble(makeBundle({ pages: 24 }), {
			spreadTexts: SPREAD_TEXTS,
			includeStyleCard: false,
		});

		expect(defaultOn.audit.pageCount).toBe(explicitOn.audit.pageCount);
		expect(absent.audit.pageCount).toBe(absentOff.audit.pageCount);
	});

	it('threads stylePackId into the read-along manifest', async () => {
		let captured: ReadAlongBundle | undefined;
		await assemble(makeBundle({ pages: 24 }), {
			spreadTexts: SPREAD_TEXTS,
			stylePackId: 'ukiyo-e-woodblock',
			registerBundle: async (bundle) => {
				captured = bundle;
				return undefined;
			},
		});

		expect(captured?.manifest.stylePackId).toBe('ukiyo-e-woodblock');
	});
});
