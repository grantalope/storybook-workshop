// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/StoryGrammarValidator.ts
//
// Stein-Glenn (1979) 6-element story-grammar deterministic validator.
//
// Maps each grammar element to one or more Pixar 7-beat positions:
//
//   setting           ↔ beat 1 (setup)
//   initiating_event  ↔ beat 2 (catalyst)
//   internal_response ↔ beat 3 (debate)
//   attempt           ↔ beats 4 (midpoint) + 5 (trial)
//   consequence       ↔ beats 5 (trial) + 6 (climax)
//   reaction          ↔ beat 7 (resolution)
//
// Validation is KEYWORD + STRUCTURAL only (no LLM). Designed to fail-fast
// before the orchestrator retries the LLM. Deterministic, cheap, hand-tuned.
//
// Why not LLM-based: we already used 1 LLM call to generate the tree; the
// validator must be free + deterministic. False-negative risk vs perfectly
// authored stories is acceptable — the orchestrator retries once with a
// corrective prompt, and a literarySpineBank template fallback exists.

import type {
  Beat,
  BeatId,
  GrammarValidationResult,
  SceneTree,
  StoryGrammarElement,
} from './types';

/** Keyword/phrase indicators per element. Curated; tunable. */
const INDICATORS: Record<StoryGrammarElement, RegExp[]> = {
  setting: [
    /\b(once|long ago|one (?:morning|day|night|afternoon|evening))\b/i,
    /\b(in the|at the|by the|near the)\s+\w+/i,
    /\b(forest|meadow|seaside|town|village|kitchen|bedroom|garden|cottage|castle|shore|island)\b/i,
    /\b(lived|lives|stood|sat|rested)\b/i,
  ],
  initiating_event: [
    /\b(suddenly|one (?:morning|day))\b/i,
    /\b(arrived|appeared|happened|burst|knocked|came|landed|fell|crash)\b/i,
    /\b(news|letter|stranger|noise|sound|surprise|missing|lost)\b/i,
    /\bthen\b/i,
  ],
  internal_response: [
    /\b(felt|wondered|thought|worried|hoped|wished|dreamed|imagined|scared|nervous|brave|curious)\b/i,
    /\b(heart|breath|tummy|stomach)\b/i,
    /\b(wasn'?t sure|couldn'?t decide|didn'?t know what to do)\b/i,
  ],
  attempt: [
    /\b(tried|set off|reached|climbed|crept|searched|asked|called|opened|made|built|crafted|practiced|chose|decided)\b/i,
    /\b(plan|step|first|next|so they|so she|so he)\b/i,
  ],
  consequence: [
    /\b(but|however|even though|did not work|failed|fell|broke|spilled|stuck|stopped|stumbled|tumbled)\b/i,
    /\b(so|because of|that's why|in the end|at last|finally|at the same time)\b/i,
    /\b(worked|found|discovered|saved|reached|managed|succeeded|won|fixed|made it)\b/i,
  ],
  reaction: [
    /\b(felt|smiled|laughed|cried|hugged|cheered|sighed|relieved|proud|happy|warm|safe|home|peaceful|knew)\b/i,
    /\b(that night|from then on|after that|that day|ever after|the end)\b/i,
    /\b(loved|treasured|remembered|learned)\b/i,
  ],
};

/** Map element → list of beat IDs where the element CAN legitimately appear. */
const ELEMENT_BEAT_MAP: Record<StoryGrammarElement, BeatId[]> = {
  setting: [1],
  initiating_event: [2],
  internal_response: [3, 4],
  attempt: [4, 5],
  consequence: [5, 6],
  reaction: [6, 7],
};

/** Which elements MUST appear in each beat (primary). */
const BEAT_REQUIRED_ELEMENTS: Record<BeatId, StoryGrammarElement[]> = {
  1: ['setting'],
  2: ['initiating_event'],
  3: ['internal_response'],
  4: ['attempt'],
  5: ['attempt', 'consequence'],
  6: ['consequence'],
  7: ['reaction'],
};

const ALL_ELEMENTS: StoryGrammarElement[] = [
  'setting',
  'initiating_event',
  'internal_response',
  'attempt',
  'consequence',
  'reaction',
];

export class StoryGrammarValidator {
  /**
   * Check whether the LLM-generated tree exhibits all 6 Stein-Glenn elements,
   * roughly in the canonical beat positions. Returns the missing elements
   * (overall) plus per-beat gaps.
   */
  validate(tree: SceneTree): GrammarValidationResult {
    const beatGaps: Record<BeatId, StoryGrammarElement[]> = {
      1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
    };
    const elementSeen: Record<StoryGrammarElement, boolean> = {
      setting: false,
      initiating_event: false,
      internal_response: false,
      attempt: false,
      consequence: false,
      reaction: false,
    };

    for (const beat of tree.beats) {
      const beatText = collectBeatText(beat);
      const required = BEAT_REQUIRED_ELEMENTS[beat.id];
      for (const element of required) {
        const matched = matchesElement(beatText, element);
        if (matched) elementSeen[element] = true;
        else beatGaps[beat.id].push(element);
      }

      // Also do a permissive sweep — if a beat happens to show another
      // element it's still a valid signal for overall completeness.
      for (const element of ALL_ELEMENTS) {
        if (!elementSeen[element] && ELEMENT_BEAT_MAP[element].includes(beat.id)) {
          if (matchesElement(beatText, element)) elementSeen[element] = true;
        }
      }
    }

    const missing: StoryGrammarElement[] = ALL_ELEMENTS.filter((e) => !elementSeen[e]);
    const anyBeatGaps = (Object.values(beatGaps) as StoryGrammarElement[][]).some((g) => g.length > 0);
    const passed = missing.length === 0 && !anyBeatGaps;

    return { passed, missing, beatGaps };
  }

  /**
   * Build a corrective LLM addendum from a failed validation result.
   * Used by the orchestrator's retry path.
   */
  correctionPrompt(result: GrammarValidationResult): string {
    if (result.passed) return '';
    const lines: string[] = ['Your previous draft is missing required story-grammar elements:'];
    if (result.missing.length > 0) {
      lines.push(`- Missing overall: ${result.missing.join(', ')}`);
    }
    for (const beatIdStr of Object.keys(result.beatGaps)) {
      const id = Number(beatIdStr) as BeatId;
      const gaps = result.beatGaps[id];
      if (gaps.length > 0) {
        lines.push(`- Beat ${id} must include: ${gaps.join(', ')}`);
      }
    }
    lines.push(
      'Please rewrite the affected beats so each required element is explicit in the prose.',
    );
    return lines.join('\n');
  }
}

function collectBeatText(beat: Beat): string {
  const parts: string[] = [beat.emotional_arc];
  for (const scene of beat.scenes ?? []) {
    parts.push(scene.sceneBrief ?? '');
    for (const spread of scene.spreads ?? []) parts.push(spread.spread_text ?? '');
  }
  return parts.join(' ');
}

function matchesElement(text: string, element: StoryGrammarElement): boolean {
  if (!text || text.length === 0) return false;
  for (const pat of INDICATORS[element]) {
    if (pat.test(text)) return true;
  }
  return false;
}

export const storyGrammarValidator = new StoryGrammarValidator();
