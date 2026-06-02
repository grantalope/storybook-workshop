/**
 * PedagogyCitations — every knob in goal Phase 2 has a citation entry.
 */

import { describe, it, expect } from 'vitest';
import {
  PEDAGOGY_CITATIONS,
  PEDAGOGY_CITATION_LIST,
} from '$lib/workshop/advanced/PedagogyCitations';

describe('PedagogyCitations — completeness', () => {
  it('lists all 9 knobs', () => {
    expect(PEDAGOGY_CITATION_LIST).toHaveLength(9);
  });

  it('has a non-empty label and citation for every knob', () => {
    for (const c of PEDAGOGY_CITATION_LIST) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.citation.length).toBeGreaterThan(0);
    }
  });

  it('matches knob IDs from goal Phase 2', () => {
    const expected = [
      'ehriPhase',
      'sentenceLengthCap',
      'tier2WordLock',
      'rhymeDensity',
      'dialogicDensity',
      'storyGrammar',
      'spacing',
      'leading',
      'font',
    ];
    expect(Object.keys(PEDAGOGY_CITATIONS).sort()).toEqual(expected.sort());
  });

  it('references the right paper for each knob (goal Phase 2 exact mapping)', () => {
    // Spot-check the explicit citations from goal Phase 2 prose.
    expect(PEDAGOGY_CITATIONS.rhymeDensity.citation).toMatch(/Bryant/);
    expect(PEDAGOGY_CITATIONS.sentenceLengthCap.citation).toMatch(/Brown 1973/);
    expect(PEDAGOGY_CITATIONS.spacing.citation).toMatch(/Marinus/);
    expect(PEDAGOGY_CITATIONS.dialogicDensity.citation).toMatch(/Whitehurst/);
    expect(PEDAGOGY_CITATIONS.tier2WordLock.citation).toMatch(/Beck/);
    expect(PEDAGOGY_CITATIONS.storyGrammar.citation).toMatch(/Stein/);
    expect(PEDAGOGY_CITATIONS.ehriPhase.citation).toMatch(/Ehri/);
  });
});
