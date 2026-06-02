// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * LuluPdfSpecValidator — pre-checkout PDF gate.
 *
 * Spec ref: §3.9 Phase 5. Each rejection has a parent-readable `message`
 * so the UI can surface it before charging the parent. Hint provides next-
 * step suggestion.
 *
 * Validation matrix (10 cases):
 *  1. page-count-below-min        ← format minimum (hardcover 24, softcover 32, saddle 4)
 *  2. page-count-above-max        ← format maximum (hardcover 800, softcover 740, saddle 48)
 *  3. page-count-not-multiple     ← format multiple (most 2, saddle 4)
 *  4. missing-bleed-marks         ← bleedMarkCount === 0
 *  5. non-cmyk-color-space        ← OutputIntent CMYK marker missing
 *  6. fonts-not-embedded          ← font-embed list empty
 *  7. spine-width-mismatch        ← computed spine differs from claimed
 *  8. trim-size-mismatch          ← page MediaBox not within tolerance of expected trim+bleed
 *  9. pdf-empty                   ← zero-byte blob
 * 10. pdf-corrupt                 ← pdf-lib can't parse
 */

import { PDFDocument, PDFName } from 'pdf-lib';
import type { BookFormat, ValidationReport, ValidationError } from './types';
import { FORMAT_DIMENSIONS } from './types';
import { computeSpineWidthIn } from './CoverComposer';

const PT_PER_IN = 72;
const TRIM_TOL_PT = 1.0;            // ±1pt tolerance on MediaBox match
const SPINE_TOL_IN = 0.01;          // ±0.01in tolerance on spine width

export interface ValidatorInput {
	pdfBlob: Blob;
	format: BookFormat;
	interiorPageCount: number;
	declaredSpineWidthIn: number;
	bleedMarkCount: number;
	fontEmbedSummary: string[];
	cmykMarkerPresent: boolean;
}

export async function validatePdf(input: ValidatorInput): Promise<ValidationReport> {
	const errors: ValidationError[] = [];
	const dims = FORMAT_DIMENSIONS[input.format];

	// 9. empty PDF
	if (input.pdfBlob.size === 0) {
		errors.push({
			code: 'pdf-empty',
			message: 'The book PDF is empty. Please regenerate before checkout.',
			hint: 'Try the "Regenerate book" button at Station 6.'
		});
		return { valid: false, errors };
	}

	// 1 & 2 & 3 page count
	if (input.interiorPageCount < dims.minPages) {
		errors.push({
			code: 'page-count-below-min',
			message: `This format needs at least ${dims.minPages} pages — your book has ${input.interiorPageCount}.`,
			hint: 'Pick a longer length tier at Station 1, or add a quiet-moment spread.'
		});
	}
	if (input.interiorPageCount > dims.maxPages) {
		errors.push({
			code: 'page-count-above-max',
			message: `This format allows up to ${dims.maxPages} pages — your book has ${input.interiorPageCount}.`,
			hint: 'Pick a shorter length tier, or split into two books.'
		});
	}
	if (input.interiorPageCount % dims.pageCountMultiple !== 0) {
		errors.push({
			code: 'page-count-not-multiple',
			message: `This format requires page counts in multiples of ${dims.pageCountMultiple} — your book has ${input.interiorPageCount}.`,
			hint: 'Add or remove one spread to land on a valid count.'
		});
	}

	// 4 bleed marks
	if (input.bleedMarkCount < 8) {  // at least 4 corners × 2 marks each
		errors.push({
			code: 'missing-bleed-marks',
			message: 'The PDF is missing print-shop bleed marks at the corners.',
			hint: 'Regenerate — the assembler should add these automatically.'
		});
	}

	// 5 CMYK
	if (!input.cmykMarkerPresent) {
		errors.push({
			code: 'non-cmyk-color-space',
			message: 'The PDF is not tagged for CMYK print color space.',
			hint: 'Regenerate — the assembler tags this on every build.'
		});
	}

	// 6 fonts
	if (!input.fontEmbedSummary || input.fontEmbedSummary.length === 0) {
		errors.push({
			code: 'fonts-not-embedded',
			message: 'The PDF has no embedded fonts. Print would fail at the print shop.',
			hint: 'Regenerate — the assembler embeds fonts on every build.'
		});
	}

	// 7 spine width
	const computedSpine = computeSpineWidthIn(input.interiorPageCount, input.format);
	if (Math.abs(computedSpine - input.declaredSpineWidthIn) > SPINE_TOL_IN) {
		errors.push({
			code: 'spine-width-mismatch',
			message: `Spine width mismatch: claimed ${input.declaredSpineWidthIn.toFixed(3)}in, computed ${computedSpine.toFixed(3)}in for ${input.interiorPageCount} pages.`,
			hint: 'This is an internal bug — please report it.'
		});
	}

	// 8 & 10 trim size + corruption — parse pdf
	try {
		const ab = await input.pdfBlob.arrayBuffer();
		const bytes = new Uint8Array(ab);
		const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
		const pages = doc.getPages();
		if (pages.length > 0) {
			const expectedWpt = (dims.trimWidthIn + 2 * dims.bleedIn) * PT_PER_IN;
			const expectedHpt = (dims.trimHeightIn + 2 * dims.bleedIn) * PT_PER_IN;
			const p0 = pages[0];
			const { width, height } = p0.getSize();
			if (Math.abs(width - expectedWpt) > TRIM_TOL_PT || Math.abs(height - expectedHpt) > TRIM_TOL_PT) {
				errors.push({
					code: 'trim-size-mismatch',
					message: `PDF trim size (${(width / PT_PER_IN).toFixed(2)}×${(height / PT_PER_IN).toFixed(2)} in) does not match expected ${(expectedWpt / PT_PER_IN).toFixed(2)}×${(expectedHpt / PT_PER_IN).toFixed(2)} for ${input.format}.`,
					hint: 'Regenerate at the correct format size.'
				});
			}
			// Also re-verify OutputIntents present in actual loaded doc
			const oi = doc.catalog.get(PDFName.of('OutputIntents'));
			if (!oi && !errors.some(e => e.code === 'non-cmyk-color-space')) {
				errors.push({
					code: 'non-cmyk-color-space',
					message: 'The PDF has no /OutputIntents marker — print shop cannot confirm CMYK target.',
					hint: 'Regenerate.'
				});
			}
		}
	} catch (err) {
		errors.push({
			code: 'pdf-corrupt',
			message: `The PDF is corrupt or unreadable: ${(err as Error).message}`,
			hint: 'Regenerate the book.'
		});
	}

	return { valid: errors.length === 0, errors };
}
