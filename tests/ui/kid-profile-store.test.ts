// @graph-layer: private
// tests/ui/kid-profile-store.test.ts

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { IdbKeyValueStore } from '$lib/workshop/advanced/services/IdbKeyValueStore';
import {
	ageBandForBirthday,
	KidProfileStore,
} from '$lib/workshop/services/KidProfileStore';
import { WorkshopDraftStore } from '$lib/workshop/services/WorkshopDraftStore';
import type { KidProfile, WorkshopDraft } from '$lib/workshop/types';

function fresh(): { kids: KidProfileStore; drafts: WorkshopDraftStore } {
	const draftsIdb = new IdbKeyValueStore<WorkshopDraft>(
		`swt-d-${crypto.randomUUID()}`,
		'drafts',
	);
	const drafts = new WorkshopDraftStore({ idb: draftsIdb });
	const kidsIdb = new IdbKeyValueStore<KidProfile>(
		`swt-k-${crypto.randomUUID()}`,
		'kids',
	);
	const kids = new KidProfileStore({
		idb: kidsIdb,
		draftCascadeDelete: (kidId) => drafts.deleteAllForKid(kidId).then(() => {}),
	});
	return { kids, drafts };
}

describe('ageBandForBirthday', () => {
	const now = new Date('2026-06-01').getTime();
	it('classifies toddler (< 4)', () => {
		expect(ageBandForBirthday('2024-01-01', now)).toBe('toddler');
	});
	it('classifies preschool (4-6)', () => {
		expect(ageBandForBirthday('2021-01-01', now)).toBe('preschool');
	});
	it('classifies grade-school (6+)', () => {
		expect(ageBandForBirthday('2018-01-01', now)).toBe('grade-school');
	});
});

describe('KidProfileStore — CRUD', () => {
	let kids: KidProfileStore;
	let drafts: WorkshopDraftStore;
	beforeEach(() => {
		({ kids, drafts } = fresh());
	});

	it('create() assigns kidId + derives ageBand', async () => {
		const k = await kids.create({
			name: 'Eli',
			birthdayIso: '2021-01-01',
			oneLineAbout: 'loves trains',
		});
		expect(k.kidId).toMatch(/^kid-/);
		expect(k.name).toBe('Eli');
		expect(k.oneLineAbout).toBe('loves trains');
		expect(['toddler', 'preschool', 'grade-school']).toContain(k.ageBand);
	});

	it('list() sorts by createdAt ascending', async () => {
		const a = await kids.create({ name: 'A', birthdayIso: '2020-01-01' });
		await new Promise((r) => setTimeout(r, 5));
		const b = await kids.create({ name: 'B', birthdayIso: '2020-01-01' });
		const out = await kids.list();
		expect(out.map((k) => k.kidId)).toEqual([a.kidId, b.kidId]);
	});

	it('update() patches fields, re-derives ageBand on birthday change', async () => {
		const k = await kids.create({ name: 'Eli', birthdayIso: '2021-01-01' });
		const updated = await kids.update(k.kidId, {
			name: 'Elias',
			birthdayIso: '2018-01-01',
		});
		expect(updated.name).toBe('Elias');
		expect(updated.ageBand).toBe('grade-school');
	});

	it('update() throws for unknown kidId', async () => {
		await expect(kids.update('missing', { name: 'X' })).rejects.toThrow(/not found/);
	});
});

describe('KidProfileStore — cascade-delete', () => {
	it('deleteKid removes the kid AND wipes drafts for that kid', async () => {
		const { kids, drafts } = fresh();
		const eli = await kids.create({ name: 'Eli', birthdayIso: '2021-01-01' });
		const ada = await kids.create({ name: 'Ada', birthdayIso: '2019-01-01' });
		await drafts.create({ kidId: eli.kidId });
		await drafts.create({ kidId: eli.kidId });
		await drafts.create({ kidId: ada.kidId });

		await kids.deleteKid(eli.kidId);

		expect(await kids.get(eli.kidId)).toBeNull();
		const eliDrafts = await drafts.listForKid(eli.kidId);
		expect(eliDrafts).toHaveLength(0);
		const adaDrafts = await drafts.listForKid(ada.kidId);
		expect(adaDrafts).toHaveLength(1);
	});
});
