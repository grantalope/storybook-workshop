import { describe, it, expect } from 'vitest';
import {
	assemble,
	AssemblyValidationError
} from '$lib/services/assemble/BookAssembler';
import { makeBundle } from './_fixtures';

describe('BookAssembler.assemble', () => {
	it('end-to-end: produces PDF + ePub + shortcode + audit', async () => {
		const bundle = makeBundle({ pages: 24 });
		const spreadTexts = Array.from({ length: 7 }, (_, i) => `Spread ${i+1} with {HERO_NAME}.`);
		const out = await assemble(bundle, { spreadTexts });
		expect(out.pdfBlob).toBeInstanceOf(Blob);
		expect(out.pdfBlob.size).toBeGreaterThan(100);
		expect(out.epubBlob).toBeInstanceOf(Blob);
		expect(out.shortcode).toMatch(/^[a-z2-9]{8}$/);
		expect(out.audit.pdfHash).toMatch(/^[0-9a-f]{64}$/);
		expect(out.audit.pageCount).toBeGreaterThan(0);
		expect(out.audit.cmykValidated).toBe(true);
		expect(out.audit.bleedValidated).toBe(true);
	});

	it('audit.pdfHash is deterministic-shaped (sha256 hex)', async () => {
		const bundle = makeBundle();
		const out1 = await assemble(bundle, { spreadTexts: ['', '', '', '', '', '', ''] });
		expect(out1.audit.pdfHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('throws AssemblyValidationError when page count is below minimum', async () => {
		const bundle = makeBundle({ pages: 6 });   // hardcover min is 24
		await expect(
			assemble(bundle, { spreadTexts: ['','','','','','',''] })
		).rejects.toBeInstanceOf(AssemblyValidationError);
	});

	it('substitutes {HERO_NAME} in the ePub spread text', async () => {
		const JSZip = (await import('jszip')).default;
		const bundle = makeBundle({ kidName: 'Mira' });
		const out = await assemble(bundle, {
			spreadTexts: Array.from({ length: 7 }, () => 'Hello {HERO_NAME}!')
		});
		const zip = await JSZip.loadAsync(await out.epubBlob.arrayBuffer());
		const xhtml = await zip.file('OEBPS/spread-0.xhtml')?.async('string');
		expect(xhtml).toContain('Hello Mira!');
		expect(xhtml).not.toContain('{HERO_NAME}');
	});

	it('honors a custom registerBundle callback for the read-along URL', async () => {
		const bundle = makeBundle();
		const out = await assemble(bundle, {
			spreadTexts: ['','','','','','',''],
			registerBundle: async (b) => `https://cdn.example/sw/${b.shortcode}`
		});
		expect(out.readAlongBundleUrl).toMatch(/^https:\/\/cdn\.example\/sw\/[a-z2-9]{8}$/);
	});

	it('throws when bundle has no scenes', async () => {
		const bundle = makeBundle();
		bundle.wbPngsByScene.clear();
		await expect(assemble(bundle)).rejects.toThrow(/wbPngsByScene is empty/);
	});

	it('throws when spreadTexts length mismatches the spread count', async () => {
		const bundle = makeBundle();
		await expect(
			assemble(bundle, { spreadTexts: ['only-one'] })
		).rejects.toThrow(/spreadTexts length/);
	});
});
