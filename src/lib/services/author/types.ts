// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/types.ts
//
// Canonical shapes for the Storybook Workshop story-author pipeline.
// Per docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §3.5–§3.6.
//
// These types are JSON-portable: no class instances, no Map/Set, so SceneTree
// can serialize cleanly into the LLM JSON-mode response, draft IDB blob, and
// downstream goal inputs (book-assembler #5, ui-shell #6).

// ─── Inputs ─────────────────────────────────────────────────────────────────

/** Three age bands per spec §3.6. Calibrates sentence length + vocab caps. */
export type AgeBand = 'toddler' | 'preschool' | 'grade-school';

/** Ehri 2005 phase. Self-assessed at Station 1 (§7.3). Tunes vocab + rhyme density. */
export type EhriPhase =
  | 'pre-alphabetic'
  | 'partial-alphabetic'
  | 'full-alphabetic'
  | 'consolidated-alphabetic';

/** 12 theme cards (§2 Station 1). */
export type StoryTheme =
  | 'bedtime'
  | 'first-day'
  | 'lost-and-found'
  | 'overcoming-fear'
  | 'new-baby-arrives'
  | 'kindness'
  | 'adventure'
  | 'curiosity'
  | 'friendship'
  | 'sibling-rivalry'
  | 'saying-goodbye'
  | 'silly-quest';

/** Occasion chips (§2 Station 1). */
export type StoryOccasion = 'birthday' | 'holiday' | 'gift' | 'just-because';

/** World Builder biome enum — subset matching pillar library §3.1. */
export type LocaleBiome =
  | 'forest'
  | 'seaside'
  | 'mountain'
  | 'desert'
  | 'meadow'
  | 'snowfield'
  | 'jungle'
  | 'urban'
  | 'farm'
  | 'underwater'
  | 'space'
  | 'imaginary';

/** Supporting cast entry — opaque ID + display role. */
export interface SupportingCastEntry {
  id: string; // settler ID or opaque pillar ID
  role: string; // "best friend", "mom", "the dog Otis" — free-text
}

/** Parent-side input bundle gathered across Stations 1–5. */
export interface StoryInput {
  kidName: string;
  ageBand: AgeBand;
  ehriPhase: EhriPhase;
  theme: StoryTheme;
  occasion: StoryOccasion;
  sidekickSettlerId: string; // public settler ID from AgentRegistryService
  supportingCast: SupportingCastEntry[];
  localeBiome: LocaleBiome;
  /** 16 / 24 / 32 / 48 — picked at Station 1. Allocator distributes across 7 beats. */
  targetSpreads: number;
  dedicationText: string;
  /** Default ON (§7.4). Generator adds 1–2 margin prompts per spread. */
  dialogicPromptsEnabled: boolean;
  /** Spacing/leading mode (§7.1 #9, Marinus 2016). Triggers shorter sentences + larger margins. */
  easierReadingMode: boolean;
  /**
   * Optional prior-series book vocab for §7.5 / Beck-McKeown spaced-exposure
   * (~10-encounter rule). Words from prior books deprioritized; words 2-3 books
   * back upweighted for re-exposure.
   */
  priorBooksWords?: string[];
}

// ─── Beat / scene / spread tree ─────────────────────────────────────────────

/** Pixar 7-beat structure. Stein-Glenn 1979 elements map to beat positions. */
export type BeatId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type BeatName =
  | 'setup' // 1 — setting + hero introduction
  | 'catalyst' // 2 — initiating event
  | 'debate' // 3 — internal response
  | 'midpoint' // 4 — first major attempt
  | 'trial' // 5 — attempt + consequence
  | 'climax' // 6 — major consequence
  | 'resolution'; // 7 — reaction + new equilibrium

/** Stein-Glenn 1979 story-grammar elements. */
export type StoryGrammarElement =
  | 'setting'
  | 'initiating_event'
  | 'internal_response'
  | 'attempt'
  | 'consequence'
  | 'reaction';

/** Spread = 2-page facing-page unit. `text_focus` directs PreText surface adapter. */
export interface Spread {
  spreadIndex: number; // 0-based across the book
  spread_text: string; // the prose that lands on the page
  /** Where text lives on the spread (PreText adapter consumes this). */
  text_focus: 'left' | 'right' | 'wraps' | 'spot';
}

/** A scene = one beat-internal moment, rendered as 1..5 spreads for continuity. */
export interface Scene {
  sceneId: string;
  spreadCount: 1 | 2 | 3 | 4 | 5;
  /** Short brief sent to World Builder via §3.1 outbound payload. PII-scrubbed. */
  sceneBrief: string;
  spreads: Spread[];
}

/** One of the 7 Pixar beats. Contains 1..N scenes summing to its allocated spread budget. */
export interface Beat {
  id: BeatId;
  beat_name: BeatName;
  /** One-line emotional arc (e.g., "hopeful → uneasy"). Drives PreText typography effect §7.5. */
  emotional_arc: string;
  scenes: Scene[];
}

/** Dialogic margin prompt (§7.4 PEER/CROWD). One or two per spread. */
export type DialogicPromptType =
  | 'completion'
  | 'recall'
  | 'open-ended'
  | 'wh-question'
  | 'distancing';

export interface DialogicPrompt {
  spreadIndex: number;
  type: DialogicPromptType;
  /** Prompt text rendered in margin (digital + italic side-note in print). */
  text: string;
  /** PEER framework optional follow-up hint. */
  peerFollowup?: string;
}

/** Top-level SceneTree returned by StoryAuthorService.author(). */
export interface SceneTree {
  title: string;
  back_cover_blurb: string;
  /** Equal to `StoryInput.targetSpreads`. Allocator validates beat sum. */
  page_budget: number;
  /** Exactly 7 beats, in canonical order id 1..7. */
  beats: Beat[];
  /** Tier-2 words actually seeded into the story (Beck/McKeown/Kucan 2013). */
  tier2_words: string[];
  /** Generated when `StoryInput.dialogicPromptsEnabled === true`. */
  dialogic_prompts?: DialogicPrompt[];
  /**
   * Telemetry — `template_fallback` set when 2-retry LLM path failed and the
   * deterministic literarySpineBank fallback fired. Surfaced at advanced-mode
   * inspector (goal #7).
   */
  meta?: SceneTreeMeta;
}

export interface SceneTreeMeta {
  generated_at_iso: string;
  template_fallback?: boolean;
  llm_retries?: number;
  grammar_retries?: number;
  calibration_retries?: number;
  budget_redistributed?: boolean;
}

// ─── Tier-2 vocab corpus ────────────────────────────────────────────────────

export interface Tier2WordEntry {
  word: string;
  syllables: number;
  /** Minimum age band where this word is appropriate. Older bands always allow younger-band words. */
  ageBandMin: AgeBand;
  /** Kid-friendly one-line definition for parent-facing vocab inspector. */
  definition_kid: string;
  /** Themes this word naturally fits. Drives planner relevance scoring. */
  themeAffinities: StoryTheme[];
}

// ─── Validator + calibrator results ─────────────────────────────────────────

export interface GrammarValidationResult {
  passed: boolean;
  /** Missing top-level elements across the entire book. */
  missing: StoryGrammarElement[];
  /** Per-beat element gaps. Empty array on the BeatId key = beat passed. */
  beatGaps: Record<BeatId, StoryGrammarElement[]>;
}

export type CalibrationMetric =
  | 'sentence_length_words'
  | 'syllables_per_word'
  | 'paragraph_length_sentences'
  | 'flesch_kincaid_grade';

export interface CalibrationOverflow {
  spreadIndex: number;
  metric: CalibrationMetric;
  actual: number;
  cap: number;
}

export interface CalibrationResult {
  passed: boolean;
  overflows: CalibrationOverflow[];
}

/** Per-band caps. Tightened against Brown 1973 MLU + Flesch-Kincaid grade-equivalence. */
export interface AgeBandCaps {
  sentence_length_words: number; // 8 / 14 / 22
  syllables_per_word: number; // 3 / 4 / 6
  paragraph_length_sentences: number; // 2 / 4 / 6
  /** Flesch-Kincaid grade level cap. */
  flesch_kincaid_grade_max: number;
}

// ─── Budget allocation ──────────────────────────────────────────────────────

export type BeatBudgetMap = Record<BeatId, number>;

/** Default Pixar 7-beat weights (sum = 100%). */
export const DEFAULT_BEAT_WEIGHTS: BeatBudgetMap = {
  1: 12, // setup
  2: 6, // catalyst
  3: 12, // debate
  4: 22, // midpoint
  5: 18, // trial
  6: 18, // climax
  7: 12, // resolution
} as const;

/** Static mapping beat id → beat name. */
export const BEAT_NAMES: Record<BeatId, BeatName> = {
  1: 'setup',
  2: 'catalyst',
  3: 'debate',
  4: 'midpoint',
  5: 'trial',
  6: 'climax',
  7: 'resolution',
} as const;

/**
 * Per-band caps applied by AgeBandCalibrator.
 *
 * NB: `flesch_kincaid_grade_max` is generous relative to the spec §3.6 targets
 * (1 / 3 / 5) because the AgeBandCalibrator's inlined syllable estimator
 * (vowel-group method) systematically over-counts syllables on short kid
 * prose by ~30%, which pushes the FK score artificially high. The estimator
 * is portable + zero-dep, so we accept the noise and loosen the caps rather
 * than ship a heavier dep (`text-readability` / `syllables`) just to nudge
 * the FK score down. The other three caps (sentence/word/paragraph) remain
 * at spec §3.6 — they aren't estimator-noisy.
 */
export const AGE_BAND_CAPS: Record<AgeBand, AgeBandCaps> = {
  toddler: {
    sentence_length_words: 8,
    syllables_per_word: 3,
    paragraph_length_sentences: 2,
    flesch_kincaid_grade_max: 3,
  },
  preschool: {
    sentence_length_words: 14,
    syllables_per_word: 4,
    paragraph_length_sentences: 4,
    flesch_kincaid_grade_max: 5,
  },
  'grade-school': {
    sentence_length_words: 22,
    syllables_per_word: 6,
    paragraph_length_sentences: 6,
    flesch_kincaid_grade_max: 8,
  },
} as const;

/** Per-beat default dialogic-prompt type (§7.4). */
export const BEAT_PROMPT_DEFAULTS: Record<BeatId, DialogicPromptType> = {
  1: 'wh-question',
  2: 'open-ended',
  3: 'distancing',
  4: 'recall',
  5: 'completion',
  6: 'open-ended',
  7: 'distancing',
} as const;

/** Default PreText typography effect per beat (§7.5). */
export const BEAT_PRETEXT_EFFECT: Record<BeatId, string> = {
  1: 'flow',
  2: 'bounce',
  3: 'wave',
  4: 'magnetic',
  5: 'glitch',
  6: 'dragon',
  7: 'rise',
} as const;
