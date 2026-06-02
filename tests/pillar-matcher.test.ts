// tests/storybook-workshop/pillar-matcher.test.ts
//
// Covers:
//   - cosineSimilarity() math edge cases (identical / orthogonal / zero / mismatch)
//   - match() returns top-K sorted DESC by similarity
//   - age-band boost actually shifts ordering when ties / near-ties exist
//   - refineNear() returns neighborhood, excludes seed
//   - refineExcluding() filters previously-shown pillars
//   - empty manifest → empty result on all three call shapes
//   - topK <= 0 → empty result

import { describe, it, expect, beforeEach } from 'vitest';
import {
    AGE_BAND_BOOST,
    PillarMatcherService,
    cosineSimilarity,
} from '$lib/services/PillarMatcherService';
import type {
    Pillar,
    PillarAxes,
} from '$lib/services/types';

const DIM = 8; // small dim for tests; the service is dim-agnostic

function vec(values: number[]): Float32Array {
    return new Float32Array(values);
}

function unitOnAxis(axis: number): Float32Array {
    const v = new Float32Array(DIM);
    v[axis] = 1;
    return v;
}

function axes(ageBand: 'toddler' | 'preschool' | 'grade-school'): PillarAxes {
    return {
        hair: 'wavy-short',
        skinTone: 'III',
        eyeColor: 'brown',
        ageBand,
        clothingVibe: 'casual',
        extras: [],
    };
}

function makePillar(id: number, embedding: Float32Array, ageBand: PillarAxes['ageBand']): Pillar {
    return { pillarId: id, axes: axes(ageBand), embedding };
}

describe('cosineSimilarity', () => {
    it('returns 1 for identical unit vectors', () => {
        const a = unitOnAxis(0);
        const b = unitOnAxis(0);
        expect(cosineSimilarity(a, b)).toBeCloseTo(1);
    });

    it('returns 0 for orthogonal vectors', () => {
        const a = unitOnAxis(0);
        const b = unitOnAxis(1);
        expect(cosineSimilarity(a, b)).toBeCloseTo(0);
    });

    it('returns -1 for opposite vectors', () => {
        const a = unitOnAxis(0);
        const b = vec([-1, 0, 0, 0, 0, 0, 0, 0]);
        expect(cosineSimilarity(a, b)).toBeCloseTo(-1);
    });

    it('returns NaN on length mismatch', () => {
        const a = new Float32Array(4);
        const b = new Float32Array(8);
        expect(Number.isNaN(cosineSimilarity(a, b))).toBe(true);
    });

    it('returns NaN on zero-norm vector', () => {
        const a = new Float32Array(DIM); // all zeros
        const b = unitOnAxis(0);
        expect(Number.isNaN(cosineSimilarity(a, b))).toBe(true);
    });
});

describe('PillarMatcherService.match', () => {
    let svc: PillarMatcherService;

    beforeEach(() => {
        svc = new PillarMatcherService();
    });

    it('returns top-K nearest by cosine when no age-band hint given', async () => {
        // 10 pillars on 10 distinct axes (DIM has to grow to 10 for orthogonality
        // but the service is dim-agnostic — make a DIM=10 fixture)
        const localDim = 10;
        const pillars: Pillar[] = [];
        for (let i = 0; i < localDim; i++) {
            const e = new Float32Array(localDim);
            e[i] = 1;
            pillars.push(makePillar(100 + i, e, 'preschool'));
        }
        svc.__test_setManifest(pillars);
        // kid points slightly toward pillar 0 + 2 + 5
        const kid = new Float32Array(localDim);
        kid[0] = 0.9;
        kid[2] = 0.7;
        kid[5] = 0.5;
        const matches = await svc.match(kid, { topK: 3 });
        expect(matches.length).toBe(3);
        expect(matches[0].pillarId).toBe(100);
        expect(matches[1].pillarId).toBe(102);
        expect(matches[2].pillarId).toBe(105);
        // sorted DESC
        expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity);
        expect(matches[1].similarity).toBeGreaterThan(matches[2].similarity);
    });

    it('applies +AGE_BAND_BOOST to pillars matching ageBandHint', async () => {
        const a = unitOnAxis(0);
        const b = unitOnAxis(0); // same vector as `a`
        const pillars: Pillar[] = [
            makePillar(200, a, 'grade-school'),
            makePillar(201, b, 'toddler'),
        ];
        svc.__test_setManifest(pillars);
        const kid = unitOnAxis(0);
        // Raw cosine identical (both 1.0). With ageBandHint=toddler, pillar 201
        // gets +0.1 → sorts ahead.
        const matches = await svc.match(kid, { topK: 2, ageBandHint: 'toddler' });
        expect(matches[0].pillarId).toBe(201);
        expect(matches[0].similarity).toBeCloseTo(1 + AGE_BAND_BOOST);
        expect(matches[1].pillarId).toBe(200);
        expect(matches[1].similarity).toBeCloseTo(1);
    });

    it('returns [] on empty manifest', async () => {
        svc.__test_setManifest([]);
        const matches = await svc.match(unitOnAxis(0), { topK: 3 });
        expect(matches).toEqual([]);
    });

    it('returns [] on topK <= 0', async () => {
        const pillars = [makePillar(1, unitOnAxis(0), 'preschool')];
        svc.__test_setManifest(pillars);
        const matches = await svc.match(unitOnAxis(0), { topK: 0 });
        expect(matches).toEqual([]);
    });
});

describe('PillarMatcherService.refineNear', () => {
    let svc: PillarMatcherService;
    beforeEach(() => {
        svc = new PillarMatcherService();
    });

    it('returns top-K pillars nearest the seed, excluding seed itself', async () => {
        const localDim = 6;
        const pillars: Pillar[] = [];
        for (let i = 0; i < localDim; i++) {
            const e = new Float32Array(localDim);
            e[i] = 1;
            pillars.push(makePillar(300 + i, e, 'preschool'));
        }
        // Inject a pillar with a partially-correlated embedding to make
        // ordering non-trivial.
        const partial = new Float32Array(localDim);
        partial[0] = 0.9;
        partial[1] = 0.4;
        pillars.push(makePillar(399, partial, 'preschool'));
        svc.__test_setManifest(pillars);
        const matches = await svc.refineNear(300, 3);
        expect(matches.length).toBe(3);
        // seed (300) excluded
        for (const m of matches) {
            expect(m.pillarId).not.toBe(300);
        }
        // 399 (highly correlated with pillar 300) should rank first
        expect(matches[0].pillarId).toBe(399);
    });

    it('returns [] when seed pillarId is unknown', async () => {
        const pillars = [makePillar(1, unitOnAxis(0), 'preschool')];
        svc.__test_setManifest(pillars);
        const matches = await svc.refineNear(9999, 3);
        expect(matches).toEqual([]);
    });

    it('returns [] on empty manifest', async () => {
        svc.__test_setManifest([]);
        const matches = await svc.refineNear(123, 3);
        expect(matches).toEqual([]);
    });
});

describe('PillarMatcherService.refineExcluding', () => {
    let svc: PillarMatcherService;
    beforeEach(() => {
        svc = new PillarMatcherService();
    });

    it('excludes previously-shown pillars from the top-K', async () => {
        const localDim = 5;
        const pillars: Pillar[] = [];
        for (let i = 0; i < localDim; i++) {
            const e = new Float32Array(localDim);
            e[i] = 1;
            pillars.push(makePillar(400 + i, e, 'preschool'));
        }
        svc.__test_setManifest(pillars);
        const kid = new Float32Array(localDim);
        kid[0] = 0.9;
        kid[1] = 0.7;
        kid[2] = 0.5;
        // Without exclusion, top-3 would be 400, 401, 402.
        // Exclude 400 + 401 — top-K should now lead with 402.
        const matches = await svc.refineExcluding(kid, [400, 401], { topK: 3 });
        expect(matches[0].pillarId).toBe(402);
        for (const m of matches) {
            expect([400, 401]).not.toContain(m.pillarId);
        }
    });

    it('returns [] when every pillar is excluded', async () => {
        const pillars = [
            makePillar(500, unitOnAxis(0), 'preschool'),
            makePillar(501, unitOnAxis(1), 'preschool'),
        ];
        svc.__test_setManifest(pillars);
        const matches = await svc.refineExcluding(unitOnAxis(0), [500, 501], { topK: 5 });
        expect(matches).toEqual([]);
    });
});
