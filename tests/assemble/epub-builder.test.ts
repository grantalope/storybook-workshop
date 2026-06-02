import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildEpub } from '$lib/services/assemble/EpubBuilder';
import { tinyPng, makeBundle } from './_fixtures';

async function unzip(blob: Blob): Promise<JSZip> {
	const buf = await blob.arrayBuffer();
	return await JSZip.loadAsync(buf);
}

describe('buildEpub', () => {
	it('produces an ePub3 OCF: mimetype + container + content.opf', async () => {
		const bundle = makeBundle();
		const out = await buildEpub({
			bundle,
			resolvedSpreadTexts: ['Hi Eli.', 'See Eli.'],
			composedSpreadPngs: [tinyPng(), tinyPng()]
		});
		expect(out.epubBlob).toBeInstanceOf(Blob);
		const zip = await unzip(out.epubBlob);
		const mimetype = await zip.file('mimetype')?.async('string');
		expect(mimetype).toBe('application/epub+zip');
		expect(zip.file('META-INF/container.xml')).toBeTruthy();
		expect(zip.file('OEBPS/content.opf')).toBeTruthy();
	});

	it('emits one section per spread', async () => {
		const bundle = makeBundle();
		const out = await buildEpub({
			bundle,
			resolvedSpreadTexts: ['a', 'b', 'c'],
			composedSpreadPngs: [tinyPng(), tinyPng(), tinyPng()]
		});
		expect(out.sectionCount).toBe(3);
		const zip = await unzip(out.epubBlob);
		expect(zip.file('OEBPS/spread-0.xhtml')).toBeTruthy();
		expect(zip.file('OEBPS/spread-1.xhtml')).toBeTruthy();
		expect(zip.file('OEBPS/spread-2.xhtml')).toBeTruthy();
	});

	it('attaches media-overlay (SMIL + audio) when voiceOver present', async () => {
		const bundle = makeBundle({
			voiceOver: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })
		});
		const out = await buildEpub({
			bundle,
			resolvedSpreadTexts: ['a'],
			composedSpreadPngs: [tinyPng()]
		});
		expect(out.hasMediaOverlay).toBe(true);
		const zip = await unzip(out.epubBlob);
		expect(zip.file('OEBPS/smil/spread-0.smil')).toBeTruthy();
		expect(zip.file('OEBPS/audio/voice.mp3')).toBeTruthy();
		const opf = await zip.file('OEBPS/content.opf')?.async('string');
		expect(opf).toContain('media-overlay="smil-0"');
	});

	it('omits SMIL when no voiceOver provided', async () => {
		const bundle = makeBundle();
		const out = await buildEpub({
			bundle,
			resolvedSpreadTexts: ['a'],
			composedSpreadPngs: [tinyPng()]
		});
		expect(out.hasMediaOverlay).toBe(false);
		const zip = await unzip(out.epubBlob);
		expect(zip.file('OEBPS/smil/spread-0.smil')).toBeNull();
	});

	it('includes dedication audio file when dedicationAudio present', async () => {
		const bundle = makeBundle({
			dedicationAudio: new Blob([new Uint8Array([4, 5])], { type: 'audio/wav' })
		});
		const out = await buildEpub({
			bundle,
			resolvedSpreadTexts: ['a'],
			composedSpreadPngs: [tinyPng()]
		});
		const zip = await unzip(out.epubBlob);
		expect(zip.file('OEBPS/audio/dedication.wav')).toBeTruthy();
	});

	it('escapes XML special chars in text', async () => {
		const bundle = makeBundle({ title: 'A & B <hello>' });
		const out = await buildEpub({
			bundle,
			resolvedSpreadTexts: ['it & that <ok>'],
			composedSpreadPngs: [tinyPng()]
		});
		const zip = await unzip(out.epubBlob);
		const xhtml = await zip.file('OEBPS/spread-0.xhtml')?.async('string');
		expect(xhtml).toContain('it &amp; that &lt;ok&gt;');
		const opf = await zip.file('OEBPS/content.opf')?.async('string');
		expect(opf).toContain('A &amp; B &lt;hello&gt;');
	});
});
