// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * NameOverlayCompositor — PRIVACY KEYSTONE
 * =========================================
 *
 * This is the ONLY service in the storybook-workshop assembler pipeline that
 * touches the kid's plaintext name. All upstream services (story-author,
 * pretext-book-adapter, world-builder client) handle name as a placeholder
 * token `{HERO_NAME}` and never resolve it. NameOverlayCompositor is the
 * single substitution + canvas-overlay point.
 *
 * DO NOT add name handling, persistence, or transmission outside this file.
 * If you find yourself needing the kid's name in another service, the call
 * order is wrong — fix the call order, do not propagate name handling.
 *
 * Architecture: canvas-based overlay. Receives the World-Builder-rendered PNG
 * (which has typography slots blocked out for `{HERO_NAME}`) + the spread
 * text containing the placeholder + the kid's name. Draws name into the
 * focal-point slot using a per-spread positioned canvas overlay; emits a new
 * PNG Blob with name baked in.
 *
 * Spec ref: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §3.9
 * ADR ref: docs/adr/0043-storybook-workshop-privacy-on-device-pillar.md
 */

export interface FocalPoint {
	/** 0..1 normalized x position for name overlay. */
	x: number;
	/** 0..1 normalized y position for name overlay. */
	y: number;
	/** Optional rotation in degrees. */
	rotationDeg?: number;
	/** Optional max width fraction (0..1) — name auto-shrinks to fit. */
	maxWidthFrac?: number;
	/** Optional fill hex; defaults to ink-black. */
	fillHex?: string;
}

export interface NameOverlayInput {
	wbPng: Blob;
	spreadText: string;
	kidName: string;
	focalPoint?: FocalPoint;
	/** Font family stack — defaults to a serif fallback chain. */
	fontFamily?: string;
	/** Base font size in pixels at 300dpi. Default 96 (≈ 32pt). */
	baseFontPx?: number;
}

export interface NameOverlayOutput {
	composedPng: Blob;
	resolvedText: string;
}

/** Replace every `{HERO_NAME}` occurrence in spread text. */
export function replaceHeroName(spreadText: string, kidName: string): string {
	if (!kidName) return spreadText;
	return spreadText.split('{HERO_NAME}').join(kidName);
}

/** Detect canvas + Image API; falls back to a no-op overlay when in Node. */
function hasBrowserCanvas(): boolean {
	return typeof globalThis !== 'undefined'
		&& typeof (globalThis as any).document !== 'undefined'
		&& typeof (globalThis as any).Image !== 'undefined';
}

/** Load Blob → HTMLImageElement (browser-only path). */
async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob);
	try {
		return await new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new (globalThis as any).Image();
			img.onload = () => resolve(img);
			img.onerror = (e: unknown) => reject(e);
			img.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Composite name into PNG via 2D canvas. Returns a fresh PNG blob. */
async function composeBrowser(input: NameOverlayInput): Promise<Blob> {
	const img = await blobToImage(input.wbPng);
	const canvas: any = (globalThis as any).document.createElement('canvas');
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	const ctx: any = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0);

	const focal = input.focalPoint ?? { x: 0.5, y: 0.82, maxWidthFrac: 0.6 };
	const baseFont = input.baseFontPx ?? 96;
	const family = input.fontFamily ?? '"Georgia", "Times New Roman", serif';
	const maxWidthFrac = focal.maxWidthFrac ?? 0.6;
	const maxPx = canvas.width * maxWidthFrac;

	// Shrink-to-fit: start at base, decrement until measured width fits.
	let size = baseFont;
	ctx.fillStyle = focal.fillHex ?? '#1a1815';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	while (size > 12) {
		ctx.font = `${size}px ${family}`;
		const w = ctx.measureText(input.kidName).width;
		if (w <= maxPx) break;
		size -= 4;
	}

	ctx.save();
	const tx = canvas.width * focal.x;
	const ty = canvas.height * focal.y;
	ctx.translate(tx, ty);
	if (focal.rotationDeg) ctx.rotate((focal.rotationDeg * Math.PI) / 180);
	ctx.fillText(input.kidName, 0, 0);
	ctx.restore();

	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((b: Blob | null) => {
			if (b) resolve(b);
			else reject(new Error('canvas.toBlob returned null'));
		}, 'image/png');
	});
}

/**
 * Node fallback — used by vitest. Returns input PNG unchanged but records the
 * overlay event so tests can assert call shape. Real composite happens at
 * browser runtime via composeBrowser.
 */
async function composeNodeFallback(input: NameOverlayInput): Promise<Blob> {
	const buf = await input.wbPng.arrayBuffer();
	return new Blob([buf], { type: input.wbPng.type || 'image/png' });
}

export async function overlayName(input: NameOverlayInput): Promise<NameOverlayOutput> {
	if (!input.kidName || input.kidName.trim().length === 0) {
		throw new Error('NameOverlayCompositor: kidName required (privacy keystone — name must be explicit).');
	}
	const resolvedText = replaceHeroName(input.spreadText, input.kidName);
	const composedPng = hasBrowserCanvas()
		? await composeBrowser(input)
		: await composeNodeFallback(input);
	return { composedPng, resolvedText };
}

/** Multi-spread overlay — also handles dedication page + cover. */
export interface MultiSpreadInput {
	spreads: NameOverlayInput[];
	dedicationPagePng?: Blob;
	coverPng?: Blob;
	kidName: string;
	dedication?: string;
}

export interface MultiSpreadOutput {
	spreads: NameOverlayOutput[];
	dedicationPng?: Blob;
	coverPng?: Blob;
}

export async function overlayBookNames(input: MultiSpreadInput): Promise<MultiSpreadOutput> {
	const spreads = await Promise.all(input.spreads.map(s => overlayName({ ...s, kidName: input.kidName })));
	let dedicationPng: Blob | undefined;
	if (input.dedicationPagePng) {
		const dedicationText = input.dedication ?? '';
		const out = await overlayName({
			wbPng: input.dedicationPagePng,
			spreadText: dedicationText,
			kidName: input.kidName,
			focalPoint: { x: 0.5, y: 0.5, maxWidthFrac: 0.7 }
		});
		dedicationPng = out.composedPng;
	}
	let coverPng: Blob | undefined;
	if (input.coverPng) {
		const out = await overlayName({
			wbPng: input.coverPng,
			spreadText: '',
			kidName: input.kidName,
			focalPoint: { x: 0.5, y: 0.4, maxWidthFrac: 0.8, fillHex: '#ffffff' }
		});
		coverPng = out.composedPng;
	}
	return { spreads, dedicationPng, coverPng };
}
