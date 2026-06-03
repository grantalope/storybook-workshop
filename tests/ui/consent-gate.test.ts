// @graph-layer: private
// tests/ui/consent-gate.test.ts
//
// Pure unit test on the ConsentGate predicate via isStationSatisfied('s6').
// Validates the dual-checkbox invariant without needing Svelte render.

import { describe, expect, it } from 'vitest';
import { isStationSatisfied } from '$lib/workshop/services/WorkshopOrchestrator';
import type { Station6Output } from '$lib/workshop/types';

function s6(reviewedSpreads: boolean, understandsNonRefundable: boolean): Station6Output {
	return {
		bookShortcode: 'X',
		pdfBlobSize: 1,
		pdfHash: 'h',
		consent: {
			reviewedSpreads,
			understandsNonRefundable,
			pdfHash: 'h',
			timestampMs: 0,
		},
	};
}

describe('ConsentGate — Station 6 invariant', () => {
	it('blocks when neither box checked', () => {
		expect(isStationSatisfied('s6', { s6: s6(false, false) })).toBe(false);
	});
	it('blocks when only reviewedSpreads checked', () => {
		expect(isStationSatisfied('s6', { s6: s6(true, false) })).toBe(false);
	});
	it('blocks when only understandsNonRefundable checked', () => {
		expect(isStationSatisfied('s6', { s6: s6(false, true) })).toBe(false);
	});
	it('allows when both checked', () => {
		expect(isStationSatisfied('s6', { s6: s6(true, true) })).toBe(true);
	});
	it('blocks when s6 output entirely absent', () => {
		expect(isStationSatisfied('s6', {})).toBe(false);
	});
});
