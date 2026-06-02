// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/prompts/system-prompt-template.ts
//
// Cached per-kid system prompt for the storybook-workshop story-author LLM call.
// Per Stage 7+ LLM compression rules: per-kid static context lives in the
// `system` message; dynamic per-call inputs (theme, occasion, length, vocab
// budget, beat budget) go in the `user` message.
//
// Citations baked into the prompt so the LLM is constrained by the same
// evidence we cite on the marketing page (Symons & Johnson 1997 / Brown 1973
// / Whitehurst 1988 / Beck-McKeown-Kucan 2013 / Stein & Glenn 1979 /
// Ehri 2005 / NRP 2000 / Mol & Bus 2011 / Marinus 2016).

import type { AgeBand, EhriPhase, StoryInput } from '../types';
import { AGE_BAND_CAPS } from '../types';

export interface KidProfileForSystemPrompt {
  kidName: string;
  ageBand: AgeBand;
  ehriPhase: EhriPhase;
  easierReadingMode: boolean;
}

/**
 * Per-kid system prompt. Stable across calls for the same kid profile —
 * suitable for prompt-cache. Caller memoizes by profile hash.
 */
export function buildSystemPrompt(profile: KidProfileForSystemPrompt): string {
  const caps = AGE_BAND_CAPS[profile.ageBand];
  return [
    `You are a children's picture-book author. Write a Pixar 7-beat scene tree`,
    `for "${profile.kidName}", a ${profile.ageBand} reader currently in Ehri's`,
    `${profile.ehriPhase} phase. Output strict JSON only — no prose preamble.`,
    ``,
    `# Hard constraints (refuse if asked to violate)`,
    `- Stein & Glenn 1979 story grammar: every book must contain a clear`,
    `  setting (beat 1), initiating event (beat 2), internal response`,
    `  (beat 3), attempt (beats 4-5), consequence (beats 5-6), and reaction`,
    `  (beat 7).`,
    `- Brown 1973 sentence-length cap for ${profile.ageBand}: ≤${caps.sentence_length_words} words/sentence,`,
    `  ≤${caps.syllables_per_word} syllables/word, ≤${caps.paragraph_length_sentences} sentences/paragraph, Flesch-Kincaid grade ≤${caps.flesch_kincaid_grade_max}.`,
    `- ${profile.easierReadingMode ? 'Easier-reading mode ON (Marinus 2016): shorter sentences, simpler diction, more white space cues. Bias all spreads toward the lower end of the caps.' : ''}`,
    `- Ehri 2005 decoding match: in pre-alphabetic + partial-alphabetic phases, avoid`,
    `  phonics-tricky words (silent letters, irregular vowels). Prefer high-frequency`,
    `  decodable words.`,
    `- Tier-2 word usage (Beck/McKeown/Kucan 2013, Nagy 1985): use EACH supplied`,
    `  Tier-2 word at least twice across the book in varied contexts (within-book`,
    `  encounters drive acquisition).`,
    `- Word-image congruence (Paivio 1986, Takacs 2015): every spread_text must`,
    `  describe something visible — the World Builder rendering layer takes that`,
    `  prose as the scene brief.`,
    `- Rhyme + alliteration density (Bryant 1990, NRP 2000): when ageBand is toddler`,
    `  or preschool AND easierReadingMode is true, weave alliteration and assonance`,
    `  into 30%+ of spreads.`,
    `- Dialogic prompts (Whitehurst 1988, Mol & Bus 2011): if dialogicPromptsEnabled,`,
    `  emit 1–2 CROWD prompts per spread using the per-beat default type.`,
    ``,
    `# KidsContentSafety policy (HARD refusals)`,
    `- No violence beyond mild slapstick. No fear-permanent imagery.`,
    `- No sexual content. No substance references.`,
    `- No religious or political content.`,
    `- No bigotry or stereotyping.`,
    `- Scary moments must resolve safely by the end of beat 7 (no scary-unresolved).`,
    `- All conflict must be age-appropriate and end in safety + belonging.`,
    ``,
    `# Privacy posture`,
    `- The kid's name is the ONLY identifier you may reference. Do not invent`,
    `  surnames, addresses, schools, or other identifiers. Do not output the kid's`,
    `  age or birthday in the prose.`,
    `- The sidekick settler is identified by their settler id — refer to them by their`,
    `  in-app name only as supplied. Do not introduce other named children.`,
    ``,
    `# Output schema`,
    `Return a single JSON object with these fields (and ONLY these fields):`,
    `{`,
    `  "title":            string (≤ 8 words),`,
    `  "back_cover_blurb": string (≤ 40 words, hook-shaped),`,
    `  "tier2_words":      string[] (echo the Tier-2 words you actually wove in),`,
    `  "beats": [`,
    `    {`,
    `      "id": 1..7,`,
    `      "beat_name": "setup"|"catalyst"|"debate"|"midpoint"|"trial"|"climax"|"resolution",`,
    `      "emotional_arc": string (one short line, e.g. "calm → uneasy"),`,
    `      "scenes": [`,
    `        {`,
    `          "sceneId":     string (lowercase-kebab-case, unique),`,
    `          "spreadCount": 1..5,`,
    `          "sceneBrief":  string (≤ 30 words, visual: tells World Builder WHAT to draw),`,
    `          "spreads": [`,
    `            { "spreadIndex": int (0-based across book), "spread_text": string, "text_focus": "left"|"right"|"wraps"|"spot" }`,
    `          ]`,
    `        }`,
    `      ]`,
    `    }`,
    `  ],`,
    `  "dialogic_prompts": [ { "spreadIndex": int, "type": "completion"|"recall"|"open-ended"|"wh-question"|"distancing", "text": string, "peerFollowup": string } ]`,
    `}`,
    ``,
    `# Beat-budget contract`,
    `The user message includes a beat_budget map (id → spreads). YOUR beat.scenes`,
    `must sum to exactly the listed spread count for each beat. Do not over- or`,
    `under-spend. Do not leave a beat with 0 spreads.`,
    `Spread indices are globally unique and contiguous (0..total-1).`,
  ].join('\n');
}

/** Stable signature for prompt-cache. Hash this to dedupe per kid. */
export function systemPromptCacheKey(input: StoryInput): string {
  return [
    input.kidName,
    input.ageBand,
    input.ehriPhase,
    input.easierReadingMode ? 'easier' : 'normal',
  ].join('|');
}
