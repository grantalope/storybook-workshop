// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/DialogicPromptGenerator.ts
//
// Per spec §7.4 (Whitehurst 1988, Mol & Bus 2011): dialogic margin prompts
// follow the CROWD framework (Completion / Recall / Open-ended / Wh-question
// / Distancing) and the PEER protocol (Prompt → Evaluate → Expand → Repeat).
//
// Per-beat defaults (goal markdown Phase 6):
//   setup       → wh-question
//   catalyst    → open-ended
//   debate      → distancing
//   midpoint    → recall
//   trial       → completion
//   climax      → open-ended
//   resolution  → distancing
//
// 1–2 prompts per spread (capped at 2 to avoid clutter).
//
// The orchestrator (Phase 7) supplies these prompts either from the LLM
// (preferred — the LLM has full context) or from a templated fallback
// (this module's `generate`). Module wraps + types the output either way.

import type {
  BeatId,
  DialogicPrompt,
  DialogicPromptType,
  SceneTree,
  StoryInput,
} from './types';
import { BEAT_PROMPT_DEFAULTS } from './types';

export interface DialogicGenerateOptions {
  /** Max prompts per spread. 1 or 2; default 1 (clutter-avoidant). */
  maxPerSpread?: 1 | 2;
}

const TEMPLATES: Record<
  DialogicPromptType,
  (kidName: string, beatHint: string) => { text: string; peerFollowup?: string }
> = {
  'wh-question': (kid, hint) => ({
    text: `Where do you think ${kid} is right now? ${capitalize(hint)}`,
    peerFollowup: `Why do you think that?`,
  }),
  'open-ended': (kid, hint) => ({
    text: `What might ${kid} do next? ${capitalize(hint)}`,
    peerFollowup: `Tell me more about your idea.`,
  }),
  distancing: (kid, hint) => ({
    text: `Have you ever felt like ${kid} does here? ${capitalize(hint)}`,
    peerFollowup: `What did you do that time?`,
  }),
  recall: (kid, _hint) => ({
    text: `Can you remember what ${kid} did earlier in the story?`,
    peerFollowup: `Why do you think that mattered?`,
  }),
  completion: (kid, _hint) => ({
    text: `And then ${kid} ____`,
    peerFollowup: `Yes! Let's keep going.`,
  }),
};

export class DialogicPromptGenerator {
  generate(
    tree: SceneTree,
    input: StoryInput,
    opts: DialogicGenerateOptions = {},
  ): DialogicPrompt[] {
    if (!input.dialogicPromptsEnabled) return [];
    const maxPerSpread = opts.maxPerSpread ?? 1;
    const kidName = input.kidName || 'they';

    const prompts: DialogicPrompt[] = [];
    for (const beat of tree.beats) {
      const beatType = BEAT_PROMPT_DEFAULTS[beat.id];
      for (const scene of beat.scenes) {
        for (const spread of scene.spreads) {
          // primary prompt
          const primaryTpl = TEMPLATES[beatType];
          const primary = primaryTpl(kidName, beat.emotional_arc);
          prompts.push({
            spreadIndex: spread.spreadIndex,
            type: beatType,
            text: primary.text,
            peerFollowup: primary.peerFollowup,
          });

          if (maxPerSpread === 2) {
            const secondary: DialogicPromptType = secondaryType(beat.id);
            const tpl = TEMPLATES[secondary];
            const made = tpl(kidName, beat.emotional_arc);
            prompts.push({
              spreadIndex: spread.spreadIndex,
              type: secondary,
              text: made.text,
              peerFollowup: made.peerFollowup,
            });
          }
        }
      }
    }
    return prompts;
  }

  /** Merge LLM-supplied prompts with type/spread shape; fills missing types from per-beat defaults. */
  normalize(
    llmPrompts: Partial<DialogicPrompt>[],
    tree: SceneTree,
  ): DialogicPrompt[] {
    const beatIdBySpread = new Map<number, BeatId>();
    for (const beat of tree.beats) {
      for (const scene of beat.scenes) {
        for (const spread of scene.spreads) {
          beatIdBySpread.set(spread.spreadIndex, beat.id);
        }
      }
    }
    const out: DialogicPrompt[] = [];
    for (const p of llmPrompts) {
      if (typeof p.spreadIndex !== 'number') continue;
      const beatId = beatIdBySpread.get(p.spreadIndex) ?? 1;
      // Reject any non-CROWD `type` string (e.g. "why-question" from a
      // hallucinated LLM enum) and fall back to the beat default. The
      // downstream UI (margin renderer + advanced-mode Vocabulary
      // Inspector) discriminates on this enum and would break if it
      // received an unknown value.
      const type: DialogicPromptType = isDialogicPromptType(p.type)
        ? p.type
        : BEAT_PROMPT_DEFAULTS[beatId];
      const text = typeof p.text === 'string' && p.text.length > 0 ? p.text : '';
      if (text.length === 0) continue;
      out.push({
        spreadIndex: p.spreadIndex,
        type,
        text,
        peerFollowup: typeof p.peerFollowup === 'string' ? p.peerFollowup : undefined,
      });
    }
    return out;
  }
}

const VALID_PROMPT_TYPES: ReadonlySet<DialogicPromptType> = new Set<DialogicPromptType>([
  'completion',
  'recall',
  'open-ended',
  'wh-question',
  'distancing',
]);

function isDialogicPromptType(t: unknown): t is DialogicPromptType {
  return typeof t === 'string' && VALID_PROMPT_TYPES.has(t as DialogicPromptType);
}

function secondaryType(beatId: BeatId): DialogicPromptType {
  // diversify by pairing primary with a different family
  switch (beatId) {
    case 1: return 'distancing';
    case 2: return 'wh-question';
    case 3: return 'recall';
    case 4: return 'completion';
    case 5: return 'open-ended';
    case 6: return 'distancing';
    case 7: return 'recall';
  }
}

function capitalize(s: string): string {
  if (!s || s.length === 0) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const dialogicPromptGenerator = new DialogicPromptGenerator();
