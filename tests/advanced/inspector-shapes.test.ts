/**
 * Inspector-shape tests — Story Grammar pass/fail logic + Vocabulary
 * frequency map. These tests exercise the pure data transforms that the
 * Svelte components depend on. The svelte rendering itself is covered by
 * the Playwright e2e spec.
 */

import { describe, it, expect } from 'vitest';
import type {
  GrammarValidationResult,
  SceneTree,
} from '$lib/services/author/types';

/**
 * Reimplementation of the pass/fail glyph computation. Kept in sync with
 * StoryGrammarInspector.svelte's cellStatus helper.
 */
function cellStatus(result: GrammarValidationResult, beatId: 1 | 2 | 3 | 4 | 5 | 6 | 7, element: string): 'pass' | 'fail' {
  const gaps = result.beatGaps[beatId] ?? [];
  return gaps.includes(element as any) ? 'fail' : 'pass';
}

describe('StoryGrammarInspector — cellStatus', () => {
  it('returns pass when the element is not in the beat gaps', () => {
    const result: GrammarValidationResult = {
      passed: true,
      missing: [],
      beatGaps: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
    };
    expect(cellStatus(result, 1, 'setting')).toBe('pass');
    expect(cellStatus(result, 4, 'attempt')).toBe('pass');
  });

  it('returns fail when the element appears in the beat gaps', () => {
    const result: GrammarValidationResult = {
      passed: false,
      missing: ['attempt'],
      beatGaps: {
        1: ['setting'],
        2: [],
        3: [],
        4: ['attempt', 'consequence'],
        5: [],
        6: [],
        7: [],
      },
    };
    expect(cellStatus(result, 1, 'setting')).toBe('fail');
    expect(cellStatus(result, 4, 'attempt')).toBe('fail');
    expect(cellStatus(result, 4, 'consequence')).toBe('fail');
    expect(cellStatus(result, 4, 'setting')).toBe('pass');
  });
});

describe('VocabularyInspector — frequency map shape', () => {
  /** Light reimplementation of buildFreqMap. */
  function buildFreqMap(sceneTree: SceneTree): Map<string, Map<number, number>> {
    const map = new Map<string, Map<number, number>>();
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const word of sceneTree.tier2_words) {
      map.set(word, new Map());
      const re = new RegExp(`\\b${escape(word)}\\b`, 'gi');
      for (const beat of sceneTree.beats) {
        for (const scene of beat.scenes) {
          for (const spread of scene.spreads) {
            const matches = (spread.spread_text || '').match(re);
            if (matches && matches.length > 0) {
              const inner = map.get(word)!;
              inner.set(
                spread.spreadIndex,
                (inner.get(spread.spreadIndex) ?? 0) + matches.length
              );
            }
          }
        }
      }
    }
    return map;
  }

  function sampleTree(): SceneTree {
    return {
      title: 'Test',
      back_cover_blurb: 'blurb',
      page_budget: 16,
      tier2_words: ['glimmer', 'whisper'],
      beats: [
        {
          id: 1,
          beat_name: 'setup',
          emotional_arc: 'curious → hopeful',
          scenes: [
            {
              sceneId: 's1',
              spreadCount: 2,
              sceneBrief: 'open',
              spreads: [
                { spreadIndex: 0, spread_text: 'The glimmer of dawn lit the hill.', text_focus: 'left' },
                { spreadIndex: 1, spread_text: 'A soft whisper reached Mira.', text_focus: 'right' },
              ],
            },
          ],
        },
        {
          id: 2,
          beat_name: 'catalyst',
          emotional_arc: 'startled',
          scenes: [
            {
              sceneId: 's2',
              spreadCount: 1,
              sceneBrief: 'jump',
              spreads: [
                { spreadIndex: 2, spread_text: 'Another whisper. The glimmer pulsed.', text_focus: 'wraps' },
              ],
            },
          ],
        },
      ] as any,
    };
  }

  it('counts each Tier-2 word across spreads', () => {
    const tree = sampleTree();
    const map = buildFreqMap(tree);
    const glimmer = map.get('glimmer')!;
    expect(glimmer.get(0)).toBe(1);
    expect(glimmer.get(2)).toBe(1);
    expect(glimmer.size).toBe(2);
    const whisper = map.get('whisper')!;
    expect(whisper.get(1)).toBe(1);
    expect(whisper.get(2)).toBe(1);
  });

  it('is case-insensitive', () => {
    const tree = sampleTree();
    tree.beats[0].scenes[0].spreads[0].spread_text = 'The GLIMMER of dawn.';
    const map = buildFreqMap(tree);
    expect(map.get('glimmer')!.get(0)).toBe(1);
  });

  it('flags words with < 2 distinct-context exposure', () => {
    const tree = sampleTree();
    tree.tier2_words = ['rare'];
    tree.beats[0].scenes[0].spreads[0].spread_text = 'A rare moment.';
    const map = buildFreqMap(tree);
    expect(map.get('rare')!.size).toBe(1);
    expect(map.get('rare')!.size < 2).toBe(true);
  });
});
