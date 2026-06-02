// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/kids-content-safety/KidsContentSafetyAudit.ts
//
// Local-only ring buffer (1000 entries) of every kids-content-safety scan.
// Mirrors PrivacyAuditService: hashes the input text rather than storing
// raw — operators see "what category tripped, from which source, at what
// timestamp" without the audit log itself becoming a PII surface.
//
// Capacity choice (1000 entries) — recorded for implementation-notes.md:
//   - Story author runs ~24 LLM calls per book (one per spread). A parent
//     who builds 5 books in a session ≈ 120 scan entries. 1000 gives ≥8
//     books of headroom which is enough for any debugging session.
//   - 1000 entries × ~120 bytes/entry ≈ 120 KB — fits in memory cheaply,
//     no IDB needed.
//   - Larger than the PrivacyAuditService's 1000 by intent: kids-safety
//     hits 5 gates per book vs PrivacyFilter's 1 dominant gate.

import type {
    SafetyAuditEntry,
    SafetyCategory,
    SafetyScanSource,
    ScanResult,
} from './types';
import { ALL_SAFETY_CATEGORIES } from './types';

const RING_CAPACITY = 1000;

/**
 * Fast non-cryptographic hash (FNV-1a 32-bit) for audit-log identity.
 * NOT a security primitive — we just need a stable opaque token that
 * doesn't disclose the original text. Cryptographic strength would
 * cost startup-time + bundle bytes for no benefit (the audit is local-
 * only, never crosses any network boundary).
 */
function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        // 32-bit FNV prime multiplication, kept in unsigned-32 space.
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export class KidsContentSafetyAudit {
    private buffer: SafetyAuditEntry[] = [];
    private head = 0;
    private size = 0;
    private readonly capacity: number;

    constructor(capacity = RING_CAPACITY) {
        this.capacity = capacity;
    }

    /**
     * Record a scan. Stores a hash of the raw text — the raw string is
     * NEVER persisted to the buffer.
     *
     * The audit input takes `text` (not pre-hashed) so callers can't
     * accidentally store the raw text by passing it as `textHash`.
     */
    record(input: {
        source: SafetyScanSource;
        result: ScanResult;
        text: string;
        ts: number;
    }): void {
        const entry: SafetyAuditEntry = {
            source: input.source,
            result: input.result,
            textHash: fnv1a(input.text),
            ts: input.ts,
        };
        if (this.size < this.capacity) {
            this.buffer.push(entry);
            this.size++;
        } else {
            this.buffer[this.head] = entry;
            this.head = (this.head + 1) % this.capacity;
        }
    }

    /**
     * Return the N most recent entries (newest first). When `n` exceeds
     * the buffer size, returns everything.
     */
    recent(n: number): SafetyAuditEntry[] {
        if (n <= 0 || this.size === 0) return [];
        const limit = Math.min(n, this.size);
        const out: SafetyAuditEntry[] = [];
        // Walk the ring from newest to oldest.
        for (let i = 0; i < limit; i++) {
            let idx: number;
            if (this.size < this.capacity) {
                idx = this.size - 1 - i;
            } else {
                idx = (this.head - 1 - i + this.capacity) % this.capacity;
            }
            out.push(this.buffer[idx]);
        }
        return out;
    }

    /**
     * Per-category fail counts across the buffer — drives the /debug
     * page's category-heatmap. Counts each failed category-report once
     * per entry, so a single text tripping violence + fear contributes
     * 1 each, not 2 to a generic "fails" bucket.
     */
    categoryFailCounts(): Record<SafetyCategory, number> {
        const counts = {} as Record<SafetyCategory, number>;
        for (const c of ALL_SAFETY_CATEGORIES) counts[c] = 0;
        for (let i = 0; i < this.size; i++) {
            const e = this.buffer[i];
            if (!e || e.result.passed) continue;
            const seen = new Set<SafetyCategory>();
            for (const r of e.result.reports) {
                // Only count a category if its confidence ≥ default
                // threshold (matches what `passed` was computed on).
                if (r.confidence < 0.5) continue;
                if (!seen.has(r.category)) {
                    counts[r.category]++;
                    seen.add(r.category);
                }
            }
        }
        return counts;
    }

    /**
     * Snapshot total entries + pass/fail tally. Used by the debug page
     * header.
     */
    summary(): { total: number; passed: number; failed: number } {
        let passed = 0;
        let failed = 0;
        for (let i = 0; i < this.size; i++) {
            if (this.buffer[i].result.passed) passed++;
            else failed++;
        }
        return { total: this.size, passed, failed };
    }

    clear(): void {
        this.buffer = [];
        this.head = 0;
        this.size = 0;
    }

    // ── Test introspection ──

    /** Current buffer capacity (immutable post-construction). */
    getCapacity(): number {
        return this.capacity;
    }

    /** Current entry count (≤ capacity). */
    getSize(): number {
        return this.size;
    }
}

// Singleton — consumed by the service's `scan()` method and read by the
// /dashboard/debug/kids-content-safety page.
export const kidsContentSafetyAudit = new KidsContentSafetyAudit();
