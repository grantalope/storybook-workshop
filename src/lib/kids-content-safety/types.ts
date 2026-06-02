// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/kids-content-safety/types.ts
//
// Goal: 2026-05-24 storybook-workshop kids-content-safety.
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §4.1, §4.2, §7.2.
//
// Canonical shape definitions for the KidsContentSafetyService PII-style gate
// that wraps every LLM call coming out of the Storybook Workshop. Categories
// follow §4.1 verbatim. The 7 categories were chosen pre-spec to align with
// known kid-content moderation taxonomies (Common Sense Media, Lexile) plus
// the two pachinko-specific extras (`fear_permanent` to catch "your parents
// will be gone forever" style hallucinations, `scary_unresolved` to catch
// open-ended threat scenes that don't get resolved within the book).

/**
 * Seven content-safety categories the gate enforces. Each category maps
 * 1:1 to an LLM-output filter rule. Multi-label: a single string can trip
 * more than one category (e.g. "the witch hit the boy" → violence + fear).
 */
export type SafetyCategory =
    | 'violence'
    | 'fear_permanent'
    | 'sexual_adult'
    | 'substance'
    | 'religious_political'
    | 'scary_unresolved'
    | 'bigotry';

export const ALL_SAFETY_CATEGORIES: readonly SafetyCategory[] = [
    'violence',
    'fear_permanent',
    'sexual_adult',
    'substance',
    'religious_political',
    'scary_unresolved',
    'bigotry',
] as const;

/** Backend identity, in probe-priority order. */
export type BackendName = 'webgpu' | 'wasm' | 'ollama' | 'stub';

/** Age band feeds the per-band threshold table — see KidsContentSafetyService. */
export type AgeBand = 'toddler' | 'preschool' | 'grade_school';

/**
 * Where the call originated. Used by the audit ring buffer to attribute
 * scans to the workshop sub-system that produced the text. Mirrors the
 * five enforcement gates in spec §4.2 plus `cover_badge` for the extras-
 * input free-text paths.
 */
export type SafetyScanSource =
    | 'story_author'
    | 'dedication'
    | 'voice_transcript'
    | 'scene_brief'
    | 'cover_badge';

/**
 * Single category-level finding from one backend pass over the input text.
 *
 * `confidence` is in [0,1]. The default policy treats `confidence < threshold`
 * as a pass; callers can raise the bar with `strict: true`.
 *
 * `span` is optional because the LLM-classifier backends (WASM/WebGPU/Ollama)
 * may produce a whole-text label without character spans. The stub regex
 * backend always emits spans because it works keyword-by-keyword.
 */
export interface ScanReport {
    category: SafetyCategory;
    confidence: number;
    span?: [start: number, end: number];
}

/** Caller-supplied options for a single `scan()` invocation. */
export interface ScanOpts {
    /** Age band hint. Stricter bands lower thresholds. Default `preschool`. */
    ageBand?: AgeBand;
    /** Which workshop sub-system emitted the text. Required for audit. */
    source: SafetyScanSource;
    /**
     * Force the stricter threshold (0.3 vs default 0.5). Caller is responsible
     * for choosing strict mode — typically used on user-typed dedication text
     * and the cover-badge custom string where parents can type anything.
     */
    strict?: boolean;
    /**
     * Force a specific backend (testing/debug only). Production callers
     * should leave this unset and let the service auto-probe.
     */
    forceBackend?: BackendName;
}

/**
 * The complete scan result returned to the caller. `passed === false` means
 * the caller MUST refuse the upstream artifact (story beat, dedication, etc.)
 * exactly the same way PrivacyFilter `hardFail === true` does in spec §4.2.
 */
export interface ScanResult {
    passed: boolean;
    reports: ScanReport[];
    scanLatencyMs: number;
    backend: BackendName;
}

/**
 * Backend contract — every backend (stub/WASM/WebGPU/Ollama) implements this.
 * `warmup()` returns true on success so the service can fall through to the
 * next probe candidate; isReady() is a sync gate the service consults before
 * the first scan to decide whether to lazy-warmup.
 */
export interface KidsContentSafetyBackend {
    name: BackendName;
    warmup(): Promise<boolean>;
    scan(text: string, opts: ScanOpts): Promise<ScanReport[]>;
    isReady(): boolean;
}

/**
 * Audit-ring entry. Stores a sha256-truncated hash of the input text — never
 * the raw string — per the spec's no-raw-text rule (mirrors PrivacyAuditService
 * which stores backend + category counts only).
 */
export interface SafetyAuditEntry {
    source: SafetyScanSource;
    result: ScanResult;
    textHash: string;
    ts: number;
}

/**
 * Confidence-threshold tier — `default` is the standard 0.5; `strict` is 0.3.
 * The threshold is applied UNIFORMLY across all 7 categories in v1; v2 may
 * introduce per-category tuning informed by audit-ring observation.
 */
export const SCAN_THRESHOLDS = {
    default: 0.5,
    strict: 0.3,
} as const;
