// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * PretextFlowEngine.ts — Text flowing around obstacles.
 *
 * Two modes:
 *   1. Full mode  — uses @chenglou/pretext + canvas measurement (browser only).
 *   2. Monospace bypass — pure arithmetic, no canvas, fully testable in Node.
 *
 * For testing and monospace grids always use the monospace helpers directly
 * (`computeAvailableWidthGrid`, `flowToGridMonospace`).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface Obstacle {
  x: number;      // pixel x (or grid col in grid-coordinate helpers)
  y: number;      // pixel y (or grid row in grid-coordinate helpers)
  width: number;
  height: number;
}

/** An obstacle that may move each frame (agent glyphs, floating shapes). */
export interface AnimatedObstacle extends Obstacle {
  vx?: number;   // px/s horizontal velocity
  vy?: number;   // px/s vertical velocity
  glyph?: string;
  agentId?: string;
}

export interface PositionedLine {
  text: string;
  x: number;   // pixel x offset
  y: number;   // pixel y baseline
}

export interface FlowResult {
  lines: PositionedLine[];
  totalHeight: number;
}

export interface FlowOptions {
  font?: string;           // CSS font string, default '14px monospace'
  containerWidth?: number; // px, default 600
  lineHeight?: number;     // px, default 18
}

// ── Pixel-coordinate helpers (used by flowTextAroundObstacles) ───────────────

/**
 * For a horizontal band [y, y+lineHeight], find all pixel-coordinate obstacles
 * that overlap that band, then return the best contiguous x-window.
 */
export function computeAvailableWidth(
  y: number,
  lineHeight: number,
  obstacles: Obstacle[],
  containerWidth: number
): { leftOffset: number; width: number } {
  const overlapping = obstacles.filter(
    o => o.y < y + lineHeight && o.y + o.height > y
  );

  if (overlapping.length === 0) {
    return { leftOffset: 0, width: containerWidth };
  }

  // Build blocked intervals and find gaps
  // Simple approach: track which x-columns are blocked
  const blocked = new Set<number>();
  for (const o of overlapping) {
    const start = Math.floor(o.x);
    const end = Math.ceil(o.x + o.width);
    for (let xi = start; xi < end; xi++) {
      blocked.add(xi);
    }
  }

  // Find contiguous free runs
  let bestStart = 0;
  let bestLen = 0;
  let runStart = 0;
  let runLen = 0;

  for (let xi = 0; xi <= containerWidth; xi++) {
    if (xi < containerWidth && !blocked.has(xi)) {
      if (runLen === 0) runStart = xi;
      runLen++;
    } else {
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
      runLen = 0;
    }
  }

  if (bestLen === 0) {
    return { leftOffset: 0, width: containerWidth };
  }

  return { leftOffset: bestStart, width: bestLen };
}

// ── Grid-coordinate helpers (monospace bypass) ────────────────────────────────

/**
 * Same logic as computeAvailableWidth but works in grid coordinates
 * (cols/rows instead of pixels).
 */
export function computeAvailableWidthGrid(
  row: number,
  obstacles: Obstacle[],
  gridWidth: number
): { leftOffset: number; width: number } {
  return computeAvailableWidth(row, 1, obstacles, gridWidth);
}

// ── Blank grid utility (internal) ─────────────────────────────────────────────

function blankGrid(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array(w).fill(' '));
}

// ── Monospace flow (pure arithmetic) ─────────────────────────────────────────

/**
 * Flow text around obstacles in a monospace character grid.
 * No canvas, no Pretext — fully testable in Node.
 *
 * @param text       Input text to flow.
 * @param obstacles  Obstacles in grid coordinates (col/row units).
 * @param gridWidth  Grid columns.
 * @param gridHeight Grid rows.
 */
export function flowToGridMonospace(
  text: string,
  obstacles: Obstacle[],
  gridWidth: number,
  gridHeight: number
): string[][] {
  const grid = blankGrid(gridWidth, gridHeight);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  let wordIdx = 0;

  for (let row = 0; row < gridHeight && wordIdx < words.length; row++) {
    const { leftOffset, width: maxCols } = computeAvailableWidthGrid(
      row,
      obstacles,
      gridWidth
    );
    let col = 0;

    while (wordIdx < words.length) {
      const word = words[wordIdx];
      const needed = col === 0 ? word.length : word.length + 1;
      if (col + needed > maxCols) break;

      if (col > 0) {
        grid[row][leftOffset + col] = ' ';
        col++;
      }
      for (let c = 0; c < word.length; c++) {
        if (leftOffset + col + c < gridWidth) {
          grid[row][leftOffset + col + c] = word[c];
        }
      }
      col += word.length;
      wordIdx++;
    }
  }

  return grid;
}

// ── Pixel-coordinate flow (requires Pretext + canvas context) ─────────────────

let pretextCache: Map<string, { handle: unknown; lru: number }> | null = null;
let lruClock = 0;
let _cacheHits = 0;
let _cacheMisses = 0;
const LRU_MAX = 200;

function getPretextCache(): Map<string, { handle: unknown; lru: number }> {
  if (!pretextCache) pretextCache = new Map();
  return pretextCache;
}

async function prepareText(
  text: string,
  font: string
): Promise<unknown> {
  const key = `${font}::${text}`;
  const cache = getPretextCache();

  if (cache.has(key)) {
    const entry = cache.get(key)!;
    entry.lru = ++lruClock;
    _cacheHits++;
    return entry.handle;
  }

  _cacheMisses++;

  // Evict LRU entry if cache is full
  if (cache.size >= LRU_MAX) {
    let minKey = '';
    let minLru = Infinity;
    for (const [k, v] of cache) {
      if (v.lru < minLru) { minLru = v.lru; minKey = k; }
    }
    cache.delete(minKey);
  }

  const { prepare } = await import('@chenglou/pretext');
  const handle = prepare(text, font);
  cache.set(key, { handle, lru: ++lruClock });
  return handle;
}

/**
 * Flow text around obstacles using @chenglou/pretext (browser/canvas mode).
 * In Node/test environments prefer `flowToGridMonospace`.
 */
export async function flowTextAroundObstacles(
  text: string,
  obstacles: Obstacle[],
  options: FlowOptions = {}
): Promise<FlowResult> {
  const font = options.font ?? '14px monospace';
  const containerWidth = options.containerWidth ?? 600;
  const lineHeight = options.lineHeight ?? 18;

  const { layoutNextLine } = await import('@chenglou/pretext');
  const handle = await prepareText(text, font);

  const lines: PositionedLine[] = [];
  let state: unknown = null;
  let y = 0;

  while (true) {
    const { leftOffset, width } = computeAvailableWidth(y, lineHeight, obstacles, containerWidth);
    if (width <= 0) { y += lineHeight; continue; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = (layoutNextLine as any)(handle, state, { width });
    if (!result || result.done) break;

    lines.push({ text: result.value.text ?? '', x: leftOffset, y });
    state = result.state ?? result.nextState ?? null;
    y += lineHeight;
    if (lines.length > 10000) break; // guard against infinite loops
  }

  return { lines, totalHeight: y };
}

/**
 * Convert a pixel-based FlowResult into a monospace character grid.
 */
export function flowToGrid(
  text: string,
  obstacles: Obstacle[],
  gridWidth: number,
  gridHeight: number,
  charWidth: number = 8,
  charHeight: number = 16
): string[][] {
  const containerWidth = gridWidth * charWidth;
  const lineHeight = charHeight;

  // Convert pixel obstacles to character-unit obstacles
  const charObstacles: Obstacle[] = obstacles.map(o => ({
    x: Math.floor(o.x / charWidth),
    y: Math.floor(o.y / charHeight),
    width: Math.ceil(o.width / charWidth),
    height: Math.ceil(o.height / charHeight),
  }));

  // Do synchronous monospace layout
  return flowToGridMonospace(text, charObstacles, gridWidth, gridHeight);
}

// ── Async path activation ──────────────────────────────────────────────────

let _asyncAvailable: boolean | null = null;

/**
 * Attempt to import @chenglou/pretext. Returns true if successful.
 * Result is cached — safe to call multiple times.
 */
export async function activateAsync(): Promise<boolean> {
  if (_asyncAvailable !== null) return _asyncAvailable;
  try {
    await import('@chenglou/pretext');
    _asyncAvailable = true;
  } catch {
    _asyncAvailable = false;
  }
  return _asyncAvailable;
}

/** True after activateAsync() has succeeded. */
export function isAsync(): boolean {
  return _asyncAvailable === true;
}

// ── Per-character position extraction (monospace) ─────────────────────────────

export interface CharPosition {
  char: string;
  x: number;
  y: number;
}

export function extractCharPositionsMonospace(
  text: string,
  lineX: number,
  lineY: number,
  charWidth: number
): CharPosition[] {
  const chars: CharPosition[] = [];
  for (let i = 0; i < text.length; i++) {
    chars.push({ char: text[i], x: lineX + i * charWidth, y: lineY });
  }
  return chars;
}

// ── Cache stats ───────────────────────────────────────────────────────────────

export function getCacheStats(): { size: number; maxSize: number; hitRate: number } {
  const total = _cacheHits + _cacheMisses;
  return {
    size: pretextCache?.size ?? 0,
    maxSize: LRU_MAX,
    hitRate: total > 0 ? _cacheHits / total : 1,
  };
}
