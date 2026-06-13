// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * EpubBuilder — ePub3 with optional media-overlay (SMIL) for dedication audio.
 *
 * Spec ref: §3.9 Phase 6. Each spread = one ePub3 <section> with the spread
 * PNG + spread text. If `voiceOver` blob present, every section gets a SMIL
 * media-overlay so reader apps that support EPUB3 media overlays (Apple
 * Books, Thorium) sync highlight to voice. Dedication audio attaches to the
 * dedication page only.
 *
 * Output is a ZIP per EPUB3 OCF spec:
 *  - mimetype (stored, first entry)
 *  - META-INF/container.xml
 *  - OEBPS/content.opf
 *  - OEBPS/toc.xhtml
 *  - OEBPS/spread-N.xhtml
 *  - OEBPS/images/spread-N.png
 *  - OEBPS/audio/voice.* (optional)
 *  - OEBPS/audio/dedication.* (optional)
 *  - OEBPS/smil/spread-N.smil (optional)
 */

import JSZip from 'jszip';
import type { BookAssetBundle } from './types';

export interface EpubBuildInput {
	bundle: BookAssetBundle;
	resolvedSpreadTexts: string[];     // post-NameOverlay
	composedSpreadPngs: Blob[];        // post-NameOverlay
}

export interface EpubBuildOutput {
	epubBlob: Blob;
	hasMediaOverlay: boolean;
	sectionCount: number;
}

function xmlEscape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

function audioMime(blob: Blob): { ext: string; mime: string } {
	const t = (blob.type || '').toLowerCase();
	if (t.includes('mp3') || t.includes('mpeg')) return { ext: 'mp3', mime: 'audio/mpeg' };
	if (t.includes('wav')) return { ext: 'wav', mime: 'audio/wav' };
	if (t.includes('ogg')) return { ext: 'ogg', mime: 'audio/ogg' };
	if (t.includes('m4a') || t.includes('mp4') || t.includes('aac')) return { ext: 'm4a', mime: 'audio/mp4' };
	if (t.includes('webm')) return { ext: 'webm', mime: 'audio/webm' };
	return { ext: 'mp3', mime: 'audio/mpeg' };
}

function buildSpreadXhtml(index: number, text: string, title: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${xmlEscape(title)} — Spread ${index + 1}</title></head>
<body>
  <section epub:type="bodymatter">
    <figure><img src="images/spread-${index}.png" alt="Illustration"/></figure>
    <p id="t-${index}">${xmlEscape(text)}</p>
  </section>
</body>
</html>
`;
}

function buildDedicationXhtml(dedication: string, kidName: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>Dedication</title></head>
<body>
  <section epub:type="dedication">
    <p id="ded-name">For ${xmlEscape(kidName)}.</p>
    <p id="ded-text">${xmlEscape(dedication)}</p>
  </section>
</body>
</html>
`;
}

function buildTocXhtml(sectionCount: number, title: string): string {
	const navItems = ['<li><a href="dedication.xhtml">Dedication</a></li>']
		.concat(Array.from({ length: sectionCount }, (_, i) => `<li><a href="spread-${i}.xhtml">Spread ${i + 1}</a></li>`))
		.join('\n      ');
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${xmlEscape(title)}</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
      ${navItems}
  </ol></nav>
</body>
</html>
`;
}

function buildSpreadSmil(index: number, audioHref: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <par id="par-${index}">
      <text src="spread-${index}.xhtml#t-${index}"/>
      <audio src="${audioHref}"/>
    </par>
  </body>
</smil>
`;
}

// uuid() is a browser/Node19+ global; Node 18 vitest env lacks it.
// The UUID is only an ePub identifier urn - uniqueness suffices, not crypto strength.
function safeRandomUUID(): string {
	const g = globalThis as { crypto?: { randomUUID?: () => string } };
	if (g.crypto?.randomUUID) return g.crypto.randomUUID();
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

function buildContentOpf(opts: {
	title: string;
	sectionCount: number;
	hasVoiceOver: boolean;
	hasDedicationAudio: boolean;
	voiceMime?: string;
	voiceExt?: string;
	dedicationMime?: string;
	dedicationExt?: string;
}): string {
	const uuid = 'urn:uuid:' + safeRandomUUID();
	const manifest: string[] = [
		'<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
		'<item id="dedication" href="dedication.xhtml" media-type="application/xhtml+xml"/>'
	];
	const spine: string[] = ['<itemref idref="dedication"/>'];
	for (let i = 0; i < opts.sectionCount; i++) {
		const overlayAttr = opts.hasVoiceOver ? ` media-overlay="smil-${i}"` : '';
		manifest.push(`<item id="s-${i}" href="spread-${i}.xhtml" media-type="application/xhtml+xml"${overlayAttr}/>`);
		manifest.push(`<item id="img-${i}" href="images/spread-${i}.png" media-type="image/png"/>`);
		if (opts.hasVoiceOver) {
			manifest.push(`<item id="smil-${i}" href="smil/spread-${i}.smil" media-type="application/smil+xml"/>`);
		}
		spine.push(`<itemref idref="s-${i}"/>`);
	}
	if (opts.hasVoiceOver && opts.voiceExt) {
		manifest.push(`<item id="voice" href="audio/voice.${opts.voiceExt}" media-type="${opts.voiceMime}"/>`);
	}
	if (opts.hasDedicationAudio && opts.dedicationExt) {
		manifest.push(`<item id="dedication-audio" href="audio/dedication.${opts.dedicationExt}" media-type="${opts.dedicationMime}"/>`);
	}
	return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${uuid}</dc:identifier>
    <dc:title>${xmlEscape(opts.title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Storybook Workshop</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
  </spine>
</package>
`;
}

export async function buildEpub(input: EpubBuildInput): Promise<EpubBuildOutput> {
	const { bundle, resolvedSpreadTexts, composedSpreadPngs } = input;
	const sectionCount = composedSpreadPngs.length;
	const hasVoiceOver = !!bundle.voiceOver;
	const hasDedicationAudio = !!bundle.dedicationAudio;

	const zip = new JSZip();
	// EPUB mimetype: stored uncompressed, first entry.
	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
	zip.file('META-INF/container.xml', CONTAINER_XML);

	const voiceInfo = hasVoiceOver && bundle.voiceOver ? audioMime(bundle.voiceOver) : undefined;
	const dedInfo = hasDedicationAudio && bundle.dedicationAudio ? audioMime(bundle.dedicationAudio) : undefined;

	zip.file(
		'OEBPS/content.opf',
		buildContentOpf({
			title: bundle.title,
			sectionCount,
			hasVoiceOver,
			hasDedicationAudio,
			voiceMime: voiceInfo?.mime,
			voiceExt: voiceInfo?.ext,
			dedicationMime: dedInfo?.mime,
			dedicationExt: dedInfo?.ext
		})
	);
	zip.file('OEBPS/toc.xhtml', buildTocXhtml(sectionCount, bundle.title));
	zip.file('OEBPS/dedication.xhtml', buildDedicationXhtml(bundle.dedication, bundle.kidName));

	for (let i = 0; i < sectionCount; i++) {
		zip.file(`OEBPS/spread-${i}.xhtml`, buildSpreadXhtml(i, resolvedSpreadTexts[i] ?? '', bundle.title));
		const png = composedSpreadPngs[i];
		const buf = await png.arrayBuffer();
		zip.file(`OEBPS/images/spread-${i}.png`, buf);
		if (hasVoiceOver && voiceInfo) {
			zip.file(`OEBPS/smil/spread-${i}.smil`, buildSpreadSmil(i, `../audio/voice.${voiceInfo.ext}`));
		}
	}

	if (hasVoiceOver && bundle.voiceOver && voiceInfo) {
		zip.file(`OEBPS/audio/voice.${voiceInfo.ext}`, await bundle.voiceOver.arrayBuffer());
	}
	if (hasDedicationAudio && bundle.dedicationAudio && dedInfo) {
		zip.file(`OEBPS/audio/dedication.${dedInfo.ext}`, await bundle.dedicationAudio.arrayBuffer());
	}

	const epubBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
	return {
		epubBlob,
		hasMediaOverlay: hasVoiceOver,
		sectionCount
	};
}
