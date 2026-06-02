import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIER2_CAP,
  highlight,
  runsToPlainText,
  countEmphasized,
} from '$lib/services/render/Tier2EmphasisHighlighter';

describe('Tier2EmphasisHighlighter', () => {
  it('returns an empty array for empty input', () => {
    expect(highlight('', ['gleam'])).toEqual([]);
  });

  it('returns a single "none" run when no Tier-2 word is present', () => {
    const runs = highlight('the cat sat on the mat', ['gleam']);
    expect(runs).toHaveLength(1);
    expect(runs[0].emphasis).toBe('none');
    expect(runs[0].text).toBe('the cat sat on the mat');
  });

  it('marks a Tier-2 word and preserves surrounding text', () => {
    const runs = highlight('she watched the dragon gleam in the sun', ['gleam']);
    const plain = runsToPlainText(runs);
    expect(plain).toBe('she watched the dragon gleam in the sun');
    expect(countEmphasized(runs)).toBe(1);
    expect(runs.some(r => r.emphasis === 'tier2' && r.text === 'gleam')).toBe(true);
  });

  it('respects case-insensitive matching but preserves original casing', () => {
    const runs = highlight('Gleam!', ['gleam']);
    expect(runs.find(r => r.emphasis === 'tier2')?.text).toBe('Gleam');
  });

  it('caps emphasis at DEFAULT_TIER2_CAP (=2) per spread', () => {
    const text = 'wander wander wander wander';
    const runs = highlight(text, ['wander']);
    expect(DEFAULT_TIER2_CAP).toBe(2);
    expect(countEmphasized(runs)).toBe(2);
  });

  it('honors a custom cap', () => {
    const text = 'whisper whisper whisper whisper';
    const runs = highlight(text, ['whisper'], { cap: 3 });
    expect(countEmphasized(runs)).toBe(3);
  });

  it('cap = 0 → no emphasis at all', () => {
    const runs = highlight('argue and argue', ['argue'], { cap: 0 });
    expect(countEmphasized(runs)).toBe(0);
  });

  it('treats punctuation as run-terminator (cat, → cat + ,)', () => {
    const runs = highlight('she saw a cat, then a dog', ['cat']);
    expect(runs.find(r => r.emphasis === 'tier2')?.text).toBe('cat');
    expect(runsToPlainText(runs)).toBe('she saw a cat, then a dog');
  });

  it('multiple distinct Tier-2 words emphasized in order until cap', () => {
    const runs = highlight('gleam and wander and ponder', ['gleam', 'wander', 'ponder']);
    const emphasized = runs.filter(r => r.emphasis === 'tier2').map(r => r.text);
    expect(emphasized).toEqual(['gleam', 'wander']);
  });

  it('ignores Tier-2 entries not appearing in text', () => {
    const runs = highlight('hello world', ['gleam', 'magnificent']);
    expect(countEmphasized(runs)).toBe(0);
  });

  it('coalesces adjacent none runs for compact output', () => {
    const runs = highlight('one two three four', ['nope']);
    const noneRuns = runs.filter(r => r.emphasis === 'none');
    expect(noneRuns).toHaveLength(1);
  });

  it('hyphenated words (e.g. "well-behaved") are matched atomically', () => {
    const runs = highlight('the well-behaved fox', ['well-behaved']);
    expect(runs.find(r => r.emphasis === 'tier2')?.text).toBe('well-behaved');
  });

  it('empty / falsy Tier-2 entries are ignored', () => {
    const runs = highlight('hello world', ['', 'hello', '']);
    expect(countEmphasized(runs)).toBe(1);
  });
});
