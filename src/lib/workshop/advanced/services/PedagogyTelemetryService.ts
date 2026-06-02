// @graph-layer: private
// @rationale: per-book pedagogy aggregator — local-only, NEVER leaves device

// src/routes/dashboard/storybook-workshop/advanced/services/PedagogyTelemetryService.ts
//
// Per-kid + per-book pedagogy telemetry. NO network surface. NO kernel
// publish/effect path. Tests assert this invariant.

import type {
  PedagogyTelemetry,
  KidPedagogyReport,
} from '../types';
import type { EhriPhase } from '$lib/services/author/types';
import { IdbKeyValueStore } from './IdbKeyValueStore';

const DB = 'workshop-pedagogy-telemetry-v1';
const STORE = 'telemetry';

export class PedagogyTelemetryService {
  private readonly kv = new IdbKeyValueStore<PedagogyTelemetry>(DB, STORE);

  /** Persist a per-book telemetry record. */
  async recordBook(t: PedagogyTelemetry): Promise<void> {
    await this.kv.put(t.bookId, t);
  }

  async getBook(bookId: string): Promise<PedagogyTelemetry | null> {
    return this.kv.get(bookId);
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.kv.delete(bookId);
  }

  /** All books for a kid, sorted by createdAt (newest last). */
  async listForKid(kidId: string): Promise<PedagogyTelemetry[]> {
    const all = await this.kv.list();
    return all
      .filter((e) => e.value.kidId === kidId)
      .map((e) => e.value)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Kid-cascade deletion (matches AdvancedOverrideStore semantics). */
  async deleteAllForKid(kidId: string): Promise<number> {
    const records = await this.listForKid(kidId);
    for (const r of records) await this.kv.delete(r.bookId);
    return records.length;
  }

  /** Aggregate the per-kid reading-journey report. */
  async getKidReport(kidId: string): Promise<KidPedagogyReport> {
    const books = await this.listForKid(kidId);
    const bookCount = books.length;

    if (bookCount === 0) {
      return {
        kidId,
        bookCount: 0,
        uniqueTier2Words: 0,
        meanDialogicPromptsPerBook: 0,
        storyGrammarPassRate: 0,
        ehriPhaseBreakdown: {},
      };
    }

    const uniqueWords = new Set<string>();
    let dialogicTotal = 0;
    let grammarPassed = 0;
    let grammarTotal = 0;
    const ehriBreakdown: Partial<Record<EhriPhase, number>> = {};

    for (const b of books) {
      for (const w of b.tier2WordsActual) uniqueWords.add(w.toLowerCase());
      dialogicTotal += b.dialogicPromptCount;
      grammarPassed += b.storyGrammarPassCount;
      grammarTotal += b.storyGrammarTotalChecks;
      ehriBreakdown[b.ehriPhase] = (ehriBreakdown[b.ehriPhase] ?? 0) + 1;
    }

    return {
      kidId,
      bookCount,
      uniqueTier2Words: uniqueWords.size,
      meanDialogicPromptsPerBook: dialogicTotal / bookCount,
      storyGrammarPassRate: grammarTotal === 0 ? 0 : grammarPassed / grammarTotal,
      ehriPhaseBreakdown: ehriBreakdown,
    };
  }

  /** Bulk-list every book record. Used by Telemetry Inspector "all kids" view. */
  async listAll(): Promise<PedagogyTelemetry[]> {
    const all = await this.kv.list();
    return all.map((e) => e.value).sort((a, b) => a.createdAt - b.createdAt);
  }

  async __TEST_clearAll(): Promise<void> {
    await this.kv.clear();
  }
}

export const pedagogyTelemetryService = new PedagogyTelemetryService();
