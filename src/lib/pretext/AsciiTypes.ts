// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * AsciiTypes.ts — Core types for the ASCII+ rendering engine.
 *
 * This is the CANONICAL source for AsciiCell and related types.
 * All renderers, effects engines, and scene builders should import from here.
 */

// ---------------------------------------------------------------------------
// Core Cell Type
// ---------------------------------------------------------------------------

/**
 * Structured per-cell glyph animation — matches the upstream World Builder
 * contract exactly (sveltekit-port/src/lib/game/ascii-art/AsciiArtTypes.ts).
 * `frames` are glyph frames; `fps` is the playback rate; `fgFrames` is an
 * optional per-frame foreground-color track. This is the canonical shape;
 * `WorldBuilderClient.AsciiArtCell` imports it so parsed cells preserve the
 * field instead of silently dropping it.
 */
export interface AsciiCellAnimation {
  frames: string[];      // glyph frames
  fps: number;           // playback rate
  fgFrames?: string[];   // optional per-frame foreground color track
}

/**
 * Core ASCII+ cell type — the fundamental unit of the rendering engine.
 * Every cell in every layer is an AsciiCell.
 */
export interface AsciiCell {
  glyph: string;
  fg?: string;           // foreground hex color
  bg?: string;           // background hex color
  glow?: number;         // 0-1 glow intensity
  glowColor?: string;    // optional glow tint color
  depth?: number;        // 0-1 for parallax layers
  animation?: AsciiCellAnimation;

  // Extended properties for engine rebuild
  rotation?: number;     // degrees, 0-360
  flipX?: boolean;       // horizontal mirror
  flipY?: boolean;       // vertical mirror
  emissive?: boolean;    // self-illuminating (ignores lighting pass)
  layerId?: string;      // which scene layer this cell belongs to
  opacity?: number;      // 0-1, for blend modes
  fgFrames?: string[];   // per-frame color animation (upstream parity)
  frameRate?: number;    // ms per fgFrames tick; defaults to 100ms when fgFrames present
}

/** Typed particle categories (upstream parity) */
export type ParticleType = 'rain' | 'snow' | 'fireflies' | 'ash' | 'sparks' | 'magic' | 'blood' | 'dust' | 'embers' | 'fog';

/**
 * Particle hint emitted by the upstream World Builder per `AsciiArt`. The
 * optional `region` field constrains the particle effect to a sub-rectangle
 * of the scene (e.g. fire on a forge, snow in a mountain pass) instead of
 * scattering across the full canvas. Matches the upstream
 * `sveltekit-port/src/lib/game/ascii-art/AsciiArtTypes.ts` contract exactly.
 *
 * Audit: tasks/ascii-plus-sync-2026-05-19.md §1.3. Before this type existed
 * the inline shape in `WorldBuilderClient.ts` omitted `region`, so per-region
 * hints were silently dropped on parse and degraded to full-canvas scatter.
 */
export interface ParticleHint {
  type: ParticleType;
  density: number;
  region?: { x: number; y: number; width: number; height: number };
  color?: string;
}

// ---------------------------------------------------------------------------
// Art-level metadata (upstream parity)
// ---------------------------------------------------------------------------

/** Canonical art-size buckets (upstream `AsciiArtTypes.ArtSize`). */
export type ArtSize = 'small' | 'medium' | 'large';

/**
 * Structural landmark hint attached to an `AsciiArt` payload — upstream
 * `AsciiArtTypes.AsciiArtStructure`. Carries axis-aligned bounding boxes for
 * named landmarks the upstream compositor identified inside the scene
 * (buildings, ruins, POIs). No current consumer reads these yet, but the
 * passthrough keeps the data available the moment a consumer wants it
 * (quest markers, POI overlays, fog-of-war landmark reveals).
 */
export interface AsciiArtStructure {
  name: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Art-level metadata bag (upstream `AsciiArtTypes.AsciiArtMetadata`).
 * `structures` was missing from our prior inline literal; including it stops
 * the silent data loss flagged in tasks/ascii-plus-sync-2026-05-19.md §1.5.
 */
export interface AsciiArtMetadata {
  subject: string;
  tags: string[];
  mood: string;
  size: ArtSize | string; // upstream emits ArtSize; widen to string for forward-compat
  structures?: AsciiArtStructure[];
}

// ---------------------------------------------------------------------------
// Blend & Backend
// ---------------------------------------------------------------------------

/** Blend modes for layer compositing */
export type BlendMode = 'normal' | 'additive' | 'multiply' | 'screen' | 'overlay' |
  'darken' | 'lighten' | 'dodge' | 'burn' | 'softLight' | 'hardLight' |
  'difference' | 'exclusion';

/** Rendering backend selection */
export type RenderBackend = 'dom' | 'canvas2d' | 'webgl2';

/** Color palette names */
export type PaletteName = 'cga' | 'minimal' | 'synthwave' | 'amber_crt';

// ---------------------------------------------------------------------------
// CRT Effects
// ---------------------------------------------------------------------------

/** CRT post-processing effect toggles */
export interface CRTEffects {
  scanlines: boolean;
  bloom: boolean;
  vignette: boolean;
  chromaticAberration: boolean;
  barrelDistortion: boolean;
  phosphorBurnIn: boolean;
  filmGrain: boolean;
  noise: boolean;
  flicker: boolean;
  vhsGlitch: boolean;
}

/** CRT intensity presets */
export type CRTIntensity = 'off' | 'subtle' | 'classic' | 'heavy' | 'vhs';

/** Default CRT effects per intensity */
export const CRT_PRESETS: Record<CRTIntensity, CRTEffects> = {
  off: {
    scanlines: false, bloom: false, vignette: false, chromaticAberration: false,
    barrelDistortion: false, phosphorBurnIn: false, filmGrain: false,
    noise: false, flicker: false, vhsGlitch: false,
  },
  subtle: {
    scanlines: true, bloom: true, vignette: true, chromaticAberration: false,
    barrelDistortion: false, phosphorBurnIn: false, filmGrain: false,
    noise: false, flicker: false, vhsGlitch: false,
  },
  classic: {
    scanlines: true, bloom: true, vignette: true, chromaticAberration: true,
    barrelDistortion: false, phosphorBurnIn: false, filmGrain: true,
    noise: false, flicker: false, vhsGlitch: false,
  },
  heavy: {
    scanlines: true, bloom: true, vignette: true, chromaticAberration: true,
    barrelDistortion: true, phosphorBurnIn: true, filmGrain: true,
    noise: true, flicker: true, vhsGlitch: false,
  },
  vhs: {
    scanlines: true, bloom: true, vignette: true, chromaticAberration: true,
    barrelDistortion: true, phosphorBurnIn: true, filmGrain: true,
    noise: true, flicker: true, vhsGlitch: true,
  },
};

// ---------------------------------------------------------------------------
// Scene Layers
// ---------------------------------------------------------------------------

/** Scene layer definition */
export interface SceneLayer {
  id: string;
  zIndex: number;
  blendMode: BlendMode;
  opacity: number;
  visible: boolean;
  cells: AsciiCell[][];
}

/** Default layer IDs in render order */
export const DEFAULT_LAYERS = [
  'background',   // distant scenery, sky
  'terrain',      // ground, walls, structures
  'objects',      // items, furniture, interactables
  'agents',       // NPCs, player characters
  'particles',    // weather, sparks, effects
  'ui',           // text overlays, HUD
  'effects',      // full-screen effects (phosphor, transitions)
] as const;

export type DefaultLayerId = typeof DEFAULT_LAYERS[number];
