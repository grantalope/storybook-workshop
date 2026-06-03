// @graph-layer: private
// @rationale: private (UI reactive stores wrapping orchestrator + draft + mode)

// src/lib/workshop/stores.ts
//
// Svelte stores fronting the WorkshopOrchestrator + draft + mode toggle.
// Components subscribe to these; updates flow through orchestrator methods.

import { writable, derived, get, type Readable, type Writable } from 'svelte/store';
import type { WorkshopDraft, StationId, WorkshopMode } from '$lib/workshop/types';
import type { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';

export const currentOrchestrator: Writable<WorkshopOrchestrator | null> = writable(null);

export const draftStore: Readable<WorkshopDraft | null> = derived(
	currentOrchestrator,
	(orch) => (orch ? orch.draft : null),
);

export const currentStation: Readable<StationId | null> = derived(
	draftStore,
	(d) => d?.currentStation ?? null,
);

export const workshopMode: Writable<WorkshopMode> = writable('standard');

/** Helper: re-emit the orchestrator so subscribers re-render after mutating ops. */
export function refreshOrchestrator(): void {
	const o = get(currentOrchestrator);
	if (o) currentOrchestrator.set(o);
}
