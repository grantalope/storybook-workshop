// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * PretextCompositor.ts — Core orchestrator for the text+grid compositing pipeline.
 *
 * Receives LayoutElements (grids, prose, labels, speech, intrusions), runs text
 * layout with obstacle avoidance, and produces positioned character frames for
 * renderers.
 *
 * Two modes:
 *   1. Full mode  — @chenglou/pretext for proportional text layout (browser).
 *   2. Monospace fallback — pure arithmetic, fully testable in Node/Vitest.
 *
 * The compositor is the single source of truth for where every character appears
 * on screen. Renderers (Canvas2D, WebGL, DOM) consume CompositorFrame output.
 */

import type {
  Surface, LayoutElement, GridBlockElement, ProseElement, LabelElement,
  SpeechElement, IntrusionElement, PositionedGridBlock, PositionedChar,
  ActiveIntrusion, CompositorFrame, CompositorStats,
} from '$lib/pretext/CompositorTypes';

import {
  isGridBlock, isProseElement, isLabelElement, isSpeechElement,
} from '$lib/pretext/CompositorTypes';

import type { Obstacle } from '$lib/pretext/PretextFlowEngine';
import {
  activateAsync,
  computeAvailableWidth,
  extractCharPositionsMonospace,
  getCacheStats,
} from '$lib/pretext/PretextFlowEngine';

import { extractObstacles } from '$lib/pretext/AsciiObstacleExtractor';
import { measureRendererFrame } from '$lib/render/RendererKernelBridge';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CHAR_WIDTH = 8;
const FRAME_TIME_WINDOW = 60; // rolling window for avg frame time

// ── FNV-1a hash for dirty tracking ──────────────────────────────────────────

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

function hashElements(elements: LayoutElement[]): number {
  const parts: string[] = [];
  for (const el of elements) {
    parts.push(el.id);
    parts.push(el.type);
    if (isProseElement(el) || isSpeechElement(el)) {
      parts.push(el.text);
      parts.push(String(el.maxWidth));
      parts.push(`${el.origin.x},${el.origin.y}`);
    } else if (isLabelElement(el)) {
      parts.push(el.text);
      parts.push(`${el.position.x},${el.position.y}`);
      parts.push(el.anchor);
    } else if (isGridBlock(el)) {
      parts.push(`${el.bounds.x},${el.bounds.y},${el.bounds.width},${el.bounds.height}`);
      parts.push(`${el.grid.length}x${el.grid[0]?.length ?? 0}`);
    }
  }
  return fnv1a(parts.join('|'));
}

// ── Intrusion state (internal, mutable) ─────────────────────────────────────

interface IntrusionState {
  element: IntrusionElement;
  currentBounds: { x: number; y: number; width: number; height: number };
  remainingLifetime: number;
}

// ── PretextCompositor ───────────────────────────────────────────────────────

export class PretextCompositor {
  // Per-surface element storage
  private surfaces = new Map<Surface, LayoutElement[]>();
  private surfaceHashes = new Map<Surface, number>();
  private surfaceCharCache = new Map<Surface, PositionedChar[]>();

  // Intrusions (cross-surface animated obstacles)
  private intrusions: IntrusionState[] = [];

  // Obstacle cache (rebuilt each tick when dirty)
  private cachedObstacles: Obstacle[] = [];

  // Pretext availability
  private pretextAvailable = false;

  // Frame state
  private frameId = 0;
  private currentFrame: CompositorFrame = {
    gridBlocks: [], chars: [], intrusions: [], dirty: false, frameId: 0,
  };

  // Dirty tracking
  private globalDirty = true;

  // Performance tracking
  private frameTimes: number[] = [];
  private maxFrameMs = 0;
  private totalDirtyFrames = 0;
  private totalFrames = 0;

  // ── Initialization ──────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    try {
      await import('@chenglou/pretext');
      this.pretextAvailable = true;
      await activateAsync();
      console.log('[Compositor] Initialized — pretext available: true, proportional fonts active');
    } catch {
      this.pretextAvailable = false;
      console.log('[Compositor] Initialized — pretext available: false (monospace fallback)');
    }
  }

  // ── Element Management ──────────────────────────────────────────────────

  /**
   * Set all elements for a given surface, replacing any previous elements.
   * Elements are NOT filtered by type — the surface receives all layout element
   * types and the tick pipeline handles each accordingly.
   */
  setElements(surface: Surface, elements: LayoutElement[]): void {
    this.surfaces.set(surface, elements);
    const newHash = hashElements(elements);
    const oldHash = this.surfaceHashes.get(surface);
    if (oldHash !== newHash) {
      this.surfaceHashes.set(surface, newHash);
      this.surfaceCharCache.delete(surface);
      this.globalDirty = true;
    }
  }

  /**
   * Remove all elements and cached layout for a surface.
   */
  clearSurface(surface: Surface): void {
    this.surfaces.delete(surface);
    this.surfaceHashes.delete(surface);
    this.surfaceCharCache.delete(surface);
    this.globalDirty = true;
  }

  /**
   * Add a temporary animated intrusion (e.g., dragon sweep, scatter bomb).
   */
  addIntrusion(intrusion: IntrusionElement): void {
    this.intrusions.push({
      element: intrusion,
      currentBounds: { ...intrusion.bounds },
      remainingLifetime: intrusion.lifetime,
    });
    this.globalDirty = true;
  }

  /**
   * Force re-layout of everything on next tick.
   */
  invalidateAll(): void {
    this.surfaceCharCache.clear();
    this.globalDirty = true;
  }

  // ── Tick Pipeline ───────────────────────────────────────────────────────

  /**
   * Main tick method — called once per animation frame.
   *
   * Three-phase pipeline:
   *   1. Obstacle collection (grids + intrusions → obstacle list)
   *   2. Text layout (prose/labels/speech → PositionedChar[])
   *   3. Frame assembly (merge all outputs into CompositorFrame)
   *
   * @param dt Delta time in seconds since last tick.
   */
  tick(dt: number): CompositorFrame {
    const t0 = performance.now();

    // Phase 0: Update intrusions (position + lifetime)
    this.tickIntrusions(dt);

    // Phase 1: Collect obstacles from all grid blocks + intrusions
    this.rebuildObstacles();

    // Phase 2: Layout all text elements
    const gridBlocks: PositionedGridBlock[] = [];
    const allChars: PositionedChar[] = [];

    for (const [surface, elements] of this.surfaces) {
      // Check if this surface needs re-layout
      const cached = this.surfaceCharCache.get(surface);
      if (cached && !this.globalDirty) {
        // Reuse cached char positions
        allChars.push(...cached);
        // Still need to collect grid blocks
        for (const el of elements) {
          if (isGridBlock(el)) {
            gridBlocks.push(this.gridBlockToPositioned(el));
          }
        }
        continue;
      }

      const surfaceChars: PositionedChar[] = [];

      for (const el of elements) {
        if (isGridBlock(el)) {
          gridBlocks.push(this.gridBlockToPositioned(el));
        } else if (isProseElement(el) || isSpeechElement(el)) {
          surfaceChars.push(...this.layoutProse(el));
        } else if (isLabelElement(el)) {
          surfaceChars.push(...this.layoutLabel(el));
        }
        // IntrusionElements are handled separately via addIntrusion
      }

      this.surfaceCharCache.set(surface, surfaceChars);
      allChars.push(...surfaceChars);
    }

    // Phase 3: Assemble frame
    const dirty = this.globalDirty;
    this.globalDirty = false;

    this.frameId++;
    this.currentFrame = {
      gridBlocks,
      chars: allChars,
      intrusions: this.intrusions.map(i => this.intrusionToActive(i)),
      dirty,
      frameId: this.frameId,
    };

    // Performance tracking
    const elapsed = performance.now() - t0;
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > FRAME_TIME_WINDOW) {
      this.frameTimes.shift();
    }
    if (elapsed > this.maxFrameMs) {
      this.maxFrameMs = elapsed;
    }
    this.totalFrames++;
    if (dirty) this.totalDirtyFrames++;

    return this.currentFrame;
  }

  // ── Obstacle Management ─────────────────────────────────────────────────

  private rebuildObstacles(): void {
    const obstacles: Obstacle[] = [];

    for (const [, elements] of this.surfaces) {
      for (const el of elements) {
        if (isGridBlock(el)) {
          const gridObstacles = extractObstacles(el.grid, el.cellW, el.cellH);
          // Offset obstacles by the grid block's position
          for (const obs of gridObstacles) {
            obstacles.push({
              x: obs.x + el.bounds.x,
              y: obs.y + el.bounds.y,
              width: obs.width,
              height: obs.height,
            });
          }
        }
      }
    }

    // Add intrusion bounds as obstacles
    for (const intr of this.intrusions) {
      obstacles.push({
        x: intr.currentBounds.x,
        y: intr.currentBounds.y,
        width: intr.currentBounds.width,
        height: intr.currentBounds.height,
      });
    }

    this.cachedObstacles = obstacles;
  }

  getObstacles(): Obstacle[] {
    return this.cachedObstacles;
  }

  // ── Intrusion Tick ──────────────────────────────────────────────────────

  private tickIntrusions(dt: number): void {
    const hadIntrusions = this.intrusions.length > 0;

    for (const intr of this.intrusions) {
      // Update position by velocity
      intr.currentBounds.x += intr.element.velocity.vx * dt;
      intr.currentBounds.y += intr.element.velocity.vy * dt;
      // Decrement lifetime
      intr.remainingLifetime -= dt;
    }

    // Remove expired intrusions
    this.intrusions = this.intrusions.filter(i => i.remainingLifetime > 0);

    // Mark dirty if intrusions changed
    if (hadIntrusions || this.intrusions.length > 0) {
      this.globalDirty = true;
    }
  }

  // ── Layout Helpers ──────────────────────────────────────────────────────

  /**
   * Layout prose or speech text with word-wrapping and obstacle avoidance.
   * Uses monospace fallback (pretext unavailable in test/Node environments).
   */
  private layoutProse(el: ProseElement | SpeechElement): PositionedChar[] {
    const chars: PositionedChar[] = [];
    const charWidth = this.estimateCharWidth(el.font);
    const lineHeight = el.lineHeight;
    const maxWidth = el.maxWidth;
    const originX = el.origin.x;
    const originY = el.origin.y;

    // Word-wrap with obstacle avoidance
    const words = el.text.split(/\s+/).filter(w => w.length > 0);
    let wordIdx = 0;
    let lineY = originY;
    const maxLines = 1000; // safety guard
    let lineCount = 0;

    while (wordIdx < words.length && lineCount < maxLines) {
      // Compute available width at this line's Y position
      const { leftOffset, width: availWidth } = computeAvailableWidth(
        lineY, lineHeight, this.cachedObstacles, maxWidth
      );

      const lineStartX = originX + leftOffset;
      const maxCharsInLine = Math.floor(availWidth / charWidth);

      if (maxCharsInLine <= 0) {
        // No space on this line, skip to next
        lineY += lineHeight;
        lineCount++;
        continue;
      }

      let col = 0;

      while (wordIdx < words.length) {
        const word = words[wordIdx];
        const needed = col === 0 ? word.length : word.length + 1;

        if (col + needed > maxCharsInLine) break;

        // Add space before word (except first word on line)
        if (col > 0) {
          chars.push({
            char: ' ',
            x: lineStartX + col * charWidth,
            y: lineY,
            font: el.font,
            color: el.color,
            opacity: 1,
            zIndex: el.zIndex,
            elementId: el.id,
          });
          col++;
        }

        // Add each character of the word
        for (let c = 0; c < word.length; c++) {
          chars.push({
            char: word[c],
            x: lineStartX + (col + c) * charWidth,
            y: lineY,
            font: el.font,
            color: el.color,
            opacity: 1,
            zIndex: el.zIndex,
            elementId: el.id,
          });
        }
        col += word.length;
        wordIdx++;
      }

      lineY += lineHeight;
      lineCount++;
    }

    return chars;
  }

  /**
   * Layout a label at its position with anchor alignment.
   */
  private layoutLabel(el: LabelElement): PositionedChar[] {
    const charWidth = this.estimateCharWidth(el.font);
    const textWidth = el.text.length * charWidth;

    let startX = el.position.x;
    if (el.anchor === 'center') {
      startX = el.position.x - textWidth / 2;
    } else if (el.anchor === 'right') {
      startX = el.position.x - textWidth;
    }

    const charPositions = extractCharPositionsMonospace(
      el.text, startX, el.position.y, charWidth
    );

    return charPositions.map(cp => ({
      char: cp.char,
      x: cp.x,
      y: cp.y,
      font: el.font,
      color: el.color,
      opacity: 1,
      zIndex: el.zIndex,
      elementId: el.id,
    }));
  }

  /**
   * Convert a GridBlockElement to a PositionedGridBlock (pass-through).
   */
  private gridBlockToPositioned(el: GridBlockElement): PositionedGridBlock {
    return {
      id: el.id,
      grid: el.grid,
      bounds: el.bounds,
      cellW: el.cellW,
      cellH: el.cellH,
      zIndex: el.zIndex,
    };
  }

  /**
   * Convert internal intrusion state to ActiveIntrusion for the frame.
   */
  private intrusionToActive(intr: IntrusionState): ActiveIntrusion {
    const progress = 1 - (intr.remainingLifetime / intr.element.maxLifetime);
    return {
      id: intr.element.id,
      bounds: { ...intr.currentBounds },
      glyph: intr.element.glyph,
      opacity: Math.max(0, 1 - progress * 0.5),
      effectMode: intr.element.effectMode,
    };
  }

  /**
   * Estimate monospace character width from a CSS font string.
   * Extracts pixel size and uses 0.6 ratio, or falls back to DEFAULT_CHAR_WIDTH.
   */
  private estimateCharWidth(font: string): number {
    const match = font.match(/(\d+)px/);
    if (match) {
      const fontSize = parseInt(match[1], 10);
      // Monospace char width is roughly 0.6 * font size
      return Math.round(fontSize * 0.6) || DEFAULT_CHAR_WIDTH;
    }
    return DEFAULT_CHAR_WIDTH;
  }

  // ── Accessors ───────────────────────────────────────────────────────────

  getCurrentFrame(): CompositorFrame {
    return this.currentFrame;
  }

  getStats(): CompositorStats {
    const total = this.frameTimes.length;
    const avgFrameMs = total > 0
      ? this.frameTimes.reduce((a, b) => a + b, 0) / total
      : 0;

    let elementCount = 0;
    for (const [, elements] of this.surfaces) {
      elementCount += elements.length;
    }
    elementCount += this.intrusions.length;

    const flowCache = getCacheStats();

    return {
      avgFrameMs,
      maxFrameMs: this.maxFrameMs,
      elementCount,
      charCount: this.currentFrame.chars.length,
      cacheHitRate: flowCache.hitRate,
      dirtyRate: this.totalFrames > 0
        ? this.totalDirtyFrames / this.totalFrames
        : 0,
      pretextAvailable: this.pretextAvailable,
    };
  }

  /**
   * Kernel-instrumented wrapper around `tick`. Routes the frame timing
   * through `render.frame-budget` (Stage 4d migration) so `/debug/os` sees
   * the compositor's per-frame durations.
   *
   * Pre-boot or no-kernel runs `tick(dt)` directly with zero overhead — same
   * behaviour as calling `tick` straight. Production hot-path callers
   * (the AppOrchestrator compositor pump) should prefer this entrypoint.
   *
   * Returns a Promise<CompositorFrame> because the kernel `measure()` is async;
   * the underlying `tick` remains synchronous so existing call sites that
   * await synchronous results keep working without modification.
   */
  async tickMeasured(dt: number): Promise<CompositorFrame> {
    return measureRendererFrame('pretext-compositor', 'pretext-tick', () =>
      this.tick(dt),
    );
  }
}
