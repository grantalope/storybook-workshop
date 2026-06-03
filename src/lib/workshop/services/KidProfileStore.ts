// @graph-layer: private
// @rationale: private (parent kid roster — never leaves device)

// src/lib/workshop/services/KidProfileStore.ts
//
// Local IDB store for the parent's kid roster. CRUD + cascade-delete of
// drafts via WorkshopDraftStore.

import { IdbKeyValueStore } from '$lib/workshop/advanced/services/IdbKeyValueStore';
import type { KidProfile } from '$lib/workshop/types';
import type { AgeBand } from '$lib/services/author/types';

const DB_NAME = 'storybook-workshop-kids-v1';
const STORE_NAME = 'kids';

export function ageBandForBirthday(birthdayIso: string, nowMs = Date.now()): AgeBand {
	const dob = new Date(birthdayIso);
	const ageYears = (nowMs - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
	if (ageYears < 4) return 'toddler';
	if (ageYears < 6) return 'preschool';
	return 'grade-school';
}

export class KidProfileStore {
	private readonly idb: IdbKeyValueStore<KidProfile>;
	private readonly draftCascadeDelete: ((kidId: string) => Promise<void>) | null;

	constructor(opts: {
		idb?: IdbKeyValueStore<KidProfile>;
		draftCascadeDelete?: (kidId: string) => Promise<void>;
	} = {}) {
		this.idb = opts.idb ?? new IdbKeyValueStore<KidProfile>(DB_NAME, STORE_NAME);
		this.draftCascadeDelete = opts.draftCascadeDelete ?? null;
	}

	async create(input: {
		name: string;
		birthdayIso: string;
		oneLineAbout?: string;
	}): Promise<KidProfile> {
		const now = Date.now();
		const kidId = `kid-${crypto.randomUUID()}`;
		const profile: KidProfile = {
			kidId,
			name: input.name.trim(),
			birthdayIso: input.birthdayIso,
			ageBand: ageBandForBirthday(input.birthdayIso, now),
			oneLineAbout: (input.oneLineAbout ?? '').trim(),
			createdAt: now,
			updatedAt: now,
		};
		await this.idb.put(kidId, profile);
		return profile;
	}

	async get(kidId: string): Promise<KidProfile | null> {
		return this.idb.get(kidId);
	}

	async list(): Promise<KidProfile[]> {
		const rows = await this.idb.list();
		return rows
			.map((r) => r.value)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	async update(
		kidId: string,
		patch: Partial<Pick<KidProfile, 'name' | 'birthdayIso' | 'oneLineAbout'>>,
	): Promise<KidProfile> {
		const existing = await this.idb.get(kidId);
		if (!existing) throw new Error(`KidProfileStore.update: kidId not found: ${kidId}`);
		const now = Date.now();
		const next: KidProfile = {
			...existing,
			name: patch.name?.trim() ?? existing.name,
			birthdayIso: patch.birthdayIso ?? existing.birthdayIso,
			oneLineAbout: patch.oneLineAbout?.trim() ?? existing.oneLineAbout,
			ageBand: patch.birthdayIso
				? ageBandForBirthday(patch.birthdayIso, now)
				: existing.ageBand,
			updatedAt: now,
		};
		await this.idb.put(kidId, next);
		return next;
	}

	/** Right-to-delete per COPPA-K. Cascade-deletes all drafts for this kid. */
	async deleteKid(kidId: string): Promise<void> {
		if (this.draftCascadeDelete) {
			await this.draftCascadeDelete(kidId);
		}
		await this.idb.delete(kidId);
	}

	/** Test-only: clear the store. */
	async __TEST_clear(): Promise<void> {
		await this.idb.clear();
	}
}

let _singleton: KidProfileStore | null = null;
export function getKidProfileStore(): KidProfileStore {
	if (!_singleton) _singleton = new KidProfileStore();
	return _singleton;
}

export function __TEST_resetKidProfileStore(): void {
	_singleton = null;
}
