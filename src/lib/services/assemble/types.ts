// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// Storybook Workshop — BookAssembler types
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §3.9
//
// PRIVACY KEYSTONE: BookAssetBundle.kidName + dedication + voiceOver are the
// ONLY plaintext PII shapes in this module. Every consumer outside the
// assemble/ folder must treat these fields as `book_fulfillment`-purpose data
// (kernel purpose.check allowlist) and never persist them past assembly.

/** Format SKUs the v1 product ships. Lulu Direct catalogue. */
export type BookFormat = 'hardcover-8x8' | 'softcover-8x8' | 'saddlestitch-8x8';

/** Per-format dimensions in inches. Source: Lulu spec sheets. */
export interface FormatDimensions {
	trimWidthIn: number;
	trimHeightIn: number;
	bleedIn: number;
	pageThicknessMm: number;
	minPages: number;
	maxPages: number;
	pageCountMultiple: number;
}

export const FORMAT_DIMENSIONS: Record<BookFormat, FormatDimensions> = {
	'hardcover-8x8': {
		trimWidthIn: 8,
		trimHeightIn: 8,
		bleedIn: 0.125,
		pageThicknessMm: 0.13,
		minPages: 24,
		maxPages: 800,
		pageCountMultiple: 2
	},
	'softcover-8x8': {
		trimWidthIn: 8,
		trimHeightIn: 8,
		bleedIn: 0.125,
		pageThicknessMm: 0.1,
		minPages: 32,
		maxPages: 740,
		pageCountMultiple: 2
	},
	'saddlestitch-8x8': {
		trimWidthIn: 8,
		trimHeightIn: 8,
		bleedIn: 0.125,
		pageThicknessMm: 0.1,
		minPages: 4,
		maxPages: 48,
		pageCountMultiple: 4
	}
};

/** Animation manifest per-spread, produced upstream by goal #4 (pretext-book-adapter). */
export interface AnimationManifest {
	beat: 'setup' | 'catalyst' | 'debate' | 'midpoint' | 'trial' | 'climax' | 'resolution';
	effect: 'wave' | 'gravity' | 'bounce-in' | 'rise' | 'scatter' | 'orbit' | 'magnetic' | 'glitch' | 'vortex' | 'parting-water' | 'dragon' | 'flow';
	durationMs: number;
	staticFrameIndex: number;
}

/** Sidekick settler info — `pillarId`-style opaque IDs already public roster. */
export interface SidekickSettlerInfo {
	settlerId: string;
	displayName: string;
	glyph?: string;
}

/** Cover badge per spec §2 Station 5 — "Birthday Edition" etc. */
export interface CoverBadge {
	label: string;
	accentHex?: string;
}

/** Endpaper pattern selector — string identifier resolved by CoverComposer. */
export type EndpaperPattern =
	| 'plain'
	| 'forest-silhouette'
	| 'star-map'
	| 'wave-stripes'
	| 'paw-prints'
	| 'kid-doodle'
	| string;

/** All assets BookAssembler.assemble() needs. */
export interface BookAssetBundle {
	/** sceneId → ordered list of WB-rendered PNG Blobs (1..N spreads per scene). */
	wbPngsByScene: Map<string, Blob[]>;
	/** spreadIndex (0..N-1) → static frame PNG captured by pretext-book-adapter. */
	pretextStaticFrames: Map<number, Blob>;
	/** spreadIndex → animation manifest used in read-along bundle. */
	animationManifests: Map<number, AnimationManifest>;
	/** Optional dedication audio (≤30s, recorded by parent). */
	dedicationAudio?: Blob;
	/** Optional voice-over recording for read-along bundle media-overlay. */
	voiceOver?: Blob;
	/** Kid's first name (or chosen hero name). PRIVACY KEYSTONE. */
	kidName: string;
	/** Free-text dedication. PRIVACY KEYSTONE. */
	dedication: string;
	sidekickSettlerInfo: SidekickSettlerInfo;
	title: string;
	backCoverBlurb: string;
	format: BookFormat;
	/** Total interior page count (excludes cover + endpapers). Validates against FORMAT_DIMENSIONS. */
	pages: number;
	coverBadge?: CoverBadge;
	endpaper?: EndpaperPattern;
	/** Optional author byline ("By Eli, age 5"). */
	authorByline?: string;
	/** Optional style pack selected at Station 5; public-safe registry id. */
	stylePackId?: string;
	/** Optional ordered scene IDs — sets canonical spread order. If absent, Map insertion order. */
	sceneOrder?: string[];
}

/** Audit record persisted alongside the assembled book. */
export interface AssemblyAudit {
	pdfHash: string;
	pageCount: number;
	ts: number;
	fontEmbedSummary: string[];
	bleedValidated: boolean;
	cmykValidated: boolean;
	shortcode: string;
	spineWidthIn: number;
}

/** BookAssembler.assemble() output. */
export interface AssembledBook {
	pdfBlob: Blob;
	epubBlob: Blob;
	readAlongBundleUrl?: string;
	shortcode: string;
	audit: AssemblyAudit;
}

/** Validator error — parent-readable. */
export interface ValidationError {
	code:
		| 'page-count-below-min'
		| 'page-count-above-max'
		| 'page-count-not-multiple'
		| 'missing-bleed-marks'
		| 'non-cmyk-color-space'
		| 'fonts-not-embedded'
		| 'spine-width-mismatch'
		| 'trim-size-mismatch'
		| 'pdf-empty'
		| 'pdf-corrupt';
	message: string;
	hint?: string;
}

export interface ValidationReport {
	valid: boolean;
	errors: ValidationError[];
}

/** ReadAlongBundleBuilder output — written to CDN / temp storage. */
export interface ReadAlongBundle {
	shortcode: string;
	manifest: {
		title: string;
		spreadCount: number;
		hasVoiceOver: boolean;
		hasDedicationAudio: boolean;
		stylePackId?: string;
	};
	spreads: Array<{
		index: number;
		framePng: Blob;
		animation: AnimationManifest;
		text: string;
	}>;
	voiceOver?: Blob;
	dedicationAudio?: Blob;
}
