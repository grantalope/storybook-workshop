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

import type { AssembledBook } from '$lib/services/assemble/types';
import type { SceneTree } from '$lib/services/author/types';

/**
 * The book generated in Station 6 this session: its REAL pdf/epub blobs +
 * SceneTree, so Station 7 can offer the actual PDF download (not a metadata
 * stub) and a read-along of the just-made book. In-memory only — the create
 * flow runs Station 6 -> 7 in one session; a reload before Station 7 loses it
 * and the digital download degrades to the stub.
 */
export interface GeneratedBook {
	shortcode: string;
	title: string;
	pdfBlob: Blob;
	epubBlob: Blob;
	tree: SceneTree;
}
export const generatedBookStore: Writable<GeneratedBook | null> = writable(null);

/** Surface AssembledBook so callers importing GeneratedBook can adapt from it. */
export type { AssembledBook };
