import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreStory, extractStoryText } from '../../scripts/lfd/story-quality-scorer.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '../..');

const F = JSON.parse(readFileSync(resolve(root, 'static/lfd/kidlit-features.json'), 'utf8'));

const good = readFileSync(resolve(__dir, 'fixtures/good-story.txt'), 'utf8');
const degen = readFileSync(resolve(__dir, 'fixtures/degenerate-story.txt'), 'utf8');

describe('LF2 story-quality scorer', () => {
  it('real public-domain story scores >= 70', () => {
    expect(scoreStory(good, F).score).toBeGreaterThanOrEqual(70);
  });

  it('degenerate text scores <= 40', () => {
    expect(scoreStory(degen, F).score).toBeLessThanOrEqual(40);
  });

  it('is deterministic across runs', () => {
    const a = scoreStory(good, F).score;
    const b = scoreStory(good, F).score;
    expect(a).toBe(b);
  });

  it('makes zero network calls', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    scoreStory(good, F);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('extractStoryText pulls storyText from example-book shape', () => {
    const t = extractStoryText({ beats: [{ storyText: 'Mara made a parade.' }, { storyText: 'The pot answered back.' }] });
    expect(t).toContain('Mara made a parade');
    expect(t).toContain('pot answered back');
  });

  it('extractStoryText pulls spread_text from book3 shape', () => {
    const t = extractStoryText({ beats: [{ spreads: [{ spread_text: 'Look at the night sky.' }] }] });
    expect(t).toContain('Look at the night sky');
  });

  it('returns a perFeature breakdown', () => {
    const r = scoreStory(good, F);
    expect(typeof r.score).toBe('number');
    expect(r.perFeature).toBeTruthy();
  });
});
