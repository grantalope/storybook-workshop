// @graph-layer: shared
// @rationale: constant citation text — no PII, no remote source

// src/routes/dashboard/storybook-workshop/advanced/PedagogyCitations.ts
//
// Static citations for each Station 1.5 pedagogy control.
// Source-of-truth list per goal Phase 2.

export interface PedagogyCitation {
  /** Knob identifier used by Station 1.5 controls. */
  knobId:
    | 'ehriPhase'
    | 'sentenceLengthCap'
    | 'tier2WordLock'
    | 'rhymeDensity'
    | 'dialogicDensity'
    | 'storyGrammar'
    | 'spacing'
    | 'leading'
    | 'font';
  /** Display label for the knob. */
  label: string;
  /** Citation text (rendered under the knob). */
  citation: string;
}

export const PEDAGOGY_CITATIONS: Record<PedagogyCitation['knobId'], PedagogyCitation> = {
  ehriPhase: {
    knobId: 'ehriPhase',
    label: 'Ehri reading phase',
    citation: 'Ehri 2005 — modern consensus reading-acquisition model.',
  },
  sentenceLengthCap: {
    knobId: 'sentenceLengthCap',
    label: 'Sentence length cap (words)',
    citation: 'Brown 1973 MLU norms — 4yo ~5–8 words, 7yo ~10–14.',
  },
  tier2WordLock: {
    knobId: 'tier2WordLock',
    label: 'Tier-2 word lock list',
    citation: 'Beck, McKeown & Kucan 2013 — Tier-2 vocabulary framework.',
  },
  rhymeDensity: {
    knobId: 'rhymeDensity',
    label: 'Rhyme density',
    citation: 'Bryant et al. 1990 — rhyme sensitivity at 3y predicts reading at 6y.',
  },
  dialogicDensity: {
    knobId: 'dialogicDensity',
    label: 'Dialogic prompt density',
    citation: 'Whitehurst 1988 — medium-large oral-language effect.',
  },
  storyGrammar: {
    knobId: 'storyGrammar',
    label: 'Story-grammar enforcement',
    citation: 'Stein & Glenn 1979 — structured narratives recalled better.',
  },
  spacing: {
    knobId: 'spacing',
    label: 'Letter spacing',
    citation: 'Marinus et al. 2016 — spacing is the active ingredient (not OpenDyslexic font).',
  },
  leading: {
    knobId: 'leading',
    label: 'Line height (leading)',
    citation: 'Marinus et al. 2016 — increased leading reduces visual crowding.',
  },
  font: {
    knobId: 'font',
    label: 'Font',
    citation: 'Atkinson Hyperlegible (Braille Institute, 2019) — disambiguates similar glyphs.',
  },
};

export const PEDAGOGY_CITATION_LIST: PedagogyCitation[] = Object.values(PEDAGOGY_CITATIONS);
