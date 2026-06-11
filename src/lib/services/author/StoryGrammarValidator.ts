// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/StoryGrammarValidator.ts
//
// Stein-Glenn (1979) 6-element story-grammar deterministic validator.
//
// Maps each grammar element to one or more Pixar 7-beat positions:
//
//   setting           ↔ beat 1 (setup)
//   initiating_event  ↔ beats 2-3 (catalyst / early debate)
//   internal_response ↔ beats 3-4 (debate / midpoint)
//   attempt           ↔ beats 4 (midpoint) + 5 (trial)
//   consequence       ↔ beats 5 (trial) + 6 (climax)
//   reaction          ↔ beats 6-7 (climax / resolution)
//
// Validation is HEURISTIC + STRUCTURAL only (no LLM). Designed to fail-fast
// before the orchestrator retries the LLM. Deterministic, cheap, hand-tuned.
//
// 2026-06 un-brittling (fix/story-grammar-gate): the original gate did naive
// single-keyword matching and rejected 5/5 real gemma3:12b drafts whose
// elements were semantically present but phrased outside the keyword list
// ("A sudden breeze rustled the leaves" carried the initiating event but
// "suddenly" never appeared; "Juniper scrambled over the log" was an attempt
// but "scrambled" wasn't a keyword). The e2e run shipped raw drafts through
// an ad-hoc salvage path. This version scores each element with SIGNAL
// FAMILIES (synonym sets + structural signals like onomatopoeia bursts,
// subject+action-verb proximity, body-language phrases, negation-aware
// emotion words) into a per-element confidence 0-1. The gate passes when the
// 6-element average is >= 0.6 AND no element scores 0.
//
// Why not LLM-based: we already used 1 LLM call to generate the tree; the
// validator must be free + deterministic. The orchestrator retries once with
// a coached corrective prompt naming the missing element + an example line,
// and a literarySpineBank template fallback exists behind salvage mode.

import type {
  Beat,
  BeatId,
  GrammarValidationResult,
  SceneTree,
  StoryGrammarElement,
} from './types';

/** Gate passes when mean element confidence is at or above this bar. */
export const GRAMMAR_PASS_AVG = 0.6;

/**
 * Beats whose combined spread text is shorter than this many characters
 * score 0 for every element — guards against shipping empty-prose drafts
 * (observed live: gemma3 draft #2 returned a full beat skeleton with empty
 * `spread_text` everywhere; scene briefs alone must never satisfy the gate).
 */
const MIN_BEAT_TEXT_CHARS = 8;

/**
 * One scoring signal for an element. Families are independent; an element's
 * per-beat confidence is the capped sum of the weights of every family that
 * matched. Weights are tuned so ONE strong family alone (~0.6) clears the
 * per-element share of the pass bar, and weak corroborating families alone
 * (0.2-0.35) keep the element non-zero without overstating confidence.
 */
interface SignalFamily {
  /** Debug label (shows up in nothing user-facing; aids tuning). */
  name: string;
  pattern: RegExp;
  weight: number;
  /**
   * When true, a match is discarded if immediately preceded by a negator
   * ("No worry.", "without feelings", "didn't feel brave"). Applied to
   * emotion-word families where negation flips the meaning.
   */
  negatable?: boolean;
}

// ─── Attempt verb corpus (shared by two families) ───────────────────────────

const ATTEMPT_VERBS =
  'tried|tries|trying|stepped|steps|walked|walks|climbed|climbs|crept|creeps|' +
  'crossed|crosses|scrambled|scrambles|pushed|pushes|pulled|pulls|searched|searches|' +
  'reached|reaches|opened|opens|grabbed|grabs|lifted|lifts|carried|carries|' +
  'followed|follows|tiptoed?|tip-?toed?|ventured|ventures|marched|marches|' +
  'headed|heads|set off|sets off|went|goes|helped|helps|freed|frees|' +
  'built|builds|made|makes|asked|asks|called|calls|practiced|practices|' +
  'chose|chooses|decided|decides|jumped|jumps|swam|swims|ran|runs|dug|digs|peeked|peeks';

/** Subject-ish token (pronoun / proper noun / "the fox") shortly before an attempt verb. */
const ATTEMPT_SUBJECT_VERB = new RegExp(
  `(?:\\b(?:he|she|they|we|I|you|it)\\b|\\b[A-Z][a-z]+\\b|\\bthe\\s+[a-z]+\\b)` +
    `[^.!?\\n]{0,16}\\b(?:${ATTEMPT_VERBS})\\b`,
  '',
);

const ATTEMPT_VERB_ANY = new RegExp(`\\b(?:${ATTEMPT_VERBS})\\b`, 'i');

// ─── Signal families per element ────────────────────────────────────────────

const SIGNALS: Record<StoryGrammarElement, SignalFamily[]> = {
  setting: [
    {
      name: 'story-opener',
      pattern:
        /\b(?:once(?: upon a time)?|long ago|every (?:morning|day|night)|one (?:morning|day|night|afternoon|evening))\b/i,
      weight: 0.6,
    },
    {
      name: 'locative-phrase',
      pattern: /\b(?:in|at|by|near|under|inside|deep in|beside|atop|on)\s+(?:the|a|her|his|their)\s+\w+/i,
      weight: 0.35,
    },
    {
      name: 'place-noun',
      pattern:
        /\b(?:forest|woods|meadow|seaside|sea|ocean|beach|shore|town|village|kitchen|bedroom|garden|cottage|castle|island|home|house|den|cave|mountain|farm|nest|burrow|pond|river|treehouse)\b/i,
      weight: 0.35,
    },
    {
      name: 'stative-habitual-verb',
      pattern: /\b(?:lived|lives|stood|sat|rested|loved|played|grew|was|were|slept)\b/i,
      weight: 0.3,
    },
    {
      name: 'ambient-sensory',
      pattern: /\b(?:smelled|sunbeams?|sunlight|cozy|warm|quiet|peaceful|snug|safe and sound)\b/i,
      weight: 0.25,
    },
  ],

  initiating_event: [
    {
      name: 'temporal-pivot',
      pattern:
        /\b(?:suddenly|sudden|until one day|but then|but when|just then|all at once|out of nowhere|one (?:morning|day|night)|then,?\s)\b/i,
      weight: 0.6,
    },
    {
      name: 'problem-verb',
      pattern:
        /\b(?:arrived|appeared|happened|happens|burst|knocked|came|landed|fell|crash(?:ed)?|broke|rustled|moved|blocked|vanished|disappeared|blew|snapped|shook|rumbled|growled|tumbled|slipped|stopped working)\b/i,
      weight: 0.6,
    },
    {
      name: 'disruption-noun',
      pattern:
        /\b(?:news|letter|stranger|noise|sound|surprise|whisper(?:s|ing)?|shadow|storm|thunder|spark|missing|lost|trouble|mystery)\b/i,
      weight: 0.35,
    },
    {
      name: 'onomatopoeia-burst',
      // Standalone interjection-like sound effects: "Whoosh!", "Tap. Tap.", "Crash!"
      pattern:
        /(?:\b(?:whoosh|crash|bang|boom|thump|rustle|tap|knock|pop|snap|woosh|shhh+|hush)\b\s*[.!…]|[A-Z][a-z]{1,8}!\s)/i,
      weight: 0.35,
    },
    {
      name: 'alert-question',
      pattern: /\b(?:did you hear|what was that|who(?:'s| is) there|where did .{1,24} go)\b/i,
      weight: 0.4,
    },
  ],

  internal_response: [
    {
      name: 'emotion-word',
      pattern:
        /\b(?:felt|feel(?:s|ings?)?|wondered|wonder(?:s|ed)?|thought|worried|worry|worries|hoped|wished|dreamed|imagined|scared|nervous|afraid|frightened|brave|curious|excited|unsure|doubt(?:ed|ful)?|hesitated|gulped)\b/i,
      weight: 0.6,
      negatable: true,
    },
    {
      name: 'body-language',
      pattern:
        /\b(?:heart|breath|tummy|stomach|knees|paw|hands?)\b[^.!?\n]{0,28}\b(?:flip(?:ped)?|pound(?:ed)?|thump(?:ed|-thump)?|wobbl(?:ed|y)|rac(?:ed|ing)|squeezed|fidget(?:ed|ing)|flutter(?:ed)?|shook|trembl(?:ed|ing)|deep)\b/i,
      weight: 0.45,
    },
    {
      name: 'hesitation-deliberation',
      pattern:
        /\b(?:what if|maybe (?:we|she|he|they|i) should|wasn'?t sure|couldn'?t decide|didn'?t know what to do|should (?:we|she|he|they|i)|or\b[^.!?\n]{0,30}\?)\b/i,
      weight: 0.4,
    },
  ],

  attempt: [
    {
      name: 'action-verb',
      pattern: ATTEMPT_VERB_ANY,
      weight: 0.45,
    },
    {
      name: 'subject-plus-action',
      // Hero-subject within the same clause as the action verb (structural signal).
      pattern: ATTEMPT_SUBJECT_VERB,
      weight: 0.25,
    },
    {
      name: 'intent-marker',
      pattern:
        /\b(?:tried to|going to|need(?:s|ed)? to|have to|had to|has to|let'?s|decided to|i'?ll|we'?ll|we can do this|plan(?:ned)?)\b/i,
      weight: 0.35,
    },
    {
      name: 'sequence-marker',
      pattern: /\b(?:first|next|step by step|one step|so (?:they|she|he|it)|then (?:they|she|he|it))\b/i,
      weight: 0.2,
    },
  ],

  consequence: [
    {
      name: 'outcome-verb',
      pattern:
        /\b(?:worked|found|saw|discovered|saved|rescued|freed|managed|succeeded|won|fixed|made it|reached|solved|there it was|caught)\b/i,
      weight: 0.6,
    },
    {
      name: 'setback-marker',
      pattern:
        /\b(?:failed|fell|broke|spilled|stuck|stopped|stumbled|tumbled|tripped|slipped|blocked|wobbled|tangled|did not work|didn'?t work|would not budge|wouldn'?t budge|in (?:the|their|her|his) way|across (?:the|their|her|his) (?:way|path)|grew (?:louder|darker|dim(?:mer)?|colder))\b/i,
      weight: 0.45,
    },
    {
      name: 'contrast-marker',
      pattern: /\b(?:but|however|even though|yet)\b/i,
      weight: 0.25,
    },
    {
      name: 'causal-conclusive',
      pattern: /\b(?:so|because|that'?s why|in the end|at last|finally|at the same time)\b/i,
      weight: 0.25,
    },
  ],

  reaction: [
    {
      name: 'resolution-emotion',
      pattern:
        /\b(?:felt|smiled|laughed|cried|hugged|cheered|sighed|relieved|proud|happy|glad|warm|safe|peaceful|cozy|snug|brave|feelings?)\b/i,
      weight: 0.6,
      negatable: true,
    },
    {
      name: 'closure-marker',
      pattern:
        /\b(?:that night|from then on|after that|that day|ever after|the end|back home|walked home|home again|tucked in(?:to)? bed)\b/i,
      weight: 0.35,
    },
    {
      name: 'learning-marker',
      pattern: /\b(?:loved|treasured|remembered|learned|knew)\b/i,
      weight: 0.35,
    },
    {
      name: 'fear-relief',
      // "the woods didn't seem so scary anymore" — negated fear IS the reaction.
      pattern: /\b(?:didn'?t|did not|no longer|not)\b[^.!?\n]{0,24}\b(?:scary|scared|afraid|frightening)\b/i,
      weight: 0.45,
    },
  ],
};

/** Map element → list of beat IDs where the element CAN legitimately appear. */
const ELEMENT_BEAT_MAP: Record<StoryGrammarElement, BeatId[]> = {
  setting: [1],
  initiating_event: [2, 3],
  internal_response: [3, 4],
  attempt: [4, 5],
  consequence: [5, 6],
  reaction: [6, 7],
};

/** Which elements MUST appear in each beat (primary) — drives beatGaps. */
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

/**
 * Coached one-liners for the retry prompt: name the canonical beat, say what
 * the element IS, and show a 1-line example of prose that satisfies it.
 */
const ELEMENT_COACHING: Record<StoryGrammarElement, string> = {
  setting:
    'Beat 1 must paint where and when the story lives, e.g. "Deep in the whispering woods stood Juniper\'s cozy cottage."',
  initiating_event:
    'Beat 2 must contain the moment the problem starts, e.g. "But when the first thunder rolled, the lights went out."',
  internal_response:
    'Beat 3 must show how the hero feels about the problem, e.g. "Juniper\'s tummy did a flip — what if the dark was full of teeth?"',
  attempt:
    'Beats 4-5 must show the hero actively trying to solve the problem, e.g. "Juniper took a deep breath and stepped onto the wobbly log."',
  consequence:
    'Beats 5-6 must show what the attempt led to — setback or success, e.g. "But the log rolled, and SPLASH — down she went."',
  reaction:
    'Beat 7 must show how the hero feels once it is over, e.g. "Back home, Juniper smiled — the woods didn\'t seem so scary anymore."',
};

export class StoryGrammarValidator {
  /**
   * Score the 6 Stein-Glenn elements over the tree's PAGE PROSE (spread_text
   * only — scene briefs and emotional arcs are production metadata and must
   * never satisfy the gate on their own).
   *
   * Per-element confidence = max across the element's allowed beats of the
   * capped sum of matched signal-family weights in that beat.
   *
   * passed = avg(elementScores) >= GRAMMAR_PASS_AVG AND no element at 0.
   */
  validate(tree: SceneTree): GrammarValidationResult {
    const beatGaps: Record<BeatId, StoryGrammarElement[]> = {
      1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [],
    };
    const elementScores: Record<StoryGrammarElement, number> = {
      setting: 0,
      initiating_event: 0,
      internal_response: 0,
      attempt: 0,
      consequence: 0,
      reaction: 0,
    };

    for (const beat of tree.beats) {
      const beatText = collectBeatText(beat);

      // Required-element sweep → beatGaps (a gap = confidence 0 in that beat).
      const required = BEAT_REQUIRED_ELEMENTS[beat.id] ?? [];
      for (const element of required) {
        if (scoreElementInText(beatText, element) === 0) {
          beatGaps[beat.id].push(element);
        }
      }

      // Permissive sweep — element confidence is the max across allowed beats.
      for (const element of ALL_ELEMENTS) {
        if (!ELEMENT_BEAT_MAP[element].includes(beat.id)) continue;
        const score = scoreElementInText(beatText, element);
        if (score > elementScores[element]) elementScores[element] = score;
      }
    }

    const missing: StoryGrammarElement[] = ALL_ELEMENTS.filter((e) => elementScores[e] === 0);
    const avgScore =
      ALL_ELEMENTS.reduce((sum, e) => sum + elementScores[e], 0) / ALL_ELEMENTS.length;
    const passed = missing.length === 0 && avgScore >= GRAMMAR_PASS_AVG - 1e-9;

    return { passed, missing, beatGaps, elementScores, avgScore: round2(avgScore) };
  }

  /**
   * Build a corrective LLM addendum from a failed validation result.
   * Used by the orchestrator's retry path. For every element at confidence 0
   * the prompt NAMES the element and gives a coached example line; weak
   * (non-zero, sub-bar) elements get a strengthen nudge.
   */
  correctionPrompt(result: GrammarValidationResult): string {
    if (result.passed) return '';
    const lines: string[] = ['Your previous draft is missing required story-grammar elements:'];

    for (const element of result.missing) {
      lines.push(`- ${element}: ${ELEMENT_COACHING[element]}`);
    }

    // Weak-but-present elements: nudge without a full rewrite directive.
    const weak = ALL_ELEMENTS.filter(
      (e) => !result.missing.includes(e) && (result.elementScores[e] ?? 0) < GRAMMAR_PASS_AVG,
    );
    if (weak.length > 0) {
      lines.push(
        `- Present but faint (make these unmistakable): ${weak
          .map((e) => `${e} (${(result.elementScores[e] ?? 0).toFixed(2)})`)
          .join(', ')}`,
      );
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

// ─── Scoring internals ──────────────────────────────────────────────────────

/**
 * The gate judges the prose that lands on the page. sceneBrief +
 * emotional_arc are deliberately EXCLUDED — gemma3 draft #2 shipped a
 * complete skeleton (briefs, arcs) with empty spread_text everywhere, and
 * brief text must never carry the gate.
 */
function collectBeatText(beat: Beat): string {
  const parts: string[] = [];
  for (const scene of beat.scenes ?? []) {
    for (const spread of scene.spreads ?? []) parts.push(spread.spread_text ?? '');
  }
  return parts.join(' ');
}

function scoreElementInText(text: string, element: StoryGrammarElement): number {
  if (!text || text.trim().length < MIN_BEAT_TEXT_CHARS) return 0;
  let sum = 0;
  for (const family of SIGNALS[element]) {
    if (matchesFamily(text, family)) sum += family.weight;
  }
  return Math.min(1, round2(sum));
}

function matchesFamily(text: string, family: SignalFamily): boolean {
  if (!family.negatable) return family.pattern.test(text);
  // Negation-aware scan: discard matches directly preceded by a negator.
  const flags = family.pattern.flags.includes('g')
    ? family.pattern.flags
    : family.pattern.flags + 'g';
  const re = new RegExp(family.pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!isNegated(text, m.index)) return true;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return false;
}

/** "No worry." / "without feelings" / "didn't feel" — negator within ~2 words before the match. */
function isNegated(text: string, matchIndex: number): boolean {
  const windowText = text.slice(Math.max(0, matchIndex - 20), matchIndex);
  return /\b(?:no|not|never|without|isn'?t|wasn'?t|don'?t|didn'?t|doesn'?t|couldn'?t feel)\s+(?:\w+\s+)?$/i.test(
    windowText,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const storyGrammarValidator = new StoryGrammarValidator();
