// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/prompts/user-message-template.ts
//
// Dynamic per-call user message. Compressed per Stage 7+ rules: only the bits
// that change per book go here. Static per-kid context is in the system prompt.

import type { BeatBudgetMap, StoryInput, BeatId } from '../types';
import { BEAT_NAMES, BEAT_PRETEXT_EFFECT } from '../types';

export interface UserMessageArgs {
  input: StoryInput;
  tier2Words: string[];
  beatBudget: BeatBudgetMap;
  /** Optional corrective text from validator/calibrator retry path. */
  correction?: string;
}

export function buildUserMessage(args: UserMessageArgs): string {
  const { input, tier2Words, beatBudget, correction } = args;

  const beatBudgetLines = ([1, 2, 3, 4, 5, 6, 7] as BeatId[])
    .map(
      (id) =>
        `  beat ${id} (${BEAT_NAMES[id]}): ${beatBudget[id]} spread(s)  [pretext effect hint: ${BEAT_PRETEXT_EFFECT[id]}]`,
    )
    .join('\n');

  const supportingCast = input.supportingCast.length
    ? input.supportingCast.map((c) => `${c.role} (id ${c.id})`).join(', ')
    : 'none';

  const lines: string[] = [
    `Write the book.`,
    ``,
    `theme: ${input.theme}`,
    `occasion: ${input.occasion}`,
    `length: ${input.targetSpreads} spreads total`,
    `locale_biome: ${input.localeBiome}`,
    `sidekick_settler_id: ${input.sidekickSettlerId}`,
    `supporting_cast: ${supportingCast}`,
    `tier2_words_to_use (≥2 uses each, varied contexts): ${tier2Words.join(', ')}`,
    `dialogic_prompts_enabled: ${input.dialogicPromptsEnabled ? 'yes' : 'no'}`,
    ``,
    `beat_budget (you MUST hit each beat's spread count exactly):`,
    beatBudgetLines,
    ``,
    `spread indices: 0 through ${input.targetSpreads - 1}, contiguous, beat-ordered.`,
  ];

  if (input.dedicationText && input.dedicationText.length > 0) {
    lines.push('');
    lines.push(`dedication (will be composited at PDF assembly time — do NOT include in beats):`);
    lines.push(`  "${input.dedicationText}"`);
  }

  if (correction && correction.length > 0) {
    lines.push('');
    lines.push('# Corrective addendum (your previous draft failed validation)');
    lines.push(correction);
  }

  return lines.join('\n');
}
