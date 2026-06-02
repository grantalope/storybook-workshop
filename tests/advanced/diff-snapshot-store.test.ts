/**
 * DiffSnapshotStore — snapshot CRUD, LRU eviction, rollback restores state.
 *
 * Goal Phase 9 #14.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DiffSnapshotStore,
  __DIFF_SNAPSHOT_PER_DRAFT_LRU_CAP,
} from '$lib/workshop/advanced/services/DiffSnapshotStore';

let store: DiffSnapshotStore;

beforeEach(async () => {
  store = new DiffSnapshotStore();
  await store.__TEST_clearAll();
});

function sampleTree(spreadCount = 3): string {
  return JSON.stringify({
    title: 'Sample',
    back_cover_blurb: 'A brave tale',
    page_budget: 16,
    beats: [],
    tier2_words: ['glimmer'],
    spreads: Array.from({ length: spreadCount }, (_, i) => ({ spreadIndex: i, text: `page ${i}` })),
  });
}

describe('DiffSnapshotStore — save + get', () => {
  it('saves a snapshot with monotonically increasing version', async () => {
    const a = await store.saveSnapshot({
      draftId: 'draft-1',
      kidId: 'kid-1',
      sceneTreeJson: sampleTree(),
    });
    const b = await store.saveSnapshot({
      draftId: 'draft-1',
      kidId: 'kid-1',
      sceneTreeJson: sampleTree(),
    });
    expect(a.version).toBe(1);
    expect(b.version).toBe(2);
  });

  it('snapshots are scoped per-draft', async () => {
    await store.saveSnapshot({ draftId: 'draft-1', kidId: 'kid-1', sceneTreeJson: sampleTree() });
    const b = await store.saveSnapshot({ draftId: 'draft-2', kidId: 'kid-1', sceneTreeJson: sampleTree() });
    expect(b.version).toBe(1);
  });

  it('persists wb + composite hashes', async () => {
    const s = await store.saveSnapshot({
      draftId: 'draft-1',
      kidId: 'kid-1',
      sceneTreeJson: sampleTree(),
      wbSceneHashes: ['abc', 'def'],
      compositeHashes: ['ghi'],
      label: 'before rhyme boost',
    });
    const rec = await store.getSnapshot(s.id);
    expect(rec).not.toBeNull();
    expect(rec!.wbSceneHashes).toEqual(['abc', 'def']);
    expect(rec!.compositeHashes).toEqual(['ghi']);
    expect(rec!.label).toBe('before rhyme boost');
  });
});

describe('DiffSnapshotStore — listForDraft', () => {
  it('returns newest version first', async () => {
    await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(1) });
    await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(2) });
    await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(3) });
    const list = await store.listForDraft('d');
    expect(list.map((s) => s.version)).toEqual([3, 2, 1]);
  });
});

describe('DiffSnapshotStore — rollback', () => {
  it('rolls back to a specific version', async () => {
    await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(1) });
    const v2 = await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(2) });
    await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(3) });

    const found = await store.rollback({ draftId: 'd', toVersion: 2 });
    expect(found).not.toBeNull();
    expect(found!.id).toBe(v2.id);
  });

  it('rolls back by id', async () => {
    const v1 = await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree() });
    const rec = await store.rollback({ draftId: 'd', toId: v1.id });
    expect(rec).not.toBeNull();
    expect(rec!.id).toBe(v1.id);
  });

  it('rollback does NOT delete the newer snapshots (idempotent history)', async () => {
    await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(1) });
    await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(2) });
    const v3 = await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(3) });

    await store.rollback({ draftId: 'd', toVersion: 1 });
    const list = await store.listForDraft('d');
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe(v3.id);
  });
});

describe('DiffSnapshotStore — compare', () => {
  it('returns same=false when sceneTreeJson differs', async () => {
    const a = await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(1) });
    const b = await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: sampleTree(3) });
    const cmp = await store.compare(a.id, b.id);
    expect(cmp).not.toBeNull();
    expect(cmp!.same).toBe(false);
  });

  it('returns null for an unknown snapshot id', async () => {
    const cmp = await store.compare('nope-a', 'nope-b');
    expect(cmp).toBeNull();
  });

  it('returns same=true for identical content', async () => {
    const tree = sampleTree(2);
    const a = await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: tree, wbSceneHashes: ['x'] });
    const b = await store.saveSnapshot({ draftId: 'd', kidId: 'k', sceneTreeJson: tree, wbSceneHashes: ['x'] });
    const cmp = await store.compare(a.id, b.id);
    expect(cmp!.same).toBe(true);
  });
});

describe('DiffSnapshotStore — LRU eviction', () => {
  it('evicts oldest when per-draft cap is exceeded', async () => {
    // Save cap + 3 snapshots; expect oldest 3 to be evicted.
    for (let i = 0; i < __DIFF_SNAPSHOT_PER_DRAFT_LRU_CAP + 3; i++) {
      await store.saveSnapshot({
        draftId: 'd',
        kidId: 'k',
        sceneTreeJson: sampleTree(i + 1),
      });
    }
    const list = await store.listForDraft('d');
    expect(list).toHaveLength(__DIFF_SNAPSHOT_PER_DRAFT_LRU_CAP);
    // The lowest version present should be 4 (versions 1-3 evicted).
    const minVersion = Math.min(...list.map((s) => s.version));
    expect(minVersion).toBe(4);
  });
});

describe('DiffSnapshotStore — kid-cascade delete', () => {
  it('deletes every snapshot for a kid across drafts', async () => {
    await store.saveSnapshot({ draftId: 'd1', kidId: 'kid-x', sceneTreeJson: sampleTree() });
    await store.saveSnapshot({ draftId: 'd1', kidId: 'kid-x', sceneTreeJson: sampleTree() });
    await store.saveSnapshot({ draftId: 'd2', kidId: 'kid-x', sceneTreeJson: sampleTree() });
    await store.saveSnapshot({ draftId: 'd1', kidId: 'kid-y', sceneTreeJson: sampleTree() });

    const n = await store.deleteAllForKid('kid-x');
    expect(n).toBe(3);
    expect(await store.listForDraft('d1')).toHaveLength(1);
    expect(await store.listForDraft('d2')).toHaveLength(0);
  });
});
