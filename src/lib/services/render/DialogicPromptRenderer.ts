// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * DialogicPromptRenderer.ts — Margin layout for PEER/CROWD dialogic prompts.
 *
 * Spec §7.4: parent-facing margin notes that scaffold conversation during
 * the read-along. Rendered as PretextCompositor `Speech` elements so they
 * can carry the same animation pipeline as character speech (scatter-in
 * on page-enter in digital, italic side-note in print).
 *
 * Layout rule (anti-formulaic):
 *   spread 1 → bottom-right margin
 *   spread 2 → bottom-right margin
 *   spread 3 → top-left margin
 *   spread 4 → top-left margin
 *   spread 5 → bottom-right margin (rotate every 2 spreads)
 *   ...
 *
 * The 2-spread cadence is deliberate — alternating every spread feels too
 * busy at read-along pace, but never alternating feels like a watermark.
 *
 * Multiple prompts on a single spread stack vertically inside the chosen
 * margin with a small inter-prompt gap.
 */

import type { LayoutElement, SpeechElement, PixelRect } from '$lib/pretext/CompositorTypes';
import type { DialogicPrompt } from './types';

const MARGIN_PAD = 16;
const PROMPT_FONT = 'italic 400 12px "Cormorant Garamond", Georgia, serif';
const PROMPT_COLOR = '#475569';
const PROMPT_LINE_H = 18;
const PROMPT_MAX_WIDTH_PX = 220;
const PROMPT_BLOCK_HEIGHT_PX = 90;
const PROMPT_GAP_PX = 8;
const PROMPT_Z = 5;

export type MarginCorner = 'top-left' | 'bottom-right';

/**
 * Pick the margin corner for a given spread index per the 2-spread
 * rotation rule.
 */
export function pickCorner(spreadIndex: number): MarginCorner {
  const pair = Math.floor(spreadIndex / 2);
  return pair % 2 === 0 ? 'bottom-right' : 'top-left';
}

/**
 * Render `prompts` as PreText `Speech` elements positioned in the
 * spread-margin corner picked by `pickCorner(spreadIndex)`.
 *
 * `spreadBounds` is the full spread pixel rect; the renderer derives
 * margin-anchored positions from it.
 */
export function render(
  prompts: DialogicPrompt[],
  spreadIndex: number,
  spreadBounds: PixelRect,
): LayoutElement[] {
  if (!prompts || prompts.length === 0) return [];

  const corner = pickCorner(spreadIndex);
  const elements: LayoutElement[] = [];

  for (let i = 0; i < prompts.length; i += 1) {
    const p = prompts[i];
    const blockY = corner === 'top-left'
      ? spreadBounds.y + MARGIN_PAD + i * (PROMPT_BLOCK_HEIGHT_PX + PROMPT_GAP_PX)
      : spreadBounds.y + spreadBounds.height - MARGIN_PAD - PROMPT_BLOCK_HEIGHT_PX
        - i * (PROMPT_BLOCK_HEIGHT_PX + PROMPT_GAP_PX);
    const blockX = corner === 'top-left'
      ? spreadBounds.x + MARGIN_PAD
      : spreadBounds.x + spreadBounds.width - MARGIN_PAD - PROMPT_MAX_WIDTH_PX;

    const el: SpeechElement = {
      type: 'speech',
      id: `dialogic-${spreadIndex}-${p.id}`,
      text: p.text,
      agentName: kindLabel(p.kind),
      font: PROMPT_FONT,
      color: PROMPT_COLOR,
      maxWidth: PROMPT_MAX_WIDTH_PX,
      origin: { x: blockX, y: blockY },
      lineHeight: PROMPT_LINE_H,
      zIndex: PROMPT_Z,
      surface: 'book-spread',
      tailDirection: corner === 'top-left' ? 'right' : 'left',
    };
    elements.push(el);
  }

  return elements;
}

/** Human-readable label for inspector tooltip / margin caption. */
function kindLabel(kind: DialogicPrompt['kind']): string {
  switch (kind) {
    case 'completion': return 'Completion';
    case 'recall': return 'Recall';
    case 'open': return 'Open-Ended';
    case 'wh-question': return 'Wh-Question';
    case 'distancing': return 'Distancing';
    default: return 'Prompt';
  }
}
