import { describe, it, expect } from 'vitest';
import {
  pickCorner,
  render as renderDialogic,
} from '$lib/services/render/DialogicPromptRenderer';
import type { DialogicPrompt } from '$lib/services/render/types';

const SPREAD_BOUNDS = { x: 0, y: 0, width: 720, height: 540 };

const prompts: DialogicPrompt[] = [
  { id: 'a', kind: 'completion', text: 'The dragon felt ___ when the kite landed.' },
  { id: 'b', kind: 'wh-question', text: 'Where do you think they will fly next?' },
];

describe('DialogicPromptRenderer', () => {
  it('pickCorner rotates every 2 spreads — bottom-right then top-left', () => {
    expect(pickCorner(0)).toBe('bottom-right');
    expect(pickCorner(1)).toBe('bottom-right');
    expect(pickCorner(2)).toBe('top-left');
    expect(pickCorner(3)).toBe('top-left');
    expect(pickCorner(4)).toBe('bottom-right');
  });

  it('emits zero elements when no prompts', () => {
    expect(renderDialogic([], 0, SPREAD_BOUNDS)).toEqual([]);
  });

  it('emits one Speech element per prompt', () => {
    const out = renderDialogic(prompts, 0, SPREAD_BOUNDS);
    expect(out).toHaveLength(2);
    expect(out.every(el => el.type === 'speech')).toBe(true);
  });

  it('all emitted elements have surface="book-spread"', () => {
    const out = renderDialogic(prompts, 1, SPREAD_BOUNDS);
    expect(out.every(el => el.surface === 'book-spread')).toBe(true);
  });

  it('bottom-right placement anchors near the bottom-right of the spread', () => {
    const out = renderDialogic([prompts[0]], 0, SPREAD_BOUNDS);
    const el = out[0];
    if (el.type === 'speech') {
      expect(el.origin.x).toBeGreaterThan(SPREAD_BOUNDS.width / 2);
      expect(el.origin.y).toBeGreaterThan(SPREAD_BOUNDS.height / 2);
    }
  });

  it('top-left placement anchors near the top-left of the spread', () => {
    const out = renderDialogic([prompts[0]], 2, SPREAD_BOUNDS);
    const el = out[0];
    if (el.type === 'speech') {
      expect(el.origin.x).toBeLessThan(SPREAD_BOUNDS.width / 2);
      expect(el.origin.y).toBeLessThan(SPREAD_BOUNDS.height / 2);
    }
  });

  it('Speech tailDirection reflects the chosen corner', () => {
    const br = renderDialogic([prompts[0]], 0, SPREAD_BOUNDS)[0];
    const tl = renderDialogic([prompts[0]], 2, SPREAD_BOUNDS)[0];
    if (br.type === 'speech') expect(br.tailDirection).toBe('left');
    if (tl.type === 'speech') expect(tl.tailDirection).toBe('right');
  });

  it('multiple prompts stack vertically without overlap', () => {
    const out = renderDialogic(prompts, 0, SPREAD_BOUNDS);
    if (out[0].type === 'speech' && out[1].type === 'speech') {
      expect(out[0].origin.y).not.toBe(out[1].origin.y);
    }
  });

  it('kind label propagates to Speech.agentName', () => {
    const out = renderDialogic([prompts[0]], 0, SPREAD_BOUNDS);
    if (out[0].type === 'speech') {
      expect(out[0].agentName).toBe('Completion');
    }
  });

  it('element ids are unique per (spread, prompt)', () => {
    const out = renderDialogic(prompts, 7, SPREAD_BOUNDS);
    const ids = new Set(out.map(el => el.id));
    expect(ids.size).toBe(out.length);
  });
});
