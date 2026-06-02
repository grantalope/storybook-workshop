/**
 * AdvancedOverrideStore — IDB CRUD per (kidId, draftId), toggle persistence.
 *
 * Goal Phase 9 #13.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { AdvancedOverrideStore } from '$lib/workshop/advanced/services/AdvancedOverrideStore';
import type {
  PedagogyOverride,
  WishEngineering,
  RenderDirection,
} from '$lib/workshop/advanced/types';

let store: AdvancedOverrideStore;

beforeEach(async () => {
  store = new AdvancedOverrideStore();
  await store.__TEST_clearAll();
});

describe('AdvancedOverrideStore — toggle', () => {
  it('returns false on first read', async () => {
    expect(await store.getAdvancedMode()).toBe(false);
  });

  it('persists the toggle and reads back', async () => {
    await store.setAdvancedMode(true);
    expect(await store.getAdvancedMode()).toBe(true);
    await store.setAdvancedMode(false);
    expect(await store.getAdvancedMode()).toBe(false);
  });
});

describe('AdvancedOverrideStore — pedagogy overrides', () => {
  it('returns null for an unknown (kidId, draftId)', async () => {
    expect(await store.getOverrides('kid-1', 'draft-1')).toBeNull();
  });

  it('persists a pedagogy override and reads it back', async () => {
    const ped: PedagogyOverride = {
      ehriPhase: 'partial-alphabetic',
      sentenceLengthCapWords: 10,
      tier2WordLockList: ['glimmer', 'whisper', 'meander'],
      rhymeDensityPct: 50,
      dialogicDensity: 'dense',
      storyGrammarEnforcement: 'strict',
      letterSpacingPx: 1.5,
      leadingPx: 24,
      font: 'lexend',
    };
    await store.setPedagogy('kid-1', 'draft-1', ped);
    const rec = await store.getOverrides('kid-1', 'draft-1');
    expect(rec).not.toBeNull();
    expect(rec!.pedagogy).toEqual(ped);
    expect(rec!.kidId).toBe('kid-1');
    expect(rec!.draftId).toBe('draft-1');
  });

  it('keeps overrides scoped per (kidId, draftId)', async () => {
    await store.setPedagogy('kid-1', 'draft-1', { rhymeDensityPct: 70 });
    await store.setPedagogy('kid-1', 'draft-2', { rhymeDensityPct: 30 });
    await store.setPedagogy('kid-2', 'draft-1', { rhymeDensityPct: 10 });
    expect((await store.getOverrides('kid-1', 'draft-1'))!.pedagogy!.rhymeDensityPct).toBe(70);
    expect((await store.getOverrides('kid-1', 'draft-2'))!.pedagogy!.rhymeDensityPct).toBe(30);
    expect((await store.getOverrides('kid-2', 'draft-1'))!.pedagogy!.rhymeDensityPct).toBe(10);
  });
});

describe('AdvancedOverrideStore — wish + render', () => {
  it('persists wish and render alongside pedagogy without clobbering', async () => {
    const ped: PedagogyOverride = { rhymeDensityPct: 60 };
    const wish: WishEngineering = {
      multiAuthorByline: ['Mom', 'Grandma Patty'],
      customInscription: 'For our brave Eli, who never stops asking why.',
      inscriptionEffect: 'rise',
    };
    const render: RenderDirection = {
      perBeat: [{ beatId: 4, textEffect: 'magnetic', paletteAccent: 'cinematic-teal-orange' }],
      perSpread: [{ spreadIndex: 8, camera: 'tight-on-hero', lighting: 'golden-hour' }],
    };
    await store.setPedagogy('kid-1', 'draft-1', ped);
    await store.setWish('kid-1', 'draft-1', wish);
    await store.setRender('kid-1', 'draft-1', render);
    const rec = await store.getOverrides('kid-1', 'draft-1');
    expect(rec!.pedagogy).toEqual(ped);
    expect(rec!.wish).toEqual(wish);
    expect(rec!.render).toEqual(render);
  });
});

describe('AdvancedOverrideStore — kid-cascade delete', () => {
  it('deletes every override for a given kid', async () => {
    await store.setPedagogy('kid-1', 'draft-1', { rhymeDensityPct: 70 });
    await store.setPedagogy('kid-1', 'draft-2', { rhymeDensityPct: 30 });
    await store.setPedagogy('kid-2', 'draft-1', { rhymeDensityPct: 10 });

    const n = await store.deleteAllForKid('kid-1');
    expect(n).toBe(2);

    expect(await store.getOverrides('kid-1', 'draft-1')).toBeNull();
    expect(await store.getOverrides('kid-1', 'draft-2')).toBeNull();
    expect(await store.getOverrides('kid-2', 'draft-1')).not.toBeNull();
  });

  it('lists overrides for a kid in storage order', async () => {
    await store.setPedagogy('kid-9', 'draft-a', { rhymeDensityPct: 1 });
    await store.setPedagogy('kid-9', 'draft-b', { rhymeDensityPct: 2 });
    await store.setPedagogy('kid-9', 'draft-c', { rhymeDensityPct: 3 });
    const recs = await store.listForKid('kid-9');
    expect(recs).toHaveLength(3);
    const densities = recs.map((r) => r.pedagogy?.rhymeDensityPct).sort();
    expect(densities).toEqual([1, 2, 3]);
  });
});

describe('AdvancedOverrideStore — singleton override workflow', () => {
  it('updates monotonically — later setPedagogy replaces earlier value', async () => {
    await store.setPedagogy('kid-1', 'draft-1', { rhymeDensityPct: 10 });
    await store.setPedagogy('kid-1', 'draft-1', { rhymeDensityPct: 90, font: 'andika' });
    const rec = await store.getOverrides('kid-1', 'draft-1');
    expect(rec!.pedagogy!.rhymeDensityPct).toBe(90);
    expect(rec!.pedagogy!.font).toBe('andika');
  });
});
