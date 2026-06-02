// @graph-layer: join
// @rationale: join (privacy/federation/guardrail subsystem — sits on the layer boundary)

// services/privacy/types.ts
//
// Goal B — PrivacyFilterService as canonical join chokepoint.
// Spec: docs/superpowers/goals/2026-05-22-ag-goal-b-privacy-join-chokepoint.md
// Parent ADR: docs/adr/0043-two-layer-active-graph-architecture.md §"Privacy invariants"

import type { PIICategory } from '../../types/PrivacyTypes';
import type { PrivacyAuditSource } from './PrivacyAuditService';

/**
 * The single enum of allowed reasons a private → universal write can fire.
 * Aliased to `PrivacyAuditSource` so the existing audit log + new cross-layer
 * ledger speak the same vocabulary — `recipe_publish`, `tip_publish`,
 * `claw_ingest`, `free_text`, `voice_answer`, `confession_submit`,
 * `agent_prompt`, etc.
 */
export type PrivacyAuditPurpose = PrivacyAuditSource;

/**
 * Sanitized redaction record kept inside a {@link CrossLayerWriteAudit}.
 *
 * **NEVER carries the original substring.** The on-disk audit ring is the
 * one surface the user inspects via `/debug/privacy`; even though the data
 * stays local-only, exposing the raw matched span there would re-leak the
 * thing the gate is supposed to redact.
 */
export interface PrivacyRedaction {
    category: PIICategory;
    /** Inclusive char offset where the detection began in the original text. */
    start: number;
    /** Exclusive char offset where the detection ended. */
    end: number;
    /** Detector confidence in [0, 1]. */
    confidence: number;
}

/**
 * Where a cross-layer write was sent. Used by the audit to attribute the
 * publish artifact back to its destination at incident-response time.
 */
export type CrossLayerWriteDestination =
    | 'chain'
    | 'p2p'
    | 'federated-aggregator'
    | 'cross-world';

/**
 * The artifact that pins every private → universal write to a single audit
 * trail. Stored in the per-user IDB ring (cap 5000, most-recent 500 never
 * expire) and surfaced at `/debug/privacy` so the user can answer
 * "what did I publish and when?"
 *
 * `auditId` is the UUIDv4 that downstream publish artifacts (recipe payloads,
 * NFT metadata, P2P SkillNotes) embed so the cross-layer write is linkable
 * back to a concrete "I published X" event in the private graph.
 */
export interface CrossLayerWriteAudit {
    /** UUIDv4 — unique per cross-layer write attempt (allowed OR rejected). */
    auditId: string;
    /** Why the write was attempted; aliased to {@link PrivacyAuditSource}. */
    purpose: PrivacyAuditPurpose;
    /** Event-time ms when `publishToUniversal` was invoked. */
    submittedAt: number;
    /** Event-time ms when the gate finished allowing the write; `null` if rejected. */
    committedAt: number | null;
    /** `true` iff the gate allowed the write to proceed. */
    allowed: boolean;
    /** Per-detection sanitized records (span + category + confidence; no text). */
    redactions: PrivacyRedaction[];
    /** SHA-256 of the original payload pre-scrub. Hex-encoded. */
    payloadHash: string;
    /** Where the artifact was published. */
    publishedTo: CrossLayerWriteDestination;
    /** Caller identity for kernel-cap attribution. */
    callerName: string;
}

/**
 * Public arguments for {@link PrivacyFilterService.publishToUniversal}.
 *
 * `payload` is the structured artifact about to publish (recipe object,
 * SkillNote, NFT metadata, etc.) — it is hashed for the audit but otherwise
 * opaque. `text` is the concatenated free-text inside the payload that the
 * gate scrubs.
 */
export interface PublishToUniversalOptions {
    payload: unknown;
    text: string;
    purpose: PrivacyAuditPurpose;
    publishedTo: CrossLayerWriteDestination;
    callerName: string;
}

/**
 * Public return shape of {@link PrivacyFilterService.publishToUniversal}.
 *
 * `scrubbed` is `null` iff the gate rejected (HARD detections present).
 * On allow, it is the SOFT-redacted text the caller should embed instead
 * of the original.
 */
export interface PublishToUniversalResult {
    audit: CrossLayerWriteAudit;
    scrubbed: string | null;
}
