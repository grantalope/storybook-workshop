// tests/author/story-quality-scorer.test.ts
//
// Unit tests for the pure-function prose-quality rubric. Hand-built good/bad
// fixtures pin every metric: page-turn hooks, sentence-length fit, cadence,
// refrain detection (+ climax mutation), show-don't-tell, concreteness,
// dialogue ratio — plus determinism and the hand-written template stories
// clearing the default quality bar.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUALITY_THRESHOLD,
  hasPageTurnHook,
  scoreSceneTree,
} from '$lib/services/author/StoryQualityScorer';
import { synthesizeTemplateTree, templateFamilyForTheme } from '$lib/services/author/templateFallback';
import { storyBudgetAllocator } from '$lib/services/author/StoryBudgetAllocator';
import type { AgeBand, SceneTree, StoryInput, StoryTheme } from '$lib/services/author/types';

/** Minimal tree: one beat, one scene per spread (scorer is shape-tolerant). */
function mkTree(spreadTexts: string[]): SceneTree {
  return {
    title: 'Test',
    back_cover_blurb: 'blurb',
    page_budget: spreadTexts.length,
    tier2_words: [],
    beats: [
      {
        id: 1,
        beat_name: 'setup',
        emotional_arc: 'arc',
        scenes: spreadTexts.map((text, i) => ({
          sceneId: `s-${i}`,
          spreadCount: 1 as const,
          sceneBrief: 'the hero',
          spreads: [{ spreadIndex: i, spread_text: text, text_focus: 'left' as const }],
        })),
      },
    ],
  };
}

function baseInput(over: Partial<StoryInput> = {}): StoryInput {
  return {
    kidName: 'Eli',
    ageBand: 'preschool',
    ehriPhase: 'partial-alphabetic',
    theme: 'overcoming-fear',
    occasion: 'just-because',
    sidekickSettlerId: 'sidekick-1',
    supportingCast: [],
    localeBiome: 'forest',
    targetSpreads: 16,
    dedicationText: '',
    dialogicPromptsEnabled: false,
    easierReadingMode: false,
    ...over,
  };
}

describe('StoryQualityScorer — page-turn hooks', () => {
  it('scores full coverage when every non-final spread ends with a hook', () => {
    const tree = mkTree(['Where did it go?', 'It hid in the log…', 'The end.']);
    const r = scoreSceneTree(tree, { ageBand: 'preschool' });
    expect(r.metrics.pageTurnHookCoverage).toBe(1);
  });

  it('scores partial coverage for flat spread endings', () => {
    const tree = mkTree(['The fox sat on the rug.', 'It hid in the log…', 'The end.']);
    const r = scoreSceneTree(tree, { ageBand: 'preschool' });
    expect(r.metrics.pageTurnHookCoverage).toBeCloseTo(0.5, 5);
  });

  it('hasPageTurnHook recognizes questions, ellipses, dashes, and "But" cliffhangers', () => {
    expect(hasPageTurnHook('Who knocked on the door?')).toBe(true);
    expect(hasPageTurnHook('Something back there… blinked…')).toBe(true);
    expect(hasPageTurnHook('The sock bounced away —')).toBe(true);
    expect(hasPageTurnHook('She pulled hard. But the door stayed shut.')).toBe(true);
    expect(hasPageTurnHook('"Did it… wiggle?"')).toBe(true); // trailing quote stripped
    expect(hasPageTurnHook('The fox sat on the rug.')).toBe(false);
    expect(hasPageTurnHook('Everyone smiled. The end.')).toBe(false);
  });
});

describe('StoryQualityScorer — sentence length + cadence', () => {
  it('penalizes over-cap sentences for the toddler band', () => {
    const long =
      'The extremely adventurous child wandered very far across the enormous mysterious whispering forest of shadows.';
    const r = scoreSceneTree(mkTree([long, long, 'The end.']), { ageBand: 'toddler' });
    expect(r.metrics.sentenceLengthFit).toBeLessThan(0.5);
  });

  it('gives full fit for short toddler sentences', () => {
    const r = scoreSceneTree(mkTree(['Bo ran. Bo hopped.', 'Bo slept. The end.']), {
      ageBand: 'toddler',
    });
    expect(r.metrics.sentenceLengthFit).toBe(1);
  });

  it('rewards varied cadence and flags uniform cadence for grade-school', () => {
    const uniform = mkTree([
      'The dog ran to the tall tree. The cat ran to the old shed. The fox ran to the wet log.',
      'The hen ran to the red barn. The owl ran to the dark wood. The end of it all came.',
    ]);
    const varied = mkTree([
      'Tap. Tap. Nothing moved in the long dark hallway of the old creaking house.',
      'Silence. Then the smallest sound you ever heard came creeping under the door. A mouse.',
    ]);
    const ru = scoreSceneTree(uniform, { ageBand: 'grade-school' });
    const rv = scoreSceneTree(varied, { ageBand: 'grade-school' });
    expect(rv.metrics.cadenceVariety).toBeGreaterThan(ru.metrics.cadenceVariety);
  });
});

describe('StoryQualityScorer — refrain detection', () => {
  it('detects a refrain repeated 3x', () => {
    const tree = mkTree([
      'Bo set off. "Glow, little glow, which way is home?"',
      'Bo walked on. "Glow, little glow, which way is home?"',
      'Bo kept going. "Glow, little glow, which way is home?"',
      'Bo got home. The end.',
    ]);
    const r = scoreSceneTree(tree, { ageBand: 'preschool' });
    expect(r.metrics.refrainScore).toBe(1);
    expect(r.refrain).not.toBeNull();
    expect(r.refrain!.count).toBeGreaterThanOrEqual(3);
  });

  it('counts a mutated climax refrain via shared prefix', () => {
    const tree = mkTree([
      'Bo sang: "Glow, little glow, which way is home?"',
      'Bo sang again: "Glow, little glow, which way is home?"',
      'Bo shouted: "Glow, little glow, THIS way is home!"',
      'Bo slept. The end.',
    ]);
    const r = scoreSceneTree(tree, { ageBand: 'preschool' });
    expect(r.metrics.refrainScore).toBe(1);
    expect(r.refrain!.count).toBeGreaterThanOrEqual(3);
  });

  it('scores 0 when no line repeats', () => {
    const tree = mkTree([
      'A fox found one red hat today.',
      'Two ducks swam under that old bridge.',
      'Snow fell over every quiet little roof.',
    ]);
    const r = scoreSceneTree(tree, { ageBand: 'preschool' });
    expect(r.metrics.refrainScore).toBe(0);
    expect(r.refrain).toBeNull();
  });
});

describe('StoryQualityScorer — show-dont-tell', () => {
  it('counts emotion-label constructions and penalizes them', () => {
    const tree = mkTree(['Mira was nervous. Mira felt happy after that.', 'The end.']);
    const r = scoreSceneTree(tree, { ageBand: 'preschool' });
    expect(r.emotionLabelCount).toBe(2);
    expect(r.metrics.showDontTell).toBeCloseTo(1 - 2 / 3, 2);
  });

  it('does not penalize feelings shown through body and action', () => {
    const tree = mkTree([
      'Mira squeezed her backpack straps. Her tummy did a flip.',
      'Mira stood up tall and marched. The end.',
    ]);
    const r = scoreSceneTree(tree, { ageBand: 'preschool' });
    expect(r.emotionLabelCount).toBe(0);
    expect(r.metrics.showDontTell).toBe(1);
  });
});

describe('StoryQualityScorer — concreteness + dialogue', () => {
  it('scores concrete sensory prose above abstract prose', () => {
    const concrete = mkTree([
      'The fox dripped warm mud on the stone floor.',
      'A red kite went crunch against the old gate.',
    ]);
    const abstract = mkTree([
      'It was a truly wonderful and special time for everyone involved.',
      'Things were generally good and they all appreciated the situation.',
    ]);
    const rc = scoreSceneTree(concrete, { ageBand: 'preschool' });
    const ra = scoreSceneTree(abstract, { ageBand: 'preschool' });
    expect(rc.metrics.concreteness).toBeGreaterThan(ra.metrics.concreteness);
  });

  it('scores dialogue in the sweet spot at 1 and zero dialogue at 0', () => {
    const withDialogue = mkTree([
      '"Who goes there?" said the owl.',
      'The fox crept past the gate.',
      'The moon rose over the pond.',
    ]);
    const noDialogue = mkTree([
      'The owl looked down from the tree.',
      'The fox crept past the gate.',
      'The moon rose over the pond.',
    ]);
    expect(scoreSceneTree(withDialogue, { ageBand: 'preschool' }).metrics.dialogueScore).toBe(1);
    expect(scoreSceneTree(noDialogue, { ageBand: 'preschool' }).metrics.dialogueScore).toBe(0);
  });
});

describe('StoryQualityScorer — feedback + determinism', () => {
  it('emits actionable feedback lines for a weak draft', () => {
    const weak = mkTree([
      'The child was nervous about the general situation that day.',
      'Things happened and the child felt happy about everything eventually.',
      'It all worked out in a satisfactory manner for everyone.',
    ]);
    const r = scoreSceneTree(weak, { ageBand: 'preschool' });
    expect(r.total).toBeLessThan(DEFAULT_QUALITY_THRESHOLD);
    expect(r.feedback.length).toBeGreaterThanOrEqual(3);
    expect(r.feedback.join('\n')).toMatch(/Page-turn hooks/);
    expect(r.feedback.join('\n')).toMatch(/Show, don't tell/);
  });

  it('is deterministic — identical input produces an identical report', () => {
    const tree = mkTree(['Where did it go?', 'It hid in the log…', 'The end.']);
    const a = scoreSceneTree(tree, { ageBand: 'preschool' });
    const b = scoreSceneTree(tree, { ageBand: 'preschool' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('StoryQualityScorer — hand-written template stories clear the bar', () => {
  const familyThemes: StoryTheme[] = ['bedtime', 'overcoming-fear', 'silly-quest'];
  const bands: AgeBand[] = ['toddler', 'preschool', 'grade-school'];

  it('maps every theme family as expected', () => {
    expect(templateFamilyForTheme('bedtime')).toBe('gentle-glow');
    expect(templateFamilyForTheme('overcoming-fear')).toBe('brave-step');
    expect(templateFamilyForTheme('silly-quest')).toBe('giggle-quest');
  });

  it('every template family scores >= DEFAULT_QUALITY_THRESHOLD across bands and lengths', () => {
    for (const theme of familyThemes) {
      for (const band of bands) {
        for (const target of [16, 32]) {
          const input = baseInput({ theme, ageBand: band, targetSpreads: target });
          const budget = storyBudgetAllocator.allocate(target);
          const tree = synthesizeTemplateTree(input, ['brave', 'tremble'], budget);
          const r = scoreSceneTree(tree, { ageBand: band, theme });
          expect(
            r.total,
            `${theme}/${band}/${target} scored ${r.total} (metrics ${JSON.stringify(r.metrics)})`,
          ).toBeGreaterThanOrEqual(DEFAULT_QUALITY_THRESHOLD);
        }
      }
    }
  });

  it('templates keep every sentence inside the toddler cap', () => {
    for (const theme of familyThemes) {
      const input = baseInput({ theme, ageBand: 'toddler', targetSpreads: 24 });
      const tree = synthesizeTemplateTree(input, [], storyBudgetAllocator.allocate(24));
      const r = scoreSceneTree(tree, { ageBand: 'toddler', theme });
      expect(r.metrics.sentenceLengthFit, `${theme} toddler fit`).toBe(1);
    }
  });

  it('templates carry a detectable refrain (3+ occurrences) and strong hook coverage', () => {
    for (const theme of familyThemes) {
      const input = baseInput({ theme, targetSpreads: 16 });
      const tree = synthesizeTemplateTree(input, [], storyBudgetAllocator.allocate(16));
      const r = scoreSceneTree(tree, { ageBand: 'preschool', theme });
      expect(r.refrain, `${theme} refrain`).not.toBeNull();
      expect(r.refrain!.count, `${theme} refrain count`).toBeGreaterThanOrEqual(3);
      expect(r.metrics.pageTurnHookCoverage, `${theme} hooks`).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('template spreads all carry illustration briefs that never name the kid', () => {
    for (const theme of familyThemes) {
      const input = baseInput({ kidName: 'Zora', theme, targetSpreads: 16 });
      const tree = synthesizeTemplateTree(input, [], storyBudgetAllocator.allocate(16));
      let heroMentions = 0;
      let total = 0;
      for (const beat of tree.beats) {
        for (const scene of beat.scenes) {
          expect(scene.sceneBrief).not.toMatch(/\bZora\b/);
          for (const spread of scene.spreads) {
            total++;
            expect(spread.illustration_brief, `${theme} spread ${spread.spreadIndex}`).toBeTruthy();
            expect(spread.illustration_brief).not.toMatch(/\bZora\b/);
            if ((spread.illustration_brief ?? '').includes('the hero')) heroMentions++;
          }
        }
      }
      // Most briefs frame the kid as "the hero" (a few are object-only shots).
      expect(heroMentions / total, `${theme} hero-mention ratio`).toBeGreaterThan(0.6);
    }
  });
});
