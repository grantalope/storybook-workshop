// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * CompositorTypes.ts — Shared types for the PretextCompositor engine.
 */
import type { AsciiCell } from '$lib/pretext/AsciiTypes';
import type { EffectMode, CharState } from '$lib/pretext/PretextEffectEngine';

export interface PixelRect { x: number; y: number; width: number; height: number; }
export interface Point { x: number; y: number; }
export type Surface = 'feed' | 'commune' | 'quest' | 'profile' | 'book-spread';

export interface TextEffect {
  type: 'word_reveal' | 'confidence_glow' | 'dimension_highlight' | 'breathing' | 'stream' | 'reflow_around';
  config: Record<string, unknown>;
}

export interface GridBlockElement {
  type: 'grid'; id: string; grid: AsciiCell[][]; bounds: PixelRect;
  cellW: number; cellH: number; zIndex: number; surface: Surface;
}
export interface ProseElement {
  type: 'prose'; id: string; text: string; font: string; color: string;
  maxWidth: number; origin: Point; lineHeight: number; zIndex: number;
  surface: Surface; effects?: TextEffect[];
}
export interface LabelElement {
  type: 'label'; id: string; text: string; font: string; color: string;
  position: Point; anchor: 'left' | 'center' | 'right'; zIndex: number; surface: Surface;
}
export interface SpeechElement {
  type: 'speech'; id: string; text: string; agentName: string; font: string;
  color: string; maxWidth: number; origin: Point; lineHeight: number;
  zIndex: number; surface: Surface; tailDirection?: 'down' | 'left' | 'right';
}
export interface IntrusionElement {
  type: 'intrusion'; id: string; bounds: PixelRect;
  velocity: { vx: number; vy: number }; glyph?: string;
  lifetime: number; maxLifetime: number; effectMode: EffectMode;
  zIndex: number; surface: Surface;
}

export type LayoutElement = GridBlockElement | ProseElement | LabelElement | SpeechElement | IntrusionElement;

export function isGridBlock(el: LayoutElement): el is GridBlockElement { return el.type === 'grid'; }
export function isProseElement(el: LayoutElement): el is ProseElement { return el.type === 'prose'; }
export function isLabelElement(el: LayoutElement): el is LabelElement { return el.type === 'label'; }
export function isSpeechElement(el: LayoutElement): el is SpeechElement { return el.type === 'speech'; }
export function isIntrusionElement(el: LayoutElement): el is IntrusionElement { return el.type === 'intrusion'; }

export interface PositionedGridBlock {
  id: string; grid: AsciiCell[][]; bounds: PixelRect; cellW: number; cellH: number; zIndex: number;
}
export interface PositionedChar {
  char: string; x: number; y: number; font: string; color: string;
  opacity: number; zIndex: number; elementId: string; effectState?: CharState;
}
export interface ActiveIntrusion {
  id: string; bounds: PixelRect; glyph?: string; opacity: number; effectMode: EffectMode;
}
export interface CompositorFrame {
  gridBlocks: PositionedGridBlock[]; chars: PositionedChar[];
  intrusions: ActiveIntrusion[]; dirty: boolean; frameId: number;
}
export interface CompositorStats {
  avgFrameMs: number; maxFrameMs: number; elementCount: number; charCount: number;
  cacheHitRate: number; dirtyRate: number; pretextAvailable: boolean;
}
