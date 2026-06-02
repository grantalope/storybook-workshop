// @graph-layer: join
// @rationale: join (privacy audit ring buffer — records every cross-layer write at the chokepoint)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\PrivacyAuditService.ts

/**
 * PrivacyAuditService — local-only ring buffer of {@link FilterReport}s.
 *
 * Surfaces every PrivacyFilter scrub call across the app for the debug
 * dashboard at `/dashboard/debug/privacy`. NEVER persisted
 * off-device and NEVER published. The buffer is bounded so a runaway logger
 * cannot grow unbounded.
 *
 * Spec: docs/superpowers/specs/2026-04-26-recipe-native-feed-engagement-design.md §6.5
 */

import type { FilterReport, PIICategory } from '$lib/privacy/PrivacyTypes';
import type { CrossLayerWriteAudit, CrossLayerWriteDestination, PrivacyAuditPurpose } from './types';

export type PrivacyAuditSource =
    | 'tip_publish'
    | 'tip_consume'
    | 'recipe_publish'
    | 'claw_ingest'
    | 'free_text'
    | 'voice_answer'
    | 'confession_submit'
    | 'agent_prompt'
    | 'world_item_mint'
    | 'cross_world_hop'
    | 'kitchen_pantry_write'
    | 'kitchen_food_log_write'
    | 'kitchen_body_metric_write'
    | 'kitchen_macro_target_write'
    | 'kitchen_goal_write'
    | 'kitchen_activity_log_write'
    | 'knowledge_publish'
    | 'geo_checkin'
    | 'lexicon_hint'
    // B-P2P-01 / B-P2P-03 (2026-05-11) — IPFS upload gate. Voice transcripts
    // (FeedOrchestrator) and ASCII-video bakes (AsciiVideoPublisher) must scrub
    // user-supplied text before any ipfsService.upload() call. The IPFS layer
    // is content-addressed and DHT-replicating; once a CID is published it is
    // unrevocable, so this gate refuses publish on `hardFail` HARD-PII detection.
    | 'ipfs_upload'
    // 2026-05-11 — quest verb expansion (audio / NFC / calendar / peer-rendezvous).
    // Each new action-triggered claw scrubs at ingest and records under its own
    // source so /debug/privacy can attribute the new gates.
    | 'audio_capture'
    | 'nfc_tap'
    | 'calendar_event'
    | 'peer_rendezvous'
    // 2026-05-12 — Settler Inner Life subsystem. Every diary / dream /
    // hobby-note / daydream / philosophy / festival output passes
    // PrivacyFilterService.scrub() before storage. Defense in depth even
    // though notes are user-local. Audit source per the spec at
    // docs/superpowers/specs/2026-05-12-settler-inner-life-design.md.
    | 'inner_life_write'
    // 2026-05-13 — Inspector "show private prior" toggle. Each toggle-on
    // emits an audit entry so /debug/privacy can attribute every reveal of
    // raw θ + σ back to the UI gesture. The report payload carries no PII
    // (synthetic stub) — the audit value is the timestamped event, not the
    // payload. Owned by `components/PriorBreakdown.svelte`. Additive-only
    // union expansion under /goal inspector-drawer-full-profile.
    | 'inspector_unmask'
    // 2026-05-14 — Ambient Intents sub-project B. Personal-data connectors
    // (Spotify / Google Calendar / Readwise) scrub every fetched signal at
    // the claw trust boundary, and the NoticingLayer audits the ingest hop.
    | 'spotify_fetch'
    | 'calendar_fetch'
    | 'readwise_fetch'
    | 'ambient_capture'
    // 2026-05-14 — Ambient Intents sub-project C. Every trust-path proof
    // prove/verify hop is audited so /debug/privacy attributes the
    // boundary-crossing TrustPathProof artifact.
    | 'trust_proof'
    // 2026-05-15 — Asset Recipe Registry publish gate. Every recipe authored
    // through `AssetRecipeRegistryService.publish()` scrubs author-supplied
    // free-text before the recipe lands in the on-chain commons.
    | 'asset_recipe_publish'
    // 2026-05-15 — On-chain Kilobeat Rollup publish gate. Every per-kilobeat
    // Merkle batch (agent prior + balance deltas) is audited under this
    // source before performEffect commits to KilobeatRollupRegistry.cdc.
    // Numeric payloads only — no free text expected; audit is defense-in-
    // depth + operator-visible attribution at /debug/privacy.
    | 'kilobeat_rollup'
    // 2026-05-17 — Lodden TopicPillars on-chain publish gate. Every pillar
    // label / description / alias passes PrivacyFilterService at the
    // FlowTopicPillarPublisher boundary before any flowFclService.mutate
    // touches the chain. HARD-category hits block the publish; SOFT hits
    // are auto-redacted. Distinct from knowledge_publish so /debug/privacy
    // can attribute pillar leakage independently.
    | 'pillar_publish'
    | 'other';

export interface PrivacyAuditEntry {
    source: PrivacyAuditSource;
    timestamp: number;
    report: FilterReport;
    /** Optional provenance tag explaining why this scrub used non-default settings (e.g. 'public-feed'). */
    provenance?: string;
}

export interface PrivacyAuditStats {
    totalScrubs: number;
    hardFails: number;
    bySource: Record<PrivacyAuditSource, number>;
    byCategory: Record<PIICategory, number>;
    avgInferenceMs: number;
}

/**
 * Round-15 — operator-facing aggregated view over the audit ring buffer.
 *
 * Pure read-only snapshot. The hot scrub path is unchanged; this shape is
 * computed on demand by `getStats()` and consumed by the `/debug/privacy`
 * page + the `/debug/health` Privacy card builder. No persistence, no
 * mutation, no behavior change.
 *
 * Field semantics:
 *  - `total`         — entries currently in the ring buffer (≤ capacity)
 *  - `bySource`      — full per-source map, every known source pre-zeroed
 *  - `hardHitsLast24h` — count of `report.hardFail` entries in the trailing 24h
 *  - `softHitsLast24h` — count of non-hard entries with ≥1 detection in 24h
 *  - `cleanLast24h`  — entries with zero detections in 24h
 *  - `scrubsPerHourTrend` — 24-element array, hour buckets, oldest first.
 *      Index 0 = 23–24h ago; index 23 = the trailing hour ending at `now`.
 *      Buckets the entry's `timestamp` into `floor((now - ts) / 1h)`.
 *  - `oldestEntryTs` / `newestEntryTs` — wall-clock bookends for staleness
 *      detection. `null` when the buffer is empty.
 */
export interface PrivacyAuditAggregateStats {
    total: number;
    bySource: Record<PrivacyAuditSource, number>;
    hardHitsLast24h: number;
    softHitsLast24h: number;
    cleanLast24h: number;
    scrubsPerHourTrend: number[];
    oldestEntryTs: number | null;
    newestEntryTs: number | null;
}

/**
 * Round-30 — per-source latency aggregation.
 *
 * Pure read-side projection over the existing buffer's `report.inferenceMs`.
 * Sources with zero entries return all zeros so consumers never have to
 * null-check. Mirrors the round-22/25/28 percentile contract:
 *   p50 = sorted[floor(n * 0.50)]
 *   p95 = sorted[floor(n * 0.95)]
 *   p99 = sorted[floor(n * 0.99)]
 */
export interface PrivacyLatencyStats {
    count: number;
    p50: number;
    p95: number;
    p99: number;
}

export type PrivacyLatencyBySource = Record<PrivacyAuditSource, PrivacyLatencyStats>;

const ALL_SOURCES: PrivacyAuditSource[] = [
    'tip_publish',
    'tip_consume',
    'recipe_publish',
    'claw_ingest',
    'free_text',
    'voice_answer',
    'confession_submit',
    'agent_prompt',
    'world_item_mint',
    'cross_world_hop',
    'kitchen_pantry_write',
    'kitchen_food_log_write',
    'kitchen_body_metric_write',
    'kitchen_macro_target_write',
    'kitchen_goal_write',
    'kitchen_activity_log_write',
    'knowledge_publish',
    'geo_checkin',
    'lexicon_hint',
    'ipfs_upload',
    'audio_capture',
    'nfc_tap',
    'calendar_event',
    'peer_rendezvous',
    'inner_life_write',
    'inspector_unmask',
    'spotify_fetch',
    'calendar_fetch',
    'readwise_fetch',
    'ambient_capture',
    'trust_proof',
    'asset_recipe_publish',
    'kilobeat_rollup',
    'pillar_publish',
    'other',
];

const ALL_CATEGORIES: PIICategory[] = [
    'name', 'address', 'email', 'phone', 'url', 'date', 'account_number', 'secret',
    'coords',
];

// ── Goal B (2026-05-22) — cross-layer write audit ring ─────────────────────
//
// Separate ring buffer that records every `PrivacyFilterService.publishToUniversal`
// invocation — both ALLOWED and REJECTED. Sits alongside the FilterReport ring
// so the operator console can show "what did this user publish to the commons
// and when?" without conflating with per-scrub PII detection volume.
//
// Capacity: 5000 entries; the most-recent 500 NEVER expire (per goal spec
// §"Audit log persistence"). Lifetime + trim counters mirror the FilterReport
// ring for parity at /debug/privacy.
//
// IDB persistence is deferred; v1 is in-memory. See implementation-notes.md
// "Tradeoffs" for the rationale.

const CROSS_LAYER_DEFAULT_CAPACITY = 5000;
const CROSS_LAYER_PROTECTED_TAIL = 500;

const ALL_DESTINATIONS: CrossLayerWriteDestination[] = [
    'chain',
    'p2p',
    'federated-aggregator',
    'cross-world',
];

export interface CrossLayerWriteStats {
    total: number;
    allowed: number;
    rejected: number;
    byPurpose: Record<PrivacyAuditPurpose, number>;
    byDestination: Record<CrossLayerWriteDestination, number>;
    oldestEntryTs: number | null;
    newestEntryTs: number | null;
}

export class PrivacyAuditService {
    private buffer: PrivacyAuditEntry[] = [];
    private capacity: number;

    // Cross-layer write audit ring (Goal B).
    private crossLayerBuffer: CrossLayerWriteAudit[] = [];
    private crossLayerCapacity: number = CROSS_LAYER_DEFAULT_CAPACITY;
    private _crossLayerRecordCount = 0;
    private _crossLayerTrimCount = 0;

    /**
     * Round-32 — buffer-pressure counters.
     *
     * The audit ring is bounded (default 1000), and the oldest entries fall
     * off the back when capacity is exceeded. Operators can't see this from
     * `total` alone (which always reports buffer length, not lifetime
     * appends), so silent data loss looks like a quiet system. These two
     * counters expose the truth:
     *
     *   _recordCount   — total entries ever appended (lifetime, not buffer length)
     *   _trimCount     — total entries evicted via the splice() in `record()`
     *
     * `_trimCount > 0` is the operator's signal to bump capacity. The ratio
     * `_trimCount / _recordCount` answers "what fraction of audit traffic am
     * I losing?" Both are reset by `clearAll()` so they share the lifecycle
     * of the audit log itself (clearing the log → reset metrics).
     */
    private _recordCount = 0;
    private _trimCount = 0;

    constructor(capacity = 1000) {
        this.capacity = Math.max(1, capacity);
    }

    /**
     * Append a filter report. When the buffer hits {@link capacity}, the oldest
     * entry is dropped.
     */
    record(input: { source: PrivacyAuditSource; report: FilterReport; provenance?: string }): void {
        this.buffer.push({
            source: input.source,
            timestamp: Date.now(),
            report: input.report,
            provenance: input.provenance,
        });
        this._recordCount++;
        if (this.buffer.length > this.capacity) {
            const trimmed = this.buffer.length - this.capacity;
            this.buffer.splice(0, trimmed);
            this._trimCount += trimmed;
        }
    }

    /**
     * Most recent entries (newest last). When `n` exceeds buffer length, the
     * full buffer is returned.
     */
    recent(n: number): PrivacyAuditEntry[] {
        if (n <= 0) return [];
        if (n >= this.buffer.length) return [...this.buffer];
        return this.buffer.slice(this.buffer.length - n);
    }

    /** All entries currently in the buffer. */
    all(): PrivacyAuditEntry[] {
        return [...this.buffer];
    }

    /** Aggregate counters across the current buffer. */
    stats(): PrivacyAuditStats {
        const bySource = Object.fromEntries(ALL_SOURCES.map((s) => [s, 0])) as Record<PrivacyAuditSource, number>;
        const byCategory = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])) as Record<PIICategory, number>;
        let hardFails = 0;
        let totalInferenceMs = 0;

        for (const entry of this.buffer) {
            bySource[entry.source]++;
            if (entry.report.hardFail) hardFails++;
            totalInferenceMs += entry.report.inferenceMs;
            for (const d of entry.report.detections) {
                byCategory[d.category]++;
            }
        }

        return {
            totalScrubs: this.buffer.length,
            hardFails,
            bySource,
            byCategory,
            avgInferenceMs: this.buffer.length === 0
                ? 0
                : totalInferenceMs / this.buffer.length,
        };
    }

    /** Wipe the buffer. Round-32: also resets buffer-pressure counters. */
    clear(): void {
        this.buffer = [];
        this._recordCount = 0;
        this._trimCount = 0;
    }

    /**
     * Round-15 alias for {@link clear}. Wraps the underlying mutation in a
     * try/catch so the operator-facing "Clear audit log" button cannot
     * throw out of an exotic buffer state. No-op if `clear()` cannot run.
     */
    clearAll(): void {
        try {
            this.clear();
        } catch {
            // Last-resort: directly reset. Guards against a wedged Array.
            try { this.buffer = []; } catch { /* swallow — observability only */ }
        }
    }

    /** Capacity of the ring buffer. */
    getCapacity(): number {
        return this.capacity;
    }

    /**
     * Round-32 — total entries ever appended via {@link record}, including
     * any that were later evicted by buffer-capacity overflow. Strictly >=
     * the current buffer length.
     *
     * Reset by {@link clear} / {@link clearAll}.
     */
    getRecordCount(): number {
        return this._recordCount;
    }

    /**
     * Round-32 — total entries evicted by buffer-capacity overflow over the
     * lifetime of this service instance. `0` means the ring has never been
     * pressured; positive values mean the operator is silently losing audit
     * data and should consider raising the capacity.
     *
     * Reset by {@link clear} / {@link clearAll}.
     */
    getTrimCount(): number {
        return this._trimCount;
    }

    /**
     * Round-32 — fraction of lifetime appends that were evicted, in [0, 1].
     * Returns `0` when the buffer has never been written to.
     */
    getTrimRate(): number {
        if (this._recordCount === 0) return 0;
        return this._trimCount / this._recordCount;
    }

    // ── Round-15 read-only aggregators ───────────────────────────────────
    //
    // All three are pure projections over the existing buffer. The hot
    // record path is untouched — these are called only by the operator
    // surfaces (/debug/privacy + /debug/health Privacy card).

    /**
     * Aggregated stats for the operator console. Pure snapshot — never
     * mutates the buffer. `now` is injectable for deterministic tests.
     *
     * 24h windows are inclusive of `now - 24h` (i.e. `ts >= now - 24h`).
     * `scrubsPerHourTrend` always has length 24 — older entries fall off
     * the left edge. Index 23 (last cell) is the trailing hour ending at
     * `now`; index 0 is the hour 23–24h before `now`.
     */
    getStats(now: number = Date.now()): PrivacyAuditAggregateStats {
        const bySource = Object.fromEntries(ALL_SOURCES.map((s) => [s, 0])) as Record<
            PrivacyAuditSource,
            number
        >;
        const scrubsPerHourTrend = new Array<number>(24).fill(0);
        const cutoff24h = now - 24 * 60 * 60 * 1000;

        let hardHitsLast24h = 0;
        let softHitsLast24h = 0;
        let cleanLast24h = 0;
        let oldestEntryTs: number | null = null;
        let newestEntryTs: number | null = null;

        for (const entry of this.buffer) {
            // Per-source — count the FULL buffer (not just 24h). Operators
            // want to know "what did this user do this session?" which can
            // span >24h on a long-lived tab.
            bySource[entry.source]++;

            // Track bookends across the entire buffer.
            if (oldestEntryTs === null || entry.timestamp < oldestEntryTs) {
                oldestEntryTs = entry.timestamp;
            }
            if (newestEntryTs === null || entry.timestamp > newestEntryTs) {
                newestEntryTs = entry.timestamp;
            }

            // 24h window — counts + per-hour trend bucket.
            if (entry.timestamp >= cutoff24h) {
                if (entry.report.hardFail) {
                    hardHitsLast24h++;
                } else if (entry.report.detections.length > 0) {
                    softHitsLast24h++;
                } else {
                    cleanLast24h++;
                }

                // Hour bucket: ageHours 0 = current hour, 23 = oldest hour.
                // Map age 0..23 → bucket index 23..0 so index 23 is "now".
                const ageMs = now - entry.timestamp;
                const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
                if (ageHours >= 0 && ageHours < 24) {
                    scrubsPerHourTrend[23 - ageHours]++;
                }
            }
        }

        return {
            total: this.buffer.length,
            bySource,
            hardHitsLast24h,
            softHitsLast24h,
            cleanLast24h,
            scrubsPerHourTrend,
            oldestEntryTs,
            newestEntryTs,
        };
    }

    /**
     * Most-recent entries optionally filtered by source. Newest last (matches
     * {@link recent}). Operators use this to drill into "what did the
     * `recipe_publish` gate scrub today?" without leaving the page.
     */
    getRecentEntries(limit: number, sourceFilter?: PrivacyAuditSource): PrivacyAuditEntry[] {
        if (limit <= 0) return [];
        if (!sourceFilter) {
            return this.recent(limit);
        }
        const out: PrivacyAuditEntry[] = [];
        // Walk newest-first so we can stop as soon as we have `limit`, then
        // reverse for the public "newest last" contract.
        for (let i = this.buffer.length - 1; i >= 0 && out.length < limit; i--) {
            const e = this.buffer[i];
            if (e.source === sourceFilter) out.push(e);
        }
        return out.reverse();
    }

    /**
     * Most-recent HARD-category rejections. Newest last. The "did anything
     * actually block today?" answer for the operator.
     */
    getRecentHardHits(limit: number): PrivacyAuditEntry[] {
        if (limit <= 0) return [];
        const out: PrivacyAuditEntry[] = [];
        for (let i = this.buffer.length - 1; i >= 0 && out.length < limit; i--) {
            const e = this.buffer[i];
            if (e.report.hardFail) out.push(e);
        }
        return out.reverse();
    }

    /**
     * Round-30 — per-source latency stats over the current buffer.
     *
     * Walks the buffer once, groups `report.inferenceMs` by source, computes
     * count + p50/p95/p99 via `sorted[Math.floor(n * pct)]`. Every entry in
     * `ALL_SOURCES` is pre-filled with zeros so consumers can index without
     * null-checks.
     *
     * Pure projection — no buffer mutation, no caching, safe to call from any
     * surface. Operator surfaces (`/debug/privacy`, `/debug/health` Privacy
     * card) read this on every render.
     */
    getLatencyStatsBySource(): PrivacyLatencyBySource {
        const out = Object.fromEntries(
            ALL_SOURCES.map((s) => [s, { count: 0, p50: 0, p95: 0, p99: 0 }]),
        ) as PrivacyLatencyBySource;

        const bySource = new Map<PrivacyAuditSource, number[]>();
        for (const entry of this.buffer) {
            const ms = Number(entry.report.inferenceMs);
            if (!Number.isFinite(ms)) continue;
            let arr = bySource.get(entry.source);
            if (!arr) {
                arr = [];
                bySource.set(entry.source, arr);
            }
            arr.push(ms);
        }

        for (const [src, list] of bySource) {
            const n = list.length;
            if (n === 0) continue;
            const sorted = list.slice().sort((a, b) => a - b);
            out[src] = {
                count: n,
                p50: sorted[Math.floor(n * 0.50)] ?? sorted[n - 1],
                p95: sorted[Math.floor(n * 0.95)] ?? sorted[n - 1],
                p99: sorted[Math.floor(n * 0.99)] ?? sorted[n - 1],
            };
        }

        return out;
    }

    // ── Goal B — cross-layer write audit ring ───────────────────────────

    /**
     * Append a cross-layer write audit record. Each entry is a full
     * {@link CrossLayerWriteAudit} — the chokepoint API
     * `PrivacyFilterService.publishToUniversal` is the only intended caller.
     *
     * Trim policy: drop entries from the FRONT of the ring (oldest first),
     * but never reduce below the most-recent {@link CROSS_LAYER_PROTECTED_TAIL}
     * — that's the user's "what did I publish today" window.
     */
    recordCrossLayerWrite(audit: CrossLayerWriteAudit): void {
        this.crossLayerBuffer.push(audit);
        this._crossLayerRecordCount++;
        if (this.crossLayerBuffer.length > this.crossLayerCapacity) {
            const overflow = this.crossLayerBuffer.length - this.crossLayerCapacity;
            const removable = Math.max(
                0,
                this.crossLayerBuffer.length - CROSS_LAYER_PROTECTED_TAIL,
            );
            const trim = Math.min(overflow, removable);
            if (trim > 0) {
                this.crossLayerBuffer.splice(0, trim);
                this._crossLayerTrimCount += trim;
            }
        }
    }

    /** Snapshot of the full cross-layer audit ring (newest last). */
    crossLayerWrites(): CrossLayerWriteAudit[] {
        return [...this.crossLayerBuffer];
    }

    /** Most-recent N cross-layer writes (newest last). */
    recentCrossLayerWrites(n: number): CrossLayerWriteAudit[] {
        if (n <= 0) return [];
        if (n >= this.crossLayerBuffer.length) return [...this.crossLayerBuffer];
        return this.crossLayerBuffer.slice(this.crossLayerBuffer.length - n);
    }

    /** Lookup a single cross-layer audit by id. Returns null when absent. */
    getCrossLayerWrite(auditId: string): CrossLayerWriteAudit | null {
        for (let i = this.crossLayerBuffer.length - 1; i >= 0; i--) {
            if (this.crossLayerBuffer[i].auditId === auditId) {
                return this.crossLayerBuffer[i];
            }
        }
        return null;
    }

    /** Aggregate counters over the cross-layer ring. Pure projection. */
    crossLayerStats(): CrossLayerWriteStats {
        const byPurpose: Record<string, number> = {};
        for (const src of ALL_SOURCES) byPurpose[src] = 0;
        const byDestination = Object.fromEntries(
            ALL_DESTINATIONS.map((d) => [d, 0]),
        ) as Record<CrossLayerWriteDestination, number>;

        let allowed = 0;
        let rejected = 0;
        let oldestEntryTs: number | null = null;
        let newestEntryTs: number | null = null;

        for (const e of this.crossLayerBuffer) {
            if (e.allowed) allowed++;
            else rejected++;
            byPurpose[e.purpose] = (byPurpose[e.purpose] ?? 0) + 1;
            byDestination[e.publishedTo]++;
            if (oldestEntryTs === null || e.submittedAt < oldestEntryTs) {
                oldestEntryTs = e.submittedAt;
            }
            if (newestEntryTs === null || e.submittedAt > newestEntryTs) {
                newestEntryTs = e.submittedAt;
            }
        }

        return {
            total: this.crossLayerBuffer.length,
            allowed,
            rejected,
            byPurpose: byPurpose as Record<PrivacyAuditPurpose, number>,
            byDestination,
            oldestEntryTs,
            newestEntryTs,
        };
    }

    /** Total cross-layer writes ever appended (incl. trimmed entries). */
    getCrossLayerRecordCount(): number {
        return this._crossLayerRecordCount;
    }

    /** Total cross-layer entries evicted from the ring this session. */
    getCrossLayerTrimCount(): number {
        return this._crossLayerTrimCount;
    }

    /** Wipe the cross-layer ring. Resets counters. */
    clearCrossLayerWrites(): void {
        this.crossLayerBuffer = [];
        this._crossLayerRecordCount = 0;
        this._crossLayerTrimCount = 0;
    }

    /** Test helper — override the ring capacity. */
    _setCrossLayerCapacityForTests(cap: number): void {
        this.crossLayerCapacity = Math.max(1, cap);
    }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const privacyAuditService = new PrivacyAuditService();
