// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\types\PrivacyTypes.ts

/**
 * PrivacyTypes — shared types for the PrivacyFilterService PII gate.
 *
 * Categories split into HARD (block publish, never auto-fix) vs SOFT
 * (auto-redact + flag). Hard categories cause `FilterReport.hardFail = true`.
 *
 * Spec: docs/superpowers/specs/2026-04-26-recipe-native-feed-engagement-design.md §6
 */

export type PIICategory =
    | 'name'
    | 'address'
    | 'email'
    | 'phone'
    | 'url'
    | 'date'
    | 'account_number'
    | 'secret'
    // IRL Quest Engine Phase 2 (spec §6.1.1, §10.7 #3): explicit category for
    // pasted-as-text decimal lat/lng pairs. HARD by default — coords are as
    // sensitive as addresses.
    | 'coords';

export interface PIIDetection {
    category: PIICategory;
    /** Inclusive char offset where the detection begins. */
    start: number;
    /** Exclusive char offset where the detection ends. */
    end: number;
    /** Original substring — kept ONLY in local audit log; never published. */
    text: string;
    /** Detector confidence in [0, 1]. */
    confidence: number;
}

export interface FilterReport {
    detections: PIIDetection[];
    /** Text with `[REDACTED:category]` tokens substituted in place of detections. */
    redactedText: string;
    /** True iff any detection's category is in the hard set for this scrub call. */
    hardFail: boolean;
    /** Wall-clock inference time in ms (excludes warmup). */
    inferenceMs: number;
    /** Backend that produced the report. */
    backend: 'webgpu' | 'wasm' | 'ollama' | 'stub';
}

/**
 * Default hard categories — block publish on detection, never auto-fix.
 *
 * Defined as a tuple of literals so consumers can spread it without losing
 * the readonly array constraint.
 */
export const HARD_CATEGORIES: readonly PIICategory[] = [
    'name',
    'address',
    'email',
    'phone',
    'account_number',
    'secret',
    'coords',
] as const;

/**
 * Default soft categories — auto-redact + flag, but allow downstream emit.
 */
export const SOFT_CATEGORIES: readonly PIICategory[] = ['url', 'date'] as const;

export interface ScrubOptions {
    /** Override the hard-category set. Defaults to {@link HARD_CATEGORIES}. */
    hardCategories?: PIICategory[];
    /** Override the soft-category set. Defaults to {@link SOFT_CATEGORIES}. */
    softCategories?: PIICategory[];
    /** Force a specific backend; otherwise auto-probe. */
    forceBackend?: 'webgpu' | 'wasm' | 'ollama' | 'stub';
    /** Tag this scrub with a purpose so it shows up in PurposeAudit. */
    purpose?: Purpose;
    /** Agent context for audit. */
    agentId?: string;
    /**
     * Names explicitly allowed to pass the `name` detector un-redacted.
     *
     * Intended ONLY for scene-render scrubs carrying story-internal fictional
     * catalog names. Matching is exact (trimmed, case-sensitive, trailing
     * possessive `'s` stripped) and applies to the `name` category ONLY —
     * email, phone, address, account_number, secret, coords, url, date
     * detections are never affected. Non-scene-render purposes ignore this
     * option even if supplied.
     */
    allowNames?: string[];
}

import type { Purpose } from '$lib/kernel-contracts/purpose/PurposeTypes';
export type { Purpose } from '$lib/kernel-contracts/purpose/PurposeTypes';
