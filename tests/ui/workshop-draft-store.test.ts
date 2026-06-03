// @graph-layer: private
// tests/ui/workshop-draft-store.test.ts

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IdbKeyValueStore } from '$lib/workshop/advanced/services/IdbKeyValueStore';
import { WorkshopDraftStore } from '$lib/workshop/services/WorkshopDraftStore';
import { DRAFT_TTL_MS, type WorkshopDraft } from '$lib/workshop/types';

function freshStore(): WorkshopDraftStore {
	// Each test gets a unique IDB to avoid cross-pollination.
	const dbName = `swt-drafts-${crypto.randomUUID()}`;
	const idb = new IdbKeyValueStore<WorkshopDraft>(dbName, 'drafts');
	return new WorkshopDraftStore({ idb });
}

describe('WorkshopDraftStore — CRUD', () => {
	let store: WorkshopDraftStore;
	beforeEach(() => {
		store = freshStore();
	});

	it('creates a draft with default mode standard + currentStation kid-picker', async () => {
		const d = await store.create({ kidId: 'kid-1' });
		expect(d.draftId).toMatch(/^draft-/);
		expect(d.kidId).toBe('kid-1');
		expect(d.mode).toBe('standard');
		expect(d.currentStation).toBe('kid-picker');
		expect(d.outputs).toEqual({});
		expect(d.expiresAt - d.createdAt).toBe(DRAFT_TTL_MS);
	});

	it('round-trips get(draftId)', async () => {
		const d = await store.create({ kidId: 'kid-1' });
		const got = await store.get(d.draftId);
		expect(got).not.toBeNull();
		expect(got!.draftId).toBe(d.draftId);
	});

	it('update() patches station + outputs + bumps updatedAt + expiresAt', async () => {
		const d = await store.create({ kidId: 'kid-1' });
		const origUpdated = d.updatedAt;
		await new Promise((r) => setTimeout(r, 5));
		const next = await store.update(d.draftId, {
			currentStation: 's1',
			outputs: { s1: { theme: 'bedtime', occasion: 'birthday', lengthTier: 'standard', targetSpreads: 12, ehriPhase: 'partial-alphabetic' } },
		});
		expect(next.currentStation).toBe('s1');
		expect(next.outputs.s1?.theme).toBe('bedtime');
		expect(next.updatedAt).toBeGreaterThan(origUpdated);
		expect(next.expiresAt - next.updatedAt).toBe(DRAFT_TTL_MS);
	});

	it('update() merges outputs instead of replacing', async () => {
		const d = await store.create({ kidId: 'kid-1' });
		await store.update(d.draftId, {
			outputs: { s1: { theme: 'bedtime', occasion: 'birthday', lengthTier: 'standard', targetSpreads: 12, ehriPhase: 'partial-alphabetic' } },
		});
		const after = await store.update(d.draftId, {
			outputs: { s2: { pillarId: 'pillar-7' } },
		});
		expect(after.outputs.s1?.theme).toBe('bedtime');
		expect(after.outputs.s2?.pillarId).toBe('pillar-7');
	});

	it('update() throws for unknown draftId', async () => {
		await expect(store.update('missing', { currentStation: 's1' })).rejects.toThrow(
			/draftId not found/,
		);
	});

	it('delete() removes the draft', async () => {
		const d = await store.create({ kidId: 'kid-1' });
		await store.delete(d.draftId);
		expect(await store.get(d.draftId)).toBeNull();
	});

	it('listForKid filters by kidId, sorts newest-first', async () => {
		const a = await store.create({ kidId: 'kid-a' });
		await new Promise((r) => setTimeout(r, 3));
		const b = await store.create({ kidId: 'kid-a' });
		await store.create({ kidId: 'kid-b' });
		const aDrafts = await store.listForKid('kid-a');
		expect(aDrafts.map((d) => d.draftId)).toEqual([b.draftId, a.draftId]);
	});
});

describe('WorkshopDraftStore — TTL purge', () => {
	it('purgeExpired removes drafts whose expiresAt <= now', async () => {
		const store = freshStore();
		const d1 = await store.create({ kidId: 'kid-a' });
		const d2 = await store.create({ kidId: 'kid-a' });
		// Fast-forward simulated "now" beyond d1's expiry
		const farFuture = d1.expiresAt + 1;
		const purged = await store.purgeExpired(farFuture);
		expect(purged).toBeGreaterThanOrEqual(2);
		expect(await store.get(d1.draftId)).toBeNull();
		expect(await store.get(d2.draftId)).toBeNull();
	});

	it('listAll auto-purges TTL-expired entries', async () => {
		const store = freshStore();
		const d = await store.create({ kidId: 'kid-a' });
		const all1 = await store.listAll();
		expect(all1.find((x) => x.draftId === d.draftId)).toBeTruthy();

		const future = d.expiresAt + 1;
		const all2 = await store.listAll(future);
		expect(all2.find((x) => x.draftId === d.draftId)).toBeUndefined();
	});
});

describe('WorkshopDraftStore — cascade delete', () => {
	it('deleteAllForKid removes only that kid s drafts and returns count', async () => {
		const store = freshStore();
		await store.create({ kidId: 'kid-a' });
		await store.create({ kidId: 'kid-a' });
		await store.create({ kidId: 'kid-b' });
		const removed = await store.deleteAllForKid('kid-a');
		expect(removed).toBe(2);
		const remaining = await store.listAll();
		expect(remaining).toHaveLength(1);
		expect(remaining[0].kidId).toBe('kid-b');
	});
});
