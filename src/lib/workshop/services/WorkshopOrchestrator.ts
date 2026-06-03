// @graph-layer: private
// @rationale: private (per-user UX state machine)

// src/lib/workshop/services/WorkshopOrchestrator.ts
//
// Forward-only state machine for the 7-station Build-a-Bear flow.
//   States: kid-picker | s1 | s2 | s3 | s4 | s5 | s6 | s7 | library
//   Allowed transitions:
//     advance(): index += 1 ONLY when current station satisfied + outputs present
//     back():    index -= 1 (back-arrow); blocked at kid-picker
//     jumpBackTo(target): allowed only if target < current
//
// Tests: workshop-orchestrator.test.ts.

import type { WorkshopDraftStore } from './WorkshopDraftStore';
import {
	STATION_ORDER,
	type StationId,
	type StationOutputs,
	type WorkshopDraft,
} from '$lib/workshop/types';

export class WorkshopAdvanceError extends Error {
	constructor(public readonly reason: string) {
		super(`Cannot advance: ${reason}`);
		this.name = 'WorkshopAdvanceError';
	}
}

export class WorkshopNavError extends Error {
	constructor(public readonly reason: string) {
		super(`Nav error: ${reason}`);
		this.name = 'WorkshopNavError';
	}
}

function indexOf(s: StationId): number {
	return STATION_ORDER.indexOf(s);
}

/** Validates whether a station has been satisfied (outputs present). */
export function isStationSatisfied(station: StationId, outputs: StationOutputs): boolean {
	switch (station) {
		case 'kid-picker':
			return true; // satisfied by selecting a kid (orchestrator construction)
		case 's1':
			return !!outputs.s1 && outputs.s1.targetSpreads > 0;
		case 's2':
			return !!outputs.s2 && !!outputs.s2.pillarId;
		case 's3':
			return !!outputs.s3 && outputs.s3.dedicationText.trim().length > 0;
		case 's4':
			return (
				!!outputs.s4 &&
				outputs.s4.heroName.trim().length > 0 &&
				outputs.s4.sidekickSettlerId.length > 0
			);
		case 's5':
			return !!outputs.s5 && !!outputs.s5.artStyle;
		case 's6':
			return (
				!!outputs.s6 &&
				outputs.s6.consent.reviewedSpreads &&
				outputs.s6.consent.understandsNonRefundable
			);
		case 's7':
			return true; // terminal action UX, not a gated output
		case 'library':
			return true;
		default:
			return false;
	}
}

export class WorkshopOrchestrator {
	constructor(
		private readonly draftStore: WorkshopDraftStore,
		public draft: WorkshopDraft,
	) {}

	get currentStation(): StationId {
		return this.draft.currentStation;
	}
	get currentIndex(): number {
		return indexOf(this.draft.currentStation);
	}

	async advance(): Promise<WorkshopDraft> {
		const cur = this.draft.currentStation;
		if (!isStationSatisfied(cur, this.draft.outputs)) {
			throw new WorkshopAdvanceError(`station ${cur} not satisfied`);
		}
		const i = indexOf(cur);
		if (i < 0 || i >= STATION_ORDER.length - 1) {
			throw new WorkshopAdvanceError(`already at terminal: ${cur}`);
		}
		const next = STATION_ORDER[i + 1];
		this.draft = await this.draftStore.update(this.draft.draftId, {
			currentStation: next,
		});
		return this.draft;
	}

	async back(): Promise<WorkshopDraft> {
		const i = this.currentIndex;
		if (i <= 0) {
			throw new WorkshopNavError(`cannot back from ${this.draft.currentStation}`);
		}
		const prev = STATION_ORDER[i - 1];
		this.draft = await this.draftStore.update(this.draft.draftId, {
			currentStation: prev,
		});
		return this.draft;
	}

	/** Jump back only — forward jumps are forbidden. */
	async jumpBackTo(target: StationId): Promise<WorkshopDraft> {
		const targetIdx = indexOf(target);
		if (targetIdx < 0) throw new WorkshopNavError(`unknown station: ${target}`);
		if (targetIdx > this.currentIndex) {
			throw new WorkshopNavError(`forward jump forbidden: ${this.draft.currentStation} → ${target}`);
		}
		this.draft = await this.draftStore.update(this.draft.draftId, {
			currentStation: target,
		});
		return this.draft;
	}

	async saveOutput<K extends keyof StationOutputs>(
		key: K,
		value: NonNullable<StationOutputs[K]>,
	): Promise<WorkshopDraft> {
		this.draft = await this.draftStore.update(this.draft.draftId, {
			outputs: { [key]: value } as StationOutputs,
		});
		return this.draft;
	}
}
