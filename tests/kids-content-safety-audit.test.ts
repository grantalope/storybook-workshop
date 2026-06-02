/**
 * KidsContentSafety — audit ring buffer correctness.
 *
 * - FIFO eviction at capacity
 * - hash-only storage (raw text never persisted)
 * - per-category fail counts attribute to category, not generic fail bucket
 * - summary (total / passed / failed) matches the buffer contents
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KidsContentSafetyAudit } from '$lib/kids-content-safety/KidsContentSafetyAudit';
import {
    kidsContentSafetyAudit,
    kidsContentSafetyService,
} from '$lib/kids-content-safety';
import type {
    ScanResult,
    SafetyScanSource,
} from '$lib/kids-content-safety/types';

const source: SafetyScanSource = 'story_author';
const passingResult: ScanResult = {
    passed: true,
    reports: [],
    scanLatencyMs: 1.0,
    backend: 'stub',
};
const failingResult: ScanResult = {
    passed: false,
    reports: [{ category: 'violence', confidence: 1.0 }],
    scanLatencyMs: 1.0,
    backend: 'stub',
};

describe('KidsContentSafetyAudit — ring buffer (unit)', () => {
    let audit: KidsContentSafetyAudit;
    beforeEach(() => {
        audit = new KidsContentSafetyAudit(5);
    });

    it('starts empty', () => {
        expect(audit.getSize()).toBe(0);
        expect(audit.recent(10)).toEqual([]);
        expect(audit.summary()).toEqual({ total: 0, passed: 0, failed: 0 });
    });

    it('records up to capacity', () => {
        for (let i = 0; i < 5; i++) {
            audit.record({
                source,
                result: passingResult,
                text: `entry ${i}`,
                ts: i,
            });
        }
        expect(audit.getSize()).toBe(5);
    });

    it('evicts oldest when capacity is exceeded (FIFO ring)', () => {
        for (let i = 0; i < 7; i++) {
            audit.record({
                source,
                result: passingResult,
                text: `entry ${i}`,
                ts: i,
            });
        }
        // Buffer holds capacity (5) entries — the two oldest evicted.
        expect(audit.getSize()).toBe(5);
        const recent = audit.recent(10);
        // Newest entry is `entry 6`.
        expect(recent[0].ts).toBe(6);
        // Oldest still in buffer is `entry 2`.
        expect(recent[recent.length - 1].ts).toBe(2);
    });

    it('recent(n) returns newest-first ordering', () => {
        audit.record({ source, result: passingResult, text: 'a', ts: 100 });
        audit.record({ source, result: passingResult, text: 'b', ts: 200 });
        audit.record({ source, result: passingResult, text: 'c', ts: 300 });
        const recent = audit.recent(3);
        expect(recent.map((e) => e.ts)).toEqual([300, 200, 100]);
    });

    it('recent(0) returns empty', () => {
        audit.record({ source, result: passingResult, text: 'a', ts: 1 });
        expect(audit.recent(0)).toEqual([]);
    });

    it('recent(n > size) returns all entries', () => {
        audit.record({ source, result: passingResult, text: 'a', ts: 1 });
        audit.record({ source, result: passingResult, text: 'b', ts: 2 });
        expect(audit.recent(10).length).toBe(2);
    });

    it('clear() empties the buffer', () => {
        audit.record({ source, result: passingResult, text: 'a', ts: 1 });
        audit.record({ source, result: passingResult, text: 'b', ts: 2 });
        audit.clear();
        expect(audit.getSize()).toBe(0);
        expect(audit.recent(10)).toEqual([]);
    });

    it('summary() tallies pass/fail correctly', () => {
        audit.record({ source, result: passingResult, text: 'a', ts: 1 });
        audit.record({ source, result: failingResult, text: 'b', ts: 2 });
        audit.record({ source, result: passingResult, text: 'c', ts: 3 });
        expect(audit.summary()).toEqual({ total: 3, passed: 2, failed: 1 });
    });

    it('categoryFailCounts() attributes by category', () => {
        audit.record({
            source,
            result: {
                passed: false,
                reports: [
                    { category: 'violence', confidence: 1.0 },
                    { category: 'fear_permanent', confidence: 0.6 },
                ],
                scanLatencyMs: 1,
                backend: 'stub',
            },
            text: 'a',
            ts: 1,
        });
        audit.record({
            source,
            result: {
                passed: false,
                reports: [{ category: 'violence', confidence: 0.9 }],
                scanLatencyMs: 1,
                backend: 'stub',
            },
            text: 'b',
            ts: 2,
        });
        const counts = audit.categoryFailCounts();
        expect(counts.violence).toBe(2);
        expect(counts.fear_permanent).toBe(1);
        expect(counts.sexual_adult).toBe(0);
    });

    it('categoryFailCounts() skips passed entries entirely', () => {
        audit.record({
            source,
            result: passingResult,
            text: 'a',
            ts: 1,
        });
        const counts = audit.categoryFailCounts();
        for (const v of Object.values(counts)) expect(v).toBe(0);
    });

    it('categoryFailCounts() ignores low-confidence reports below threshold', () => {
        audit.record({
            source,
            result: {
                passed: false,
                reports: [{ category: 'violence', confidence: 0.3 }],
                scanLatencyMs: 1,
                backend: 'stub',
            },
            text: 'a',
            ts: 1,
        });
        // Below the 0.5 default threshold → count not incremented even
        // though the result is "failed" by some strict-mode caller.
        expect(audit.categoryFailCounts().violence).toBe(0);
    });

    it('stores hash-only — raw text never persisted', () => {
        audit.record({
            source,
            result: passingResult,
            text: 'secret string nobody should see',
            ts: 1,
        });
        const recent = audit.recent(1);
        const entry = recent[0];
        // Hash is the FNV-1a 32-bit hex string (8 chars).
        expect(entry.textHash).toMatch(/^[0-9a-f]{8}$/);
        // Confirm the raw string isn't on the entry under any property.
        expect(JSON.stringify(entry)).not.toContain('secret string nobody');
    });

    it('two distinct inputs hash to different values', () => {
        audit.record({ source, result: passingResult, text: 'apple', ts: 1 });
        audit.record({ source, result: passingResult, text: 'banana', ts: 2 });
        const recent = audit.recent(2);
        expect(recent[0].textHash).not.toBe(recent[1].textHash);
    });

    it('identical inputs hash to the same value (deterministic)', () => {
        audit.record({ source, result: passingResult, text: 'identical', ts: 1 });
        audit.record({ source, result: passingResult, text: 'identical', ts: 2 });
        const recent = audit.recent(2);
        expect(recent[0].textHash).toBe(recent[1].textHash);
    });

    it('getCapacity reports the value passed to the constructor', () => {
        const a = new KidsContentSafetyAudit(42);
        expect(a.getCapacity()).toBe(42);
    });

    it('the module-level singleton has the spec capacity of 1000', () => {
        // Capacity is exposed via getCapacity(); equals the spec target.
        expect(kidsContentSafetyAudit.getCapacity()).toBe(1000);
    });
});

describe('KidsContentSafetyAudit — wired via service.scan()', () => {
    beforeEach(() => {
        kidsContentSafetyService._resetForTests();
        kidsContentSafetyService._setProbeOrderForTests(['stub']);
        kidsContentSafetyAudit.clear();
    });

    it('service.scan records into the audit ring', async () => {
        await kidsContentSafetyService.scan('a peaceful afternoon', {
            source: 'story_author',
        });
        expect(kidsContentSafetyAudit.getSize()).toBe(1);
    });

    it('service.scan records failed scans with category attribution', async () => {
        await kidsContentSafetyService.scan(
            'The witch tried to kill the children.',
            { source: 'story_author' },
        );
        const counts = kidsContentSafetyAudit.categoryFailCounts();
        expect(counts.violence).toBe(1);
    });

    it('empty input is still recorded (operator visibility)', async () => {
        await kidsContentSafetyService.scan('', { source: 'story_author' });
        expect(kidsContentSafetyAudit.getSize()).toBe(1);
        expect(kidsContentSafetyAudit.summary()).toEqual({
            total: 1,
            passed: 1,
            failed: 0,
        });
    });
});
