import { uuid } from '$lib/util/uuid';
// @graph-layer: private
// @rationale: private (per-kid workshop draft — never leaves device)

// src/lib/workshop/services/WorkshopDraftStore.ts
//
// IDB store for workshop drafts. CRUD + TTL auto-purge + kid-cascade-delete.

import { IdbKeyValueStore } from '$lib/workshop/advanced/services/IdbKeyValueStore';
import {
	DRAFT_TTL_MS,
	type StationId,
	type StationOutputs,
	type WorkshopDraft,
	type WorkshopMode,
} from '$lib/workshop/types';

const DB_NAME = 'storybook-workshop-drafts-v1';
const STORE_NAME = 'drafts';

export class WorkshopDraftStore {
	private readonly idb: IdbKeyValueStore<WorkshopDraft>;

	constructor(opts: { idb?: IdbKeyValueStore<WorkshopDraft> } = {}) {
		this.idb = opts.idb ?? new IdbKeyValueStore<WorkshopDraft>(DB_NAME, STORE_NAME);
	}

	async create(input: { kidId: string; mode?: WorkshopMode }): Promise<WorkshopDraft> {
		const now = Date.now();
		const draftId = `draft-${uuid()}`;
		const draft: WorkshopDraft = {
			draftId,
			kidId: input.kidId,
			mode: input.mode ?? 'standard',
			currentStation: 'kid-picker',
			outputs: {},
			createdAt: now,
			updatedAt: now,
			expiresAt: now + DRAFT_TTL_MS,
		};
		await this.idb.put(draftId, draft);
		return draft;
	}

	async get(draftId: string): Promise<WorkshopDraft | null> {
		return this.idb.get(draftId);
	}

	/** Lists all drafts (any kid). Auto-purges TTL-expired entries first. */
	async listAll(nowMs = Date.now()): Promise<WorkshopDraft[]> {
		await this.purgeExpired(nowMs);
		const rows = await this.idb.list();
		return rows.map((r) => r.value).sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async listForKid(kidId: string, nowMs = Date.now()): Promise<WorkshopDraft[]> {
		const all = await this.listAll(nowMs);
		return all.filter((d) => d.kidId === kidId);
	}

	async update(
		draftId: string,
		patch: {
			currentStation?: StationId;
			outputs?: StationOutputs;
			mode?: WorkshopMode;
		},
	): Promise<WorkshopDraft> {
		const existing = await this.idb.get(draftId);
		if (!existing) throw new Error(`WorkshopDraftStore.update: draftId not found: ${draftId}`);
		const now = Date.now();
		const next: WorkshopDraft = {
			...existing,
			currentStation: patch.currentStation ?? existing.currentStation,
			outputs: patch.outputs ? { ...existing.outputs, ...patch.outputs } : existing.outputs,
			mode: patch.mode ?? existing.mode,
			updatedAt: now,
			expiresAt: now + DRAFT_TTL_MS,
		};
		await this.idb.put(draftId, next);
		return next;
	}

	async delete(draftId: string): Promise<void> {
		await this.idb.delete(draftId);
	}

	/** Cascade-delete used by KidProfileStore on right-to-delete. */
	async deleteAllForKid(kidId: string): Promise<number> {
		const rows = await this.idb.list();
		const drafts = rows.map((r) => r.value).filter((d) => d.kidId === kidId);
		for (const d of drafts) await this.idb.delete(d.draftId);
		return drafts.length;
	}

	/** Sweeps and removes expired drafts. Returns count purged. */
	async purgeExpired(nowMs = Date.now()): Promise<number> {
		const rows = await this.idb.list();
		const expired = rows.filter((r) => r.value.expiresAt <= nowMs);
		for (const r of expired) await this.idb.delete(r.key);
		return expired.length;
	}

	async __TEST_clear(): Promise<void> {
		await this.idb.clear();
	}
}

let _singleton: WorkshopDraftStore | null = null;
export function getWorkshopDraftStore(): WorkshopDraftStore {
	if (!_singleton) _singleton = new WorkshopDraftStore();
	return _singleton;
}

export function __TEST_resetWorkshopDraftStore(): void {
	_singleton = null;
}
