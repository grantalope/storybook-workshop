import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { buildPdf } from '$lib/services/assemble/PdfBuilder';
import { tinyPng, makeBundle } from './_fixtures';

describe('buildPdf', () => {
	it('emits a non-empty PDF blob', async () => {
		const bundle = makeBundle();
		const out = await buildPdf({
			bundle,
			composedSpreadPngs: [tinyPng(), tinyPng()],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			spineWidthIn: 0.13
		});
		expect(out.pdfBlob).toBeInstanceOf(Blob);
		expect(out.pdfBlob.size).toBeGreaterThan(200);
		expect(out.pdfBlob.type).toBe('application/pdf');
	});

	it('embeds a subsetted font and reports it in summary', async () => {
		const bundle = makeBundle();
		const out = await buildPdf({
			bundle,
			composedSpreadPngs: [tinyPng()],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			spineWidthIn: 0.13
		});
		expect(out.fontEmbedSummary.length).toBeGreaterThan(0);
		expect(out.fontEmbedSummary.join('|').toLowerCase()).toMatch(/helv/);
	});

	it('draws bleed marks at every page corner', async () => {
		const bundle = makeBundle();
		const out = await buildPdf({
			bundle,
			composedSpreadPngs: [tinyPng(), tinyPng()],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			spineWidthIn: 0.13
		});
		// 5+ pages × 8 marks each = at least 40
		expect(out.bleedMarkCount).toBeGreaterThanOrEqual(40);
	});

	it('attaches CMYK /OutputIntents marker', async () => {
		const bundle = makeBundle();
		const out = await buildPdf({
			bundle,
			composedSpreadPngs: [tinyPng()],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			spineWidthIn: 0.13
		});
		expect(out.cmykMarkerPresent).toBe(true);
		// re-parse and confirm
		const bytes = new Uint8Array(await out.pdfBlob.arrayBuffer());
		const doc = await PDFDocument.load(bytes);
		const oi = doc.catalog.get(PDFName.of('OutputIntents'));
		expect(oi).toBeDefined();
	});

	it('produces page count = cover + endpaper×2 + title + dedication + spreads + back-blurb', async () => {
		const bundle = makeBundle();
		const out = await buildPdf({
			bundle,
			composedSpreadPngs: [tinyPng(), tinyPng(), tinyPng()],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			endpaperPng: tinyPng(),
			titlePagePng: tinyPng(),
			dedicationPagePng: tinyPng(),
			spineWidthIn: 0.13
		});
		// cover-front + endpaper + title + dedication + 3 spreads + back-blurb + endpaper + cover-back = 10
		expect(out.pageCount).toBe(10);
	});

	it('skips endpaper pages when no endpaper provided', async () => {
		const bundle = makeBundle();
		const out = await buildPdf({
			bundle,
			composedSpreadPngs: [tinyPng()],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			spineWidthIn: 0.13
		});
		// cover-front + spread + back-blurb + cover-back = 4
		expect(out.pageCount).toBe(4);
	});

	it('does not include kid name in PDF metadata (privacy)', async () => {
		const bundle = makeBundle({ kidName: 'PrivateKid' });
		const out = await buildPdf({
			bundle,
			composedSpreadPngs: [tinyPng()],
			coverFrontPng: tinyPng(),
			coverBackPng: tinyPng(),
			spineWidthIn: 0.13
		});
		const bytes = new Uint8Array(await out.pdfBlob.arrayBuffer());
		const doc = await PDFDocument.load(bytes);
		expect(doc.getAuthor()).not.toContain('PrivateKid');
		expect(doc.getTitle()).toBe(bundle.title);
	});
});
