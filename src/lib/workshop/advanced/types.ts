// @graph-layer: private
// @rationale: private (per-user / per-kid storybook overrides — never leaves device)

// src/routes/dashboard/storybook-workshop/advanced/types.ts
//
// Canonical type surface for Storybook Workshop Advanced Mode.
// Goal: docs/superpowers/goals/2026-05-24-storybook-workshop-advanced-mode.md
// Spec: docs/superpowers/specs/2026-05-24-storybook-workshop-design.md §7.6
//
// All shapes are JSON-portable so IDB serialization is trivial.

import type {
  AgeBand,
  EhriPhase,
  BeatId,
  DialogicPromptType,
} from '$lib/services/author/types';

// ─── Mode toggle ────────────────────────────────────────────────────────────

/**
 * The persisted advanced-mode preference (per parent / per device).
 * Stored in IDB under `workshop-advanced-mode-flag-v1`.
 */
export interface AdvancedModeFlag {
  enabled: boolean;
  updatedAt: number;
}

// ─── Station 1.5 — Pedagogy Override ────────────────────────────────────────

/** Dialogic prompt density mode (§7.6). */
export type DialogicPromptDensity = 'dense' | 'sparse' | 'off';

/** Story-grammar enforcement strictness (§7.6). */
export type StoryGrammarEnforcement = 'strict' | 'loose' | 'off';

/** 5 curated kid-friendly fonts (§7.6 Phase 2). */
export type FontChoice =
  | 'andika' // kid-readable sans (SIL)
  | 'atkinson-hyperlegible' // Atkinson Hyperlegible (Braille Institute)
  | 'lexend' // Lexend Deca (Microsoft Research, hyperlegible)
  | 'kosugi-maru' // Kosugi Maru (rounded geometric)
  | 'opendyslexic'; // OpenDyslexic (legacy, weighted base)

/**
 * Per-`(kidId, draftId)` pedagogy overrides. Every knob is optional —
 * unset means StoryAuthorService runs its default auto-tune cascade.
 *
 * Persisted in `AdvancedOverrideStore` IDB.
 */
export interface PedagogyOverride {
  /** Override the Ehri-phase from S1 self-assessment. */
  ehriPhase?: EhriPhase;
  /** Override the sentence-length cap (words). Tightens default age caps. */
  sentenceLengthCapWords?: number;
  /** Locked Tier-2 word list for this kid's series (case-insensitive). */
  tier2WordLockList?: string[];
  /** Rhyme density 0..100 (percent). */
  rhymeDensityPct?: number;
  /** Dialogic prompt density (global override; per-beat tunable below). */
  dialogicDensity?: DialogicPromptDensity;
  /** Per-beat override for dialogic prompt type. */
  perBeatDialogicType?: Partial<Record<BeatId, DialogicPromptType>>;
  /** Story-grammar validator strictness. */
  storyGrammarEnforcement?: StoryGrammarEnforcement;
  /** Spacing in px between letters. Marinus 2016 spacing knob. */
  letterSpacingPx?: number;
  /** Leading in px (line-height absolute). */
  leadingPx?: number;
  /** Font choice override. */
  font?: FontChoice;
}

// ─── Station 3.5 — Wish Engineering ─────────────────────────────────────────

/** One audio recording slot. Multiple voices per book (parent/grandma/sibling). */
export interface MultiRecordingSlot {
  /** Free-text role label ("Mom", "Grandma Patty", "Big Brother Eli"). */
  role: string;
  /** Opaque ref to the audio blob (e.g., IDB key or session blob URL). */
  blobRef: string;
  /** Duration in seconds. Hard cap 30s per slot. */
  durationSec: number;
}

/**
 * Wish-engineering payload. All fields optional — unset means S3 defaults.
 */
export interface WishEngineering {
  /** Multi-voice recordings (≤30s each). */
  multiRecordings?: MultiRecordingSlot[];
  /** Public-domain audio track ref (parent-uploaded music). */
  audioTrackBlobRef?: string;
  /** Disclaimer accepted (public-domain only). */
  audioTrackDisclaimerAccepted?: boolean;
  /** Custom inscription text (overrides S3 dedication). */
  customInscription?: string;
  /** PreText effect mode applied to the inscription. */
  inscriptionEffect?: PreTextEffectMode;
  /** Multi-author byline (e.g., ["Mom", "Grandma Patty"]). */
  multiAuthorByline?: string[];
}

// ─── Station 5.5 — Render Direction ─────────────────────────────────────────

/** 12 PreText typography effect modes (§7.5). */
export type PreTextEffectMode =
  | 'flow'
  | 'bounce'
  | 'wave'
  | 'magnetic'
  | 'glitch'
  | 'dragon'
  | 'rise'
  | 'scatter'
  | 'orbit'
  | 'gravity'
  | 'vortex'
  | 'parting-water';

/** 6 camera framings per spread (§7.6 Phase 4). */
export type CameraFraming =
  | 'establishing'
  | 'pan'
  | 'follow'
  | 'tight-on-hero'
  | 'reveal'
  | 'wide-shot';

/** 6 lighting directions per spread. */
export type LightingDirection =
  | 'warm-front'
  | 'cool-side'
  | 'dramatic-back'
  | 'golden-hour'
  | 'moonlight'
  | 'firelit';

/** 6 pillar poses (passed to WB scene as pose-recipe ID). */
export type PillarPose =
  | 'sitting'
  | 'running'
  | 'reading'
  | 'sleeping'
  | 'dancing'
  | 'climbing';

/** 5 palette accents per beat. */
export type PaletteAccent =
  | 'warm-gold'
  | 'cool-blue'
  | 'cinematic-teal-orange'
  | 'muted-pastels'
  | 'vivid-primary';

/** 4 sidekick settler positions per spread. */
export type SidekickPosition =
  | 'left'
  | 'right'
  | 'behind'
  | 'off-page-narrating';

/**
 * Per-spread render direction override.
 * `spreadIndex` matches `Spread.spreadIndex` in author types.
 */
export interface PerSpreadDirection {
  spreadIndex: number;
  camera?: CameraFraming;
  lighting?: LightingDirection;
  pillarPose?: PillarPose;
  sidekickPosition?: SidekickPosition;
}

/**
 * Per-beat render direction override.
 */
export interface PerBeatDirection {
  beatId: BeatId;
  textEffect?: PreTextEffectMode;
  paletteAccent?: PaletteAccent;
}

/**
 * Render-direction payload. Sparse: only entries that the parent actually
 * touched in S5.5 land here. Story-author + WB consult this before scene calls.
 */
export interface RenderDirection {
  perBeat?: PerBeatDirection[];
  perSpread?: PerSpreadDirection[];
}

// ─── Combined override record ───────────────────────────────────────────────

/**
 * The full override blob persisted per `(kidId, draftId)`.
 * Each section is optional; unset means defaults from upstream stations.
 */
export interface AdvancedOverrideRecord {
  kidId: string;
  draftId: string;
  pedagogy?: PedagogyOverride;
  wish?: WishEngineering;
  render?: RenderDirection;
  updatedAt: number;
}

// ─── Diff snapshot ──────────────────────────────────────────────────────────

/**
 * One snapshot per redo at S6. Stored hashes (not raw bytes) so IDB stays small.
 */
export interface DiffSnapshot {
  /** Snapshot id (uuid-style). */
  id: string;
  draftId: string;
  kidId: string;
  /** Monotonically increasing version per-draft. */
  version: number;
  createdAt: number;
  /** Full SceneTree JSON (storage allowance per-draft ~300kb). */
  sceneTreeJson: string;
  /** WB scene PNG hashes (sha-256 hex). */
  wbSceneHashes: string[];
  /** Composite hashes (sha-256 hex). */
  compositeHashes: string[];
  /** Optional user-applied label (e.g., "before adding rhyme"). */
  label?: string;
}

// ─── Pedagogy telemetry ─────────────────────────────────────────────────────

/**
 * Per-book pedagogy metadata. Aggregator computes from SceneTree + grammar
 * + calibration results at S6.
 */
export interface PedagogyTelemetry {
  bookId: string;
  kidId: string;
  createdAt: number;
  tier2WordsActual: string[];
  /** Sentence length histogram: bin -> count. */
  sentenceLengthHist: Record<number, number>;
  ehriPhase: EhriPhase;
  ageBand: AgeBand;
  rhymeDensityPct: number;
  dialogicPromptCount: number;
  storyGrammarPassCount: number;
  storyGrammarTotalChecks: number;
  /** Time-to-author + time-to-render in ms. */
  renderTimingMs?: {
    storyAuthorMs?: number;
    wbScenesMs?: number;
    compositeMs?: number;
    totalMs?: number;
  };
}

export interface KidPedagogyReport {
  kidId: string;
  bookCount: number;
  /** Cumulative unique Tier-2 word coverage. */
  uniqueTier2Words: number;
  /** Mean dialogic prompts per book. */
  meanDialogicPromptsPerBook: number;
  /** Story-grammar pass-rate aggregate (0..1). */
  storyGrammarPassRate: number;
  /** Per-phase book counts. */
  ehriPhaseBreakdown: Partial<Record<EhriPhase, number>>;
}

// ─── Station-flow contract (UI-shell stub) ──────────────────────────────────

/**
 * Minimal type-only stub for the orchestrator station enum. The real shell
 * (goal #6) will publish a richer interface; we define the bare contract here
 * so this goal compiles standalone. When ui-shell merges, this gets reconciled.
 */
export type StationId =
  | 's1'
  | 's1.5'
  | 's2'
  | 's3'
  | 's3.5'
  | 's4'
  | 's5'
  | 's5.5'
  | 's6'
  | 's7';

export interface StationFlow {
  stations: StationId[];
  totalSteps: number;
}
