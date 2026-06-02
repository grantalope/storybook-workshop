// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/templateFallback.ts
//
// Deterministic Pixar 7-beat template synthesizer. Fires when the LLM path
// exhausts retries or returns wholly unusable output. Guarantees a valid
// SceneTree of the right shape so the downstream goals (assembler, UI) never
// see an undefined tree.
//
// The template intentionally uses generic age-band-safe prose — it isn't
// trying to be GOOD, it's trying to be SAFE + STRUCTURALLY VALID so the user
// can still get a printable book (per spec §3.5 fallback contract).
//
// The orchestrator surfaces telemetry (`meta.template_fallback = true`) so
// the advanced-mode inspector (goal #7) can flag it to the parent.

import {
  BEAT_NAMES,
  type Beat,
  type BeatBudgetMap,
  type BeatId,
  type Scene,
  type SceneTree,
  type Spread,
  type StoryInput,
} from './types';

interface TemplateBeatBlueprint {
  emotional_arc: string;
  sceneBriefTemplate: (input: StoryInput) => string;
  /** Templated spread lines. The synthesizer cycles through these. */
  spreadLines: (input: StoryInput, tier2: string[]) => string[];
}

const BLUEPRINTS: Record<BeatId, TemplateBeatBlueprint> = {
  1: {
    emotional_arc: 'calm and curious',
    sceneBriefTemplate: (i) =>
      `the hero in the ${i.localeBiome}, settled into a small everyday moment.`,
    spreadLines: (i, t) => [
      `${i.kidName} stood very still and looked around the ${i.localeBiome}.`,
      `It was a ${t[0] ?? 'peaceful'} kind of morning.`,
      `Everything felt soft and ${t[1] ?? 'cozy'}.`,
    ],
  },
  2: {
    emotional_arc: 'curious turning to surprised',
    sceneBriefTemplate: (i) =>
      `the hero notices something unexpected at the edge of the ${i.localeBiome}.`,
    spreadLines: (i, t) => [
      `Then ${i.kidName} saw something new at the edge of the ${i.localeBiome}.`,
      `It made a ${t[2] ?? 'gentle'} sound.`,
      `What could it be?`,
    ],
  },
  3: {
    emotional_arc: 'a small worry',
    sceneBriefTemplate: (_i) =>
      `the hero pauses, thinking about whether to step closer or stay back.`,
    spreadLines: (i, _t) => [
      `${i.kidName} felt a wiggly feeling in their tummy.`,
      `Should they go closer, or stay where it was safe?`,
      `${i.kidName} thought for a long moment.`,
    ],
  },
  4: {
    emotional_arc: 'gathering courage',
    sceneBriefTemplate: (_i) =>
      `the hero takes a careful step forward with their sidekick beside them.`,
    spreadLines: (i, t) => [
      `So ${i.kidName} took one ${t[3] ?? 'brave'} little step.`,
      `Their friend stepped right beside them.`,
      `Together, they tried to find out more.`,
    ],
  },
  5: {
    emotional_arc: 'trying and stumbling',
    sceneBriefTemplate: (_i) =>
      `the hero tries something but it does not work the first time.`,
    spreadLines: (i, t) => [
      `${i.kidName} tried, but it did not work right away.`,
      `They wobbled and almost gave up.`,
      `But they remembered something ${t[0] ?? 'gentle'} they had learned.`,
    ],
  },
  6: {
    emotional_arc: 'the big moment',
    sceneBriefTemplate: (_i) =>
      `the hero faces the moment of greatest challenge and finds a way through.`,
    spreadLines: (i, t) => [
      `Then ${i.kidName} did the thing that felt impossible.`,
      `They stood ${t[1] ?? 'tall'} and steady.`,
      `And finally, they did it!`,
    ],
  },
  7: {
    emotional_arc: 'safe and warm',
    sceneBriefTemplate: (i) =>
      `the hero returns home to the ${i.localeBiome}, peaceful and proud.`,
    spreadLines: (i, t) => [
      `${i.kidName} smiled a big quiet smile.`,
      `Everything felt ${t[2] ?? 'warm'} and safe again.`,
      `They knew they were ${t[3] ?? 'brave'} now.`,
    ],
  },
};

/**
 * Build a complete SceneTree from the deterministic template.
 *
 * Postconditions:
 *   - tree.beats.length === 7
 *   - sum(beat.scene.spreads) === input.targetSpreads
 *   - every beat has ≥ 1 scene; every scene has ≥ 1 spread
 *   - spread.spreadIndex is contiguous 0..targetSpreads-1
 *   - tree.tier2_words === supplied tier2Words
 *   - tree.title + tree.back_cover_blurb are non-empty strings
 */
export function synthesizeTemplateTree(
  input: StoryInput,
  tier2Words: string[],
  budget: BeatBudgetMap,
): SceneTree {
  const beats: Beat[] = [];
  let nextSpreadIndex = 0;

  for (let i = 1; i <= 7; i++) {
    const id = i as BeatId;
    const bp = BLUEPRINTS[id];
    const target = Math.max(1, budget[id]); // min-1 invariant
    const scenes = buildScenes(id, bp, input, tier2Words, target, nextSpreadIndex);
    nextSpreadIndex += target;
    beats.push({
      id,
      beat_name: BEAT_NAMES[id],
      emotional_arc: bp.emotional_arc,
      scenes,
    });
  }

  return {
    title: `${input.kidName} and the ${capitalize(input.theme.replace(/-/g, ' '))}`,
    back_cover_blurb: `${input.kidName} and a brave friend find courage in the ${input.localeBiome}. A ${input.theme.replace(/-/g, ' ')} story to read together.`,
    page_budget: input.targetSpreads,
    beats,
    tier2_words: [...tier2Words],
  };
}

function buildScenes(
  beatId: BeatId,
  bp: TemplateBeatBlueprint,
  input: StoryInput,
  tier2Words: string[],
  totalSpreads: number,
  startingIndex: number,
): Scene[] {
  // If beat has ≤3 spreads we use ONE scene of that spread count.
  // If more, split into ceil(totalSpreads/3) scenes of ≤3 spreads each (max 5 per spec).
  const scenes: Scene[] = [];
  const lines = bp.spreadLines(input, tier2Words);
  let lineCursor = 0;
  let spreadCursor = startingIndex;
  let remaining = totalSpreads;
  let sceneIdx = 1;

  while (remaining > 0) {
    const sceneSize = Math.min(5, Math.min(3, remaining));
    const spreads: Spread[] = [];
    for (let s = 0; s < sceneSize; s++) {
      const text = lines[lineCursor % lines.length];
      lineCursor++;
      spreads.push({
        spreadIndex: spreadCursor++,
        spread_text: text,
        text_focus: alternateFocus(spreadCursor),
      });
    }
    scenes.push({
      sceneId: `${BEAT_NAMES[beatId]}-${sceneIdx++}`,
      spreadCount: sceneSize as Scene['spreadCount'],
      sceneBrief: bp.sceneBriefTemplate(input),
      spreads,
    });
    remaining -= sceneSize;
  }
  return scenes;
}

function alternateFocus(spreadCursor: number): Spread['text_focus'] {
  const cycle = ['left', 'right', 'wraps', 'spot'] as const;
  return cycle[spreadCursor % cycle.length];
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
