// @graph-layer: join
// @rationale: join (privacy/federation/guardrail subsystem — sits on the layer boundary)

// services/privacy/PrivacyGateError.ts
//
// I-PRIV-03-rev — distinguish PrivacyGateRejection vs PrivacyGateTransient.
//
// Pre-rev, AssetRecipeRegistryService.publishToChain threw a single
// `PrivacyGateError` for BOTH cases:
//
//   1. The privacy gate ran successfully and CONCLUDED the metadata contains
//      HARD PII → publish is correctly refused.
//   2. The privacy gate could NOT evaluate the metadata (backend crash, not
//      yet warmed, transient network glitch) → publish is correctly refused
//      *because we don't know*, but the cause is different — it's an
//      infrastructure problem, not a content rejection.
//
// Conflating those two makes operator triage and caller backoff impossible.
// This file exports two distinct error classes with a shared `kind`
// discriminator so callers can `instanceof`-narrow or switch on `err.kind`.
//
// Posture (unchanged): chain-publish paths are FAIL-CLOSED on both classes —
// irreversible writes never gamble on an inconclusive gate. The distinction is
// purely about WHY the publish was blocked, surfaced to logs / retry policy /
// non-chain caller paths that may legitimately want to skip-but-not-fail.

import type { PrivacyAuditSource } from './PrivacyAuditService';

/**
 * The privacy gate ran and CONCLUDED that the input contains HARD PII.
 * The caller's artifact was correctly refused on content grounds.
 *
 * Distinguish from `PrivacyGateTransient` to make retry / triage decisions —
 * retrying a rejection without changing the content is meaningless; retrying
 * a transient may succeed.
 */
export class PrivacyGateRejection extends Error {
    readonly kind = 'rejected' as const;
    constructor(
        public readonly source: PrivacyAuditSource,
        public readonly hardCategories: string[],
        public readonly redactedText: string,
        public readonly report?: unknown,
    ) {
        super(`Privacy gate rejected publish at ${source}: ${hardCategories.join(',')}`);
        this.name = 'PrivacyGateRejection';
    }
}

/**
 * The privacy gate FAILED to evaluate (backend crash, not yet warmed,
 * transient fault). Chain-publish paths still fail-closed — we don't know
 * if there's PII, conservative posture wins for irreversible writes — but
 * non-chain callers (test fixtures, retry policies) may want to skip rather
 * than block.
 *
 * Inspect `cause` for the underlying failure. The thrown error is still a
 * regular `Error` for stack-trace + logging convenience.
 */
export class PrivacyGateTransient extends Error {
    readonly kind = 'transient' as const;
    constructor(
        public readonly source: PrivacyAuditSource,
        public override readonly cause: unknown,
    ) {
        const causeMsg = cause instanceof Error ? cause.message : String(cause);
        super(`Privacy gate transient at ${source}: ${causeMsg}`);
        this.name = 'PrivacyGateTransient';
    }
}

/** Discriminated union of the two privacy-gate errors. */
export type PrivacyGateError = PrivacyGateRejection | PrivacyGateTransient;

/** Type guard — narrows `err` to PrivacyGateRejection. */
export function isPrivacyGateRejection(err: unknown): err is PrivacyGateRejection {
    return err instanceof PrivacyGateRejection;
}

/** Type guard — narrows `err` to PrivacyGateTransient. */
export function isPrivacyGateTransient(err: unknown): err is PrivacyGateTransient {
    return err instanceof PrivacyGateTransient;
}

/** Type guard — true for either gate error class. */
export function isPrivacyGateError(err: unknown): err is PrivacyGateError {
    return isPrivacyGateRejection(err) || isPrivacyGateTransient(err);
}
