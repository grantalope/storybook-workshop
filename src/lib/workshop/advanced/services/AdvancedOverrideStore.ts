// @graph-layer: private
// @rationale: per-user/per-kid storybook overrides — never leaves device

// src/routes/dashboard/storybook-workshop/advanced/services/AdvancedOverrideStore.ts
//
// IDB-backed store for advanced-mode override blobs per `(kidId, draftId)`.
// Also persists the advanced-mode global toggle.
//
// Goal Phase 1 + Phase 2 + Phase 3 + Phase 4.

import type {
  AdvancedModeFlag,
  AdvancedOverrideRecord,
  PedagogyOverride,
  WishEngineering,
  RenderDirection,
} from '../types';
import { IdbKeyValueStore } from './IdbKeyValueStore';

const OVERRIDE_DB = 'workshop-advanced-overrides-v1';
const OVERRIDE_STORE = 'overrides';
const FLAG_DB = 'workshop-advanced-mode-flag-v1';
const FLAG_STORE = 'flag';
const FLAG_KEY = 'singleton';

/** Compose a unique composite key for `(kidId, draftId)`. */
function compositeKey(kidId: string, draftId: string): string {
  return `${kidId}::${draftId}`;
}

export class AdvancedOverrideStore {
  private readonly overrideKv = new IdbKeyValueStore<AdvancedOverrideRecord>(
    OVERRIDE_DB,
    OVERRIDE_STORE
  );
  private readonly flagKv = new IdbKeyValueStore<AdvancedModeFlag>(
    FLAG_DB,
    FLAG_STORE
  );

  // ─── Toggle ────────────────────────────────────────────────────────────

  async getAdvancedMode(): Promise<boolean> {
    const rec = await this.flagKv.get(FLAG_KEY);
    return rec?.enabled === true;
  }

  async setAdvancedMode(enabled: boolean): Promise<void> {
    await this.flagKv.put(FLAG_KEY, {
      enabled,
      updatedAt: Date.now(),
    });
  }

  // ─── Per-draft overrides ──────────────────────────────────────────────

  async getOverrides(
    kidId: string,
    draftId: string
  ): Promise<AdvancedOverrideRecord | null> {
    return this.overrideKv.get(compositeKey(kidId, draftId));
  }

  async setPedagogy(
    kidId: string,
    draftId: string,
    pedagogy: PedagogyOverride
  ): Promise<void> {
    const existing =
      (await this.getOverrides(kidId, draftId)) ?? this._emptyRecord(kidId, draftId);
    existing.pedagogy = pedagogy;
    existing.updatedAt = Date.now();
    await this.overrideKv.put(compositeKey(kidId, draftId), existing);
  }

  async setWish(
    kidId: string,
    draftId: string,
    wish: WishEngineering
  ): Promise<void> {
    const existing =
      (await this.getOverrides(kidId, draftId)) ?? this._emptyRecord(kidId, draftId);
    existing.wish = wish;
    existing.updatedAt = Date.now();
    await this.overrideKv.put(compositeKey(kidId, draftId), existing);
  }

  async setRender(
    kidId: string,
    draftId: string,
    render: RenderDirection
  ): Promise<void> {
    const existing =
      (await this.getOverrides(kidId, draftId)) ?? this._emptyRecord(kidId, draftId);
    existing.render = render;
    existing.updatedAt = Date.now();
    await this.overrideKv.put(compositeKey(kidId, draftId), existing);
  }

  async deleteOverrides(kidId: string, draftId: string): Promise<void> {
    await this.overrideKv.delete(compositeKey(kidId, draftId));
  }

  /**
   * List all overrides for a given kid (used by kid-cascade deletion and
   * by the telemetry aggregator).
   */
  async listForKid(kidId: string): Promise<AdvancedOverrideRecord[]> {
    const all = await this.overrideKv.list();
    return all
      .filter((entry) => entry.value.kidId === kidId)
      .map((e) => e.value);
  }

  /**
   * Delete every override for a given kid (kid-cascade deletion).
   */
  async deleteAllForKid(kidId: string): Promise<number> {
    const records = await this.listForKid(kidId);
    let n = 0;
    for (const rec of records) {
      await this.overrideKv.delete(compositeKey(rec.kidId, rec.draftId));
      n++;
    }
    return n;
  }

  /** Test-only: clear everything. */
  async __TEST_clearAll(): Promise<void> {
    await this.overrideKv.clear();
    await this.flagKv.clear();
  }

  private _emptyRecord(kidId: string, draftId: string): AdvancedOverrideRecord {
    return {
      kidId,
      draftId,
      updatedAt: Date.now(),
    };
  }
}

/**
 * Process-scoped singleton. Vite tree-shakes it out if unused.
 */
export const advancedOverrideStore = new AdvancedOverrideStore();
