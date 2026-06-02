// @graph-layer: private
// @rationale: per-draft snapshot history — never leaves device

// src/routes/dashboard/storybook-workshop/advanced/services/DiffSnapshotStore.ts
//
// IDB-backed store of per-redo SceneTree snapshots + WB scene + composite
// hashes. Supports side-by-side diff and rollback (Phase 7).

import type { DiffSnapshot } from '../types';
import { IdbKeyValueStore } from './IdbKeyValueStore';

const DB = 'workshop-diff-snapshots-v1';
const STORE = 'snapshots';

/** Per-draft LRU cap. Keeps IDB footprint bounded. */
const PER_DRAFT_LRU_CAP = 20;

export interface SaveSnapshotInput {
  draftId: string;
  kidId: string;
  /** Full SceneTree JSON. */
  sceneTreeJson: string;
  /** WB scene PNG hashes (sha-256 hex). */
  wbSceneHashes?: string[];
  /** Composite hashes. */
  compositeHashes?: string[];
  /** Optional human-readable label. */
  label?: string;
}

function genId(): string {
  // Avoid crypto.randomUUID for older test envs.
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}

export class DiffSnapshotStore {
  private readonly kv = new IdbKeyValueStore<DiffSnapshot>(DB, STORE);
  /** Track the next-version counter per-draft. */
  private nextVersionByDraft: Map<string, number> = new Map();

  /**
   * Save a snapshot. Returns the persisted record.
   * Enforces per-draft LRU eviction.
   */
  async saveSnapshot(input: SaveSnapshotInput): Promise<DiffSnapshot> {
    const existing = await this.listForDraft(input.draftId);
    const version = (existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.version))) + 1;
    this.nextVersionByDraft.set(input.draftId, version + 1);

    const snapshot: DiffSnapshot = {
      id: genId(),
      draftId: input.draftId,
      kidId: input.kidId,
      version,
      createdAt: Date.now(),
      sceneTreeJson: input.sceneTreeJson,
      wbSceneHashes: input.wbSceneHashes ?? [],
      compositeHashes: input.compositeHashes ?? [],
      label: input.label,
    };
    await this.kv.put(snapshot.id, snapshot);

    // LRU eviction. Sort by (createdAt, version) so ties on createdAt
    // (millisecond resolution) still produce deterministic eviction order —
    // older versions evict first.
    const all = await this.listForDraft(input.draftId);
    if (all.length > PER_DRAFT_LRU_CAP) {
      const sorted = [...all].sort(
        (a, b) => a.createdAt - b.createdAt || a.version - b.version
      );
      const overflow = sorted.slice(0, all.length - PER_DRAFT_LRU_CAP);
      for (const old of overflow) {
        await this.kv.delete(old.id);
      }
    }

    return snapshot;
  }

  async getSnapshot(id: string): Promise<DiffSnapshot | null> {
    return this.kv.get(id);
  }

  async listForDraft(draftId: string): Promise<DiffSnapshot[]> {
    const all = await this.kv.list();
    return all
      .filter((e) => e.value.draftId === draftId)
      .map((e) => e.value)
      .sort((a, b) => b.version - a.version);
  }

  /**
   * Roll back: returns the snapshot at the given version (or by id) so the
   * caller can restore SceneTree state. Does NOT delete more-recent
   * snapshots — they remain in history for re-rollback.
   */
  async rollback(input: { draftId: string; toVersion?: number; toId?: string }): Promise<DiffSnapshot | null> {
    if (input.toId !== undefined) {
      return this.getSnapshot(input.toId);
    }
    if (input.toVersion === undefined) return null;
    const list = await this.listForDraft(input.draftId);
    return list.find((s) => s.version === input.toVersion) ?? null;
  }

  /**
   * Compare any two snapshots (side-by-side). Returns the pair plus a
   * structural diff descriptor for the UI to render. UI does richer diff;
   * service surfaces the data.
   */
  async compare(
    leftId: string,
    rightId: string
  ): Promise<{ left: DiffSnapshot; right: DiffSnapshot; same: boolean } | null> {
    const [left, right] = await Promise.all([
      this.getSnapshot(leftId),
      this.getSnapshot(rightId),
    ]);
    if (!left || !right) return null;
    return {
      left,
      right,
      same:
        left.sceneTreeJson === right.sceneTreeJson &&
        JSON.stringify(left.wbSceneHashes) === JSON.stringify(right.wbSceneHashes),
    };
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.kv.delete(id);
  }

  async deleteAllForDraft(draftId: string): Promise<number> {
    const list = await this.listForDraft(draftId);
    for (const s of list) await this.kv.delete(s.id);
    return list.length;
  }

  async deleteAllForKid(kidId: string): Promise<number> {
    const all = await this.kv.list();
    let n = 0;
    for (const entry of all) {
      if (entry.value.kidId === kidId) {
        await this.kv.delete(entry.value.id);
        n++;
      }
    }
    return n;
  }

  async __TEST_clearAll(): Promise<void> {
    await this.kv.clear();
    this.nextVersionByDraft.clear();
  }
}

export const diffSnapshotStore = new DiffSnapshotStore();
export const __DIFF_SNAPSHOT_PER_DRAFT_LRU_CAP = PER_DRAFT_LRU_CAP;
