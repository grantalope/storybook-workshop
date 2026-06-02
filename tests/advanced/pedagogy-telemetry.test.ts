/**
 * PedagogyTelemetryService — aggregator correctness across multiple books +
 * kid-cascade delete + local-only invariant.
 *
 * Goal Phase 9 #15.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PedagogyTelemetryService } from '$lib/workshop/advanced/services/PedagogyTelemetryService';
import type { PedagogyTelemetry } from '$lib/workshop/advanced/types';

let svc: PedagogyTelemetryService;

beforeEach(async () => {
  svc = new PedagogyTelemetryService();
  await svc.__TEST_clearAll();
});

function mkBook(overrides: Partial<PedagogyTelemetry>): PedagogyTelemetry {
  return {
    bookId: `book-${Math.random().toString(36).slice(2, 8)}`,
    kidId: 'kid-1',
    createdAt: Date.now(),
    tier2WordsActual: ['glimmer', 'whisper'],
    sentenceLengthHist: { 5: 2, 6: 4, 7: 3 },
    ehriPhase: 'partial-alphabetic',
    ageBand: 'preschool',
    rhymeDensityPct: 40,
    dialogicPromptCount: 6,
    storyGrammarPassCount: 5,
    storyGrammarTotalChecks: 6,
    ...overrides,
  };
}

describe('PedagogyTelemetryService — CRUD', () => {
  it('records and reads a book', async () => {
    const b = mkBook({ bookId: 'b1' });
    await svc.recordBook(b);
    expect(await svc.getBook('b1')).toEqual(b);
  });

  it('lists per kid', async () => {
    await svc.recordBook(mkBook({ bookId: 'b1', kidId: 'kid-a' }));
    await svc.recordBook(mkBook({ bookId: 'b2', kidId: 'kid-a' }));
    await svc.recordBook(mkBook({ bookId: 'b3', kidId: 'kid-b' }));
    const a = await svc.listForKid('kid-a');
    expect(a).toHaveLength(2);
    const b = await svc.listForKid('kid-b');
    expect(b).toHaveLength(1);
  });
});

describe('PedagogyTelemetryService — getKidReport aggregation', () => {
  it('returns zero defaults when kid has no books', async () => {
    const r = await svc.getKidReport('kid-unknown');
    expect(r.bookCount).toBe(0);
    expect(r.uniqueTier2Words).toBe(0);
    expect(r.meanDialogicPromptsPerBook).toBe(0);
    expect(r.storyGrammarPassRate).toBe(0);
    expect(r.ehriPhaseBreakdown).toEqual({});
  });

  it('aggregates unique tier-2 words across books (case-insensitive)', async () => {
    await svc.recordBook(mkBook({ bookId: 'b1', tier2WordsActual: ['glimmer', 'whisper'] }));
    await svc.recordBook(mkBook({ bookId: 'b2', tier2WordsActual: ['Glimmer', 'meander', 'gleam'] }));
    await svc.recordBook(mkBook({ bookId: 'b3', tier2WordsActual: ['meander', 'serene'] }));
    const r = await svc.getKidReport('kid-1');
    // Unique: glimmer, whisper, meander, gleam, serene = 5
    expect(r.bookCount).toBe(3);
    expect(r.uniqueTier2Words).toBe(5);
  });

  it('computes mean dialogic prompts per book', async () => {
    await svc.recordBook(mkBook({ bookId: 'b1', dialogicPromptCount: 4 }));
    await svc.recordBook(mkBook({ bookId: 'b2', dialogicPromptCount: 8 }));
    await svc.recordBook(mkBook({ bookId: 'b3', dialogicPromptCount: 6 }));
    const r = await svc.getKidReport('kid-1');
    expect(r.meanDialogicPromptsPerBook).toBe(6);
  });

  it('computes story-grammar pass rate', async () => {
    await svc.recordBook(mkBook({ bookId: 'b1', storyGrammarPassCount: 5, storyGrammarTotalChecks: 6 }));
    await svc.recordBook(mkBook({ bookId: 'b2', storyGrammarPassCount: 4, storyGrammarTotalChecks: 6 }));
    const r = await svc.getKidReport('kid-1');
    // 9 / 12 = 0.75
    expect(r.storyGrammarPassRate).toBeCloseTo(0.75, 5);
  });

  it('breaks down Ehri-phase counts', async () => {
    await svc.recordBook(mkBook({ bookId: 'b1', ehriPhase: 'pre-alphabetic' }));
    await svc.recordBook(mkBook({ bookId: 'b2', ehriPhase: 'partial-alphabetic' }));
    await svc.recordBook(mkBook({ bookId: 'b3', ehriPhase: 'partial-alphabetic' }));
    await svc.recordBook(mkBook({ bookId: 'b4', ehriPhase: 'full-alphabetic' }));
    const r = await svc.getKidReport('kid-1');
    expect(r.ehriPhaseBreakdown).toEqual({
      'pre-alphabetic': 1,
      'partial-alphabetic': 2,
      'full-alphabetic': 1,
    });
  });
});

describe('PedagogyTelemetryService — kid-cascade delete', () => {
  it('removes every book for a kid', async () => {
    await svc.recordBook(mkBook({ bookId: 'b1', kidId: 'kid-x' }));
    await svc.recordBook(mkBook({ bookId: 'b2', kidId: 'kid-x' }));
    await svc.recordBook(mkBook({ bookId: 'b3', kidId: 'kid-y' }));
    const n = await svc.deleteAllForKid('kid-x');
    expect(n).toBe(2);
    expect(await svc.listForKid('kid-x')).toHaveLength(0);
    expect(await svc.listForKid('kid-y')).toHaveLength(1);
  });
});

describe('PedagogyTelemetryService — local-only invariant', () => {
  it('does NOT call fetch during any service operation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation(() => {
      throw new Error('local-only invariant violated: fetch called');
    });
    try {
      await svc.recordBook(mkBook({ bookId: 'b1' }));
      await svc.getBook('b1');
      await svc.listForKid('kid-1');
      await svc.getKidReport('kid-1');
      await svc.listAll();
      await svc.deleteAllForKid('kid-1');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does NOT touch globalThis.__kernel for any operation', async () => {
    // Plant a sentinel that screams if accessed via spyable proxy.
    const calls: string[] = [];
    const sentinel = new Proxy({} as any, {
      get(_t, prop) {
        calls.push(String(prop));
        return undefined;
      },
    });
    const before = (globalThis as any).__kernel;
    (globalThis as any).__kernel = sentinel;
    try {
      await svc.recordBook({
        bookId: 'b1',
        kidId: 'kid-1',
        createdAt: Date.now(),
        tier2WordsActual: [],
        sentenceLengthHist: {},
        ehriPhase: 'partial-alphabetic',
        ageBand: 'preschool',
        rhymeDensityPct: 0,
        dialogicPromptCount: 0,
        storyGrammarPassCount: 0,
        storyGrammarTotalChecks: 0,
      });
      await svc.getKidReport('kid-1');
      expect(calls).toEqual([]);
    } finally {
      (globalThis as any).__kernel = before;
    }
  });
});
