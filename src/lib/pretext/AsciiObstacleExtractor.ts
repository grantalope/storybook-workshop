// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * AsciiObstacleExtractor.ts — Convert ASCII cell grids and agent stamps into
 * Pretext obstacle rectangles for use by PretextEffectEngine / PretextFlowEngine.
 */

import type { AsciiCell } from '$lib/pretext/AsciiTypes';
import type { Obstacle, AnimatedObstacle } from '$lib/pretext/PretextFlowEngine';
import type { AgentStamp } from '$lib/pretext/agentStamps';

export interface ExtractOptions {
  /** Minimum density threshold (reserved for future use). */
  minDensity?: number;
  /** Glyph characters to treat as transparent (not obstacles). */
  excludeGlyphs?: string[];
  /** Tag obstacles that overlap any of these agent bounding regions with the agentId. */
  tagByAgentId?: Array<{ agentId: string; x: number; y: number; width: number; height: number }>;
}

/**
 * Convert an AsciiCell[][] grid into Pretext obstacle rectangles.
 *
 * Contiguous non-space cells in each row are merged into a single obstacle
 * rect spanning `(col * cellW, row * cellH, runLength * cellW, cellH)`.
 *
 * @param grid      2-D array of AsciiCells (row-major).
 * @param cellW     Cell width in pixels.
 * @param cellH     Cell height in pixels.
 * @param options   Optional filtering options.
 */
export function extractObstacles(
  grid: AsciiCell[][],
  cellW: number,
  cellH: number,
  options: ExtractOptions = {}
): (Obstacle | AnimatedObstacle)[] {
  const excludeSet = new Set(options.excludeGlyphs ?? []);
  const obstacles: (Obstacle | AnimatedObstacle)[] = [];

  for (let row = 0; row < grid.length; row++) {
    const cells = grid[row];
    let runStart = -1;

    for (let col = 0; col <= cells.length; col++) {
      const cell = col < cells.length ? cells[col] : null;
      const solid =
        cell != null &&
        cell.glyph !== '' &&
        cell.glyph !== ' ' &&
        !excludeSet.has(cell.glyph);

      if (solid && runStart === -1) {
        runStart = col;
      } else if (!solid && runStart !== -1) {
        obstacles.push({
          x: runStart * cellW,
          y: row * cellH,
          width: (col - runStart) * cellW,
          height: cellH,
        });
        if (options.tagByAgentId?.length) {
          const last = obstacles[obstacles.length - 1];
          for (const tag of options.tagByAgentId) {
            const overlaps =
              last.x < tag.x + tag.width &&
              last.x + last.width > tag.x &&
              last.y < tag.y + tag.height &&
              last.y + last.height > tag.y;
            if (overlaps) {
              (last as AnimatedObstacle).agentId = tag.agentId;
              break;
            }
          }
        }
        runStart = -1;
      }
    }
  }

  return obstacles;
}

/**
 * Convert an AgentStamp into per-cell Pretext obstacles.
 *
 * Each character in the stamp that is not `·` and not a space produces one
 * obstacle rectangle of size `(cellW × cellH)` at the corresponding pixel
 * position.
 *
 * @param stamp   Agent stamp definition (3×3 chars).
 * @param gridX   Left column of the stamp in the grid (grid coordinates).
 * @param gridY   Top row of the stamp in the grid (grid coordinates).
 * @param cellW   Cell width in pixels.
 * @param cellH   Cell height in pixels.
 */
export function fromStamp(
  stamp: AgentStamp,
  gridX: number,
  gridY: number,
  cellW: number,
  cellH: number
): Obstacle[] {
  const obstacles: Obstacle[] = [];

  for (let row = 0; row < stamp.stamp.length; row++) {
    const line = stamp.stamp[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch !== '·' && ch !== ' ') {
        obstacles.push({
          x: (gridX + col) * cellW,
          y: (gridY + row) * cellH,
          width: cellW,
          height: cellH,
        });
      }
    }
  }

  return obstacles;
}
