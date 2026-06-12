// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// Storybook Workshop — BookAssembler public barrel.
// Privacy contract: ONLY this folder touches the kid's plaintext name. See
// NameOverlayCompositor.ts header for the full rule.

export * from './types';
export { overlayName, overlayBookNames, replaceHeroName } from './NameOverlayCompositor';
export { composeCover, computeSpineWidthIn, computeCoverCanvas } from './CoverComposer';
export { buildPdf } from './PdfBuilder';
export { encodePageRaster, sniffImageFormat, DEFAULT_JPEG_QUALITY } from './encodePageRaster';
export type {
	PageImageFormat,
	PageRasterEncoder,
	EncodePageRasterOptions,
	EncodedPageRaster
} from './encodePageRaster';
export { validatePdf } from './LuluPdfSpecValidator';
export { buildEpub } from './EpubBuilder';
export { buildReadAlongBundle, generateShortcode } from './ReadAlongBundleBuilder';
export { assemble, AssemblyValidationError } from './BookAssembler';
