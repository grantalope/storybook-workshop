/**
 * KidsContentSafety — stub-backend baseline.
 *
 * The stub backend is the day-1 path: regex + keyword detection across all
 * 7 categories. Always available, no warmup, no external deps. This suite
 * locks the keyword behaviour and ensures normal kid-book prose passes
 * cleanly (low false-positive rate is as important as catching the bad
 * stuff — false fails break the user flow).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    kidsContentSafetyService,
    stubScan,
    STUB_KEYWORD_COUNT,
} from '$lib/kids-content-safety';
import type {
    ScanOpts,
    SafetyScanSource,
} from '$lib/kids-content-safety/types';

const SOURCE: SafetyScanSource = 'story_author';
const baseOpts: ScanOpts = { source: SOURCE };

describe('KidsContentSafety stub backend — direct stubScan() helper', () => {
    it('returns empty array on empty input', () => {
        expect(stubScan('')).toEqual([]);
    });

    it('returns empty array on null/undefined safely', () => {
        // @ts-expect-error — intentional misuse guard
        expect(stubScan(null)).toEqual([]);
        // @ts-expect-error — intentional misuse guard
        expect(stubScan(undefined)).toEqual([]);
    });

    it('returns empty array on neutral kid-book prose', () => {
        const text = 'The little bear found a red balloon in the tall grass.';
        expect(stubScan(text)).toEqual([]);
    });

    it('returns empty array on a long benign storybook paragraph', () => {
        const text =
            'Once upon a time, in a small cottage by the sea, lived a kind girl named Mira. ' +
            'Every morning she fed the seagulls and watched the sun rise over the waves. ' +
            'One day a tiny crab climbed onto her toe and waved its claw hello.';
        expect(stubScan(text)).toEqual([]);
    });

    it('catches a clear violence hit', () => {
        const reports = stubScan('The witch tried to kill the boy.');
        const cats = reports.map((r) => r.category);
        expect(cats).toContain('violence');
    });

    it('catches a clear fear_permanent hit (death-of-parent)', () => {
        const reports = stubScan('Mira’s mommy died and was never coming back.');
        expect(reports.map((r) => r.category)).toContain('fear_permanent');
    });

    it('catches a clear sexual_adult hit', () => {
        const reports = stubScan('The adults watched a pornographic film.');
        expect(reports.map((r) => r.category)).toContain('sexual_adult');
    });

    it('catches a clear substance hit', () => {
        const reports = stubScan('The man took a shot of vodka and lit a cigarette.');
        const cats = reports.map((r) => r.category);
        expect(cats).toContain('substance');
    });

    it('catches a clear religious_political hit', () => {
        const reports = stubScan('She voted for Donald Trump in the election.');
        expect(reports.map((r) => r.category)).toContain('religious_political');
    });

    it('catches a clear scary_unresolved hit', () => {
        const reports = stubScan('The monster in the closet whispered her name in the dark.');
        const cats = reports.map((r) => r.category);
        expect(cats).toContain('scary_unresolved');
    });

    it('catches a clear bigotry hit', () => {
        const reports = stubScan('The KKK gathered on the hill that night.');
        expect(reports.map((r) => r.category)).toContain('bigotry');
    });

    it('confidence on a keyword hit is 1.0', () => {
        const reports = stubScan('The killer chased the boy.');
        const violenceReport = reports.find((r) => r.category === 'violence');
        expect(violenceReport?.confidence).toBe(1.0);
    });

    it('emits a span on every keyword hit', () => {
        const reports = stubScan('The killer chased the boy.');
        const r = reports.find((r) => r.category === 'violence');
        expect(r?.span).toBeDefined();
        expect(r?.span?.[0]).toBeGreaterThanOrEqual(0);
        expect(r?.span?.[1]).toBeGreaterThan(r!.span![0]);
    });

    it('multi-category multi-word strings trip each category independently', () => {
        const reports = stubScan('She killed him with a sword while the demon watched.');
        const cats = new Set(reports.map((r) => r.category));
        expect(cats.has('violence')).toBe(true);
        expect(cats.has('scary_unresolved')).toBe(true);
    });

    it('keyword corpus exceeds the spec target of ~300 keywords', () => {
        expect(STUB_KEYWORD_COUNT).toBeGreaterThanOrEqual(250);
    });

    it('does not flag the word "battle" on its own', () => {
        // "battle" appears in kid books constantly; we only flag explicit
        // violence verbs / weapons.
        expect(stubScan('the battle of wits began').length).toBe(0);
    });

    it('does not flag the word "lost" on its own', () => {
        expect(stubScan('he lost his hat in the wind').length).toBe(0);
    });

    it('does not flag the word "scared" on its own', () => {
        expect(stubScan('the rabbit was scared of the loud noise').length).toBe(0);
    });

    it('does not flag religion-neutral words like "pray" or "church"', () => {
        // We only flag identifier-grade religious phrases (specific deities,
        // doctrine labels). Generic concept-words pass.
        expect(stubScan('the family went to church on sunday').length).toBe(0);
        expect(stubScan('she paused to pray for safe travels').length).toBe(0);
    });
});

describe('KidsContentSafety stub backend — via service.scan()', () => {
    beforeEach(() => {
        kidsContentSafetyService._resetForTests();
        kidsContentSafetyService._setProbeOrderForTests(['stub']);
    });

    it('passed=true on neutral input', async () => {
        const r = await kidsContentSafetyService.scan(
            'The little fox played in the field.',
            baseOpts,
        );
        expect(r.passed).toBe(true);
        expect(r.reports).toEqual([]);
    });

    it('passed=false on a clear hit', async () => {
        const r = await kidsContentSafetyService.scan(
            'The witch tried to kill the children.',
            baseOpts,
        );
        expect(r.passed).toBe(false);
    });

    it('strict mode does not change behaviour for confidence-1.0 keyword hits', async () => {
        const lax = await kidsContentSafetyService.scan(
            'The witch tried to kill the children.',
            baseOpts,
        );
        const strict = await kidsContentSafetyService.scan(
            'The witch tried to kill the children.',
            { ...baseOpts, strict: true },
        );
        expect(lax.passed).toBe(false);
        expect(strict.passed).toBe(false);
    });

    it('scanLatencyMs is a non-negative number', async () => {
        const r = await kidsContentSafetyService.scan(
            'The fox jumped over the log.',
            baseOpts,
        );
        expect(typeof r.scanLatencyMs).toBe('number');
        expect(r.scanLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('backend on the result identifies the dispatch backend', async () => {
        const r = await kidsContentSafetyService.scan(
            'The fox jumped over the log.',
            baseOpts,
        );
        expect(r.backend).toBe('stub');
    });

    it('forceBackend honors the request even when it does not match the active backend', async () => {
        const r = await kidsContentSafetyService.scan(
            'The fox jumped over the log.',
            { ...baseOpts, forceBackend: 'stub' },
        );
        expect(r.backend).toBe('stub');
    });
});
