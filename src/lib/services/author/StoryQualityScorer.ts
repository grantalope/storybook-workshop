// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/StoryQualityScorer.ts
//
// PURE-FUNCTION prose-quality rubric for ANY SceneTree. No LLM, no I/O, no
// deps — deterministic heuristics over spread texts, so the same tree always
// produces the same report. Two consumers rely on that determinism:
//
//   1. StoryAuthorService post-gen quality gate: score < threshold → ONE
//      regeneration with the rubric feedback injected → accept best-of-2.
//   2. tests/author/story-quality-eval.test.ts (STORY_EVAL=1 live harness)
//      scoring real-LLM output against the same rubric.
//
// Metrics (weights vary by age band — see WEIGHTS):
//   pageTurnHookCoverage — % of non-final spreads that end mid-tension or
//     with a question (the "one more page" mechanic).
//   sentenceLengthFit    — % of sentences within the age-band word cap.
//   cadenceVariety       — sentence-length stddev; varied cadence matters
//     for 5-8yo, not for the toddler drum-beat register.
//   refrainScore         — a repeated line (≥4 words) recurring 3+ times;
//     climax mutations counted via shared 3-word prefix.
//   showDontTell         — penalty per emotion-LABEL construction ("was
//     nervous", "felt happy"); feelings shown via body/action never penalized.
//   concreteness         — concrete-noun density + ≥1 sensory detail/spread.
//   dialogueScore        — spreads containing quoted speech, scored against
//     a 15–65% sweet-spot band.
//
// All heuristics are intentionally cheap, transparent, and hand-tunable.
// They are graders, not gates of truth — the LLM regen prompt quotes the
// feedback lines verbatim, so keep them actionable.

import type { AgeBand, SceneTree, StoryTheme } from './types';
import { AGE_BAND_CAPS } from './types';

// ─── Public shapes ───────────────────────────────────────────────────────────

export interface QualityScoreOptions {
  ageBand: AgeBand;
  theme?: StoryTheme;
}

export interface QualityMetrics {
  /** 0..1 — fraction of non-final spreads ending mid-tension / with a question. */
  pageTurnHookCoverage: number;
  /** 0..1 — fraction of sentences within the age-band word cap. */
  sentenceLengthFit: number;
  /** 0..1 — sentence-length variety (1 for toddler — uniformity is fine there). */
  cadenceVariety: number;
  /** 0..1 — refrain present 3+ times = 1, twice = 0.5, else 0. */
  refrainScore: number;
  /** 0..1 — 1 minus emotion-label penalty (0.33 per label, floor 0). */
  showDontTell: number;
  /** 0..1 — blend of concrete-noun density + per-spread sensory coverage. */
  concreteness: number;
  /** raw 0..1 — fraction of spreads containing quoted speech. */
  dialogueRatio: number;
  /** 0..1 — dialogueRatio scored against the 15–65% sweet spot. */
  dialogueScore: number;
}

export interface QualityReport {
  /** Weighted 0..100. */
  total: number;
  metrics: QualityMetrics;
  /** Raw count of "was nervous"-style emotion-label constructions. */
  emotionLabelCount: number;
  /** Detected refrain (if any line repeats ≥2 times). */
  refrain: { line: string; count: number } | null;
  /** Actionable rubric feedback for the regeneration prompt. */
  feedback: string[];
}

/** Default acceptance bar for StoryAuthorService's post-gen quality gate. */
export const DEFAULT_QUALITY_THRESHOLD = 70;

// ─── Lexicons (curated, kid-book register) ───────────────────────────────────

/** Concrete nouns a kid can point at in an illustration. */
const CONCRETE_WORDS = new Set<string>([
  // animals
  'dog', 'cat', 'fox', 'owl', 'frog', 'toad', 'bear', 'bird', 'fish', 'bee',
  'ant', 'duck', 'hen', 'mouse', 'deer', 'crab', 'whale', 'snail', 'wolf',
  'pony', 'sheep', 'goat', 'pig', 'cow', 'bunny', 'rabbit', 'squirrel',
  'dragon', 'moth', 'moths', 'firefly', 'butterfly', 'worm', 'turtle', 'puppy',
  'kitten', 'beak', 'paw', 'paws', 'tail', 'whiskers', 'wing', 'wings',
  // nature
  'tree', 'trees', 'leaf', 'leaves', 'branch', 'stick', 'stone', 'stones',
  'rock', 'rocks', 'river', 'creek', 'stream', 'pond', 'sea', 'wave', 'waves',
  'sand', 'hill', 'mountain', 'cloud', 'clouds', 'rain', 'snow', 'mud',
  'puddle', 'puddles', 'moss', 'fern', 'ferns', 'flower', 'flowers', 'grass',
  'moon', 'star', 'stars', 'sun', 'wind', 'shadow', 'shadows', 'pine', 'oak',
  'log', 'nest', 'den', 'cave', 'shell', 'seed', 'seeds', 'berry', 'berries',
  'garden', 'meadow', 'forest', 'beach', 'shore', 'path', 'trail', 'footprint',
  // objects
  'door', 'window', 'lantern', 'rope', 'basket', 'boot', 'boots', 'backpack',
  'jar', 'lid', 'spoon', 'cup', 'blanket', 'pillow', 'ladder', 'bridge',
  'boat', 'wagon', 'kite', 'kites', 'drum', 'bell', 'key', 'map', 'torch',
  'whistle', 'net', 'sock', 'socks', 'shoe', 'shoes', 'hat', 'coat', 'button',
  'box', 'bed', 'chair', 'table', 'lamp', 'book', 'page', 'crayon', 'gate',
  'latch', 'fence', 'porch', 'roof', 'wall', 'floor', 'stairs', 'pocket',
  'string', 'line', 'clothespin', 'letter', 'egg', 'crumb', 'crumbs',
  // body
  'hand', 'hands', 'finger', 'fingers', 'toe', 'toes', 'nose', 'ear', 'ears',
  'eye', 'eyes', 'tummy', 'heart', 'cheek', 'cheeks', 'hair', 'foot', 'feet',
  'knee', 'knees', 'shoulder', 'shoulders', 'chin', 'elbow', 'breath',
  // food
  'bread', 'honey', 'apple', 'soup', 'cocoa', 'pancake', 'pancakes', 'jam',
  'cookie', 'cookies', 'milk', 'cheese', 'pie', 'snack',
]);

/** Sensory words: sound (onomatopoeia), touch, temperature, smell, taste, light, color. */
const SENSORY_WORDS = new Set<string>([
  // sound
  'crunch', 'crunched', 'splash', 'splashed', 'drip', 'dripped', 'dripping',
  'thump', 'boom', 'whoosh', 'pop', 'popped', 'fizz', 'squeak', 'creak',
  'rustle', 'rustled', 'hiss', 'buzz', 'crackle', 'tap', 'taps', 'knock',
  'knocked', 'knocking', 'ring', 'boing', 'boinged', 'toot', 'tooted',
  'swoosh', 'tick', 'click', 'clicked', 'squish', 'squished', 'stomp',
  'snore', 'snored', 'flap', 'flapped', 'shuffle', 'puff', 'whisper',
  'whispered', 'whispers', 'giggle', 'giggled', 'hum', 'hummed', 'sang',
  'sing', 'sings', 'song', 'chant', 'hollered', 'tiptoe', 'tiptoed', 'wiggle',
  'wiggled', 'wobble', 'wobbled', 'wobbly', 'rumble', 'rumbled', 'chirp',
  'listen', 'listened', 'roar', 'roared', 'peeped',
  // touch / temperature
  'soft', 'softly', 'rough', 'smooth', 'sticky', 'slippery', 'fuzzy', 'furry',
  'warm', 'cold', 'icy', 'cool', 'hot', 'wet', 'dry', 'damp', 'tight', 'snug',
  'squeezed', 'prickly', 'tickly', 'bumpy', 'bump', 'bumping', 'bumped',
  'snuggled', 'cozy', 'crisp',
  // smell / taste
  'smell', 'smelled', 'smells', 'sniff', 'sniffed', 'sour', 'sweet', 'salty',
  'minty', 'smoky', 'fresh',
  // light / color
  'bright', 'dark', 'dim', 'glow', 'glowed', 'glowing', 'shimmer', 'sparkle',
  'sparkled', 'twinkle', 'twinkled', 'shiny', 'golden', 'gold', 'silver',
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray',
  'stripy', 'spotted', 'sunny', 'moonlit', 'blink', 'blinked', 'spark',
  'flicker', 'flickered', 'muddy',
]);

/** Emotion labels — naming the feeling instead of showing it. */
const EMOTION_LABEL_WORDS = [
  'happy', 'sad', 'angry', 'mad', 'scared', 'afraid', 'nervous', 'worried',
  'excited', 'frightened', 'upset', 'lonely', 'proud', 'shy', 'surprised',
  'frustrated', 'anxious', 'grumpy', 'joyful', 'terrified', 'miserable',
  'embarrassed', 'bored', 'annoyed', 'cheerful', 'gloomy',
];

const EMOTION_LABEL_RE = new RegExp(
  String.raw`\b(?:was|were|is|are|am|be|been|felt|feel|feels|feeling|got|became|become|seemed|seem|looked|looks)` +
    String.raw`\s+(?:so\s+|very\s+|really\s+|quite\s+|a\s+little\s+)?` +
    `(?:${EMOTION_LABEL_WORDS.join('|')})\\b`,
  'gi',
);

/** Cliffhanger sentence openers that read as mid-tension even with a period. */
const HOOK_OPENER_RE = /^(?:but|just then|until|uh-oh|wait|what if|little did)\b/i;

// ─── Weights ─────────────────────────────────────────────────────────────────

interface WeightTable {
  hooks: number;
  fit: number;
  cadence: number;
  refrain: number;
  show: number;
  concrete: number;
  dialogue: number;
}

const YOUNG_WEIGHTS: WeightTable = {
  hooks: 0.22,
  fit: 0.18,
  cadence: 0.05,
  refrain: 0.15,
  show: 0.15,
  concrete: 0.15,
  dialogue: 0.1,
};

const WEIGHTS: Record<AgeBand, WeightTable> = {
  toddler: YOUNG_WEIGHTS,
  preschool: YOUNG_WEIGHTS,
  // Grade-school: refrain optional (weight 0); cadence + specificity matter more.
  'grade-school': {
    hooks: 0.25,
    fit: 0.15,
    cadence: 0.12,
    refrain: 0,
    show: 0.18,
    concrete: 0.18,
    dialogue: 0.12,
  },
};

// ─── Main entry point ────────────────────────────────────────────────────────

export function scoreSceneTree(tree: SceneTree, opts: QualityScoreOptions): QualityReport {
  const spreads = flattenSpreadTexts(tree);
  const allText = spreads.join(' ');
  const sentences = spreads.flatMap((t) => splitSentences(t));
  const caps = AGE_BAND_CAPS[opts.ageBand];

  // 1) page-turn hooks (non-final spreads only)
  const nonFinal = spreads.slice(0, Math.max(0, spreads.length - 1));
  const hookCount = nonFinal.filter((t) => hasPageTurnHook(t)).length;
  const pageTurnHookCoverage = nonFinal.length === 0 ? 1 : hookCount / nonFinal.length;

  // 2) sentence-length fit vs age band
  const lengths = sentences.map((s) => tokenize(s).length).filter((n) => n > 0);
  const fitCount = lengths.filter((n) => n <= caps.sentence_length_words).length;
  const sentenceLengthFit = lengths.length === 0 ? 0 : fitCount / lengths.length;

  // 3) cadence variety
  const cadenceVariety = computeCadence(lengths, opts.ageBand);

  // 4) refrain
  const refrainHit = detectRefrain(sentences);
  const refrainScore = refrainHit && refrainHit.count >= 3 ? 1 : refrainHit && refrainHit.count === 2 ? 0.5 : 0;

  // 5) show-don't-tell
  const emotionLabelCount = (allText.match(EMOTION_LABEL_RE) ?? []).length;
  const showDontTell = clamp01(1 - emotionLabelCount / 3);

  // 6) concreteness (density + sensory coverage)
  const tokens = tokenize(allText);
  const concreteHits = tokens.filter((w) => CONCRETE_WORDS.has(w)).length;
  const density = tokens.length === 0 ? 0 : concreteHits / tokens.length;
  const densityScore = clamp01(density / 0.08);
  const sensoryCoverage =
    spreads.length === 0
      ? 0
      : spreads.filter((t) => tokenize(t).some((w) => SENSORY_WORDS.has(w))).length / spreads.length;
  const concreteness = 0.5 * densityScore + 0.5 * sensoryCoverage;

  // 7) dialogue
  const dialogueSpreads = spreads.filter((t) => hasDialogue(t)).length;
  const dialogueRatio = spreads.length === 0 ? 0 : dialogueSpreads / spreads.length;
  const dialogueScore = scoreDialogue(dialogueRatio);

  const metrics: QualityMetrics = {
    pageTurnHookCoverage,
    sentenceLengthFit,
    cadenceVariety,
    refrainScore,
    showDontTell,
    concreteness,
    dialogueRatio,
    dialogueScore,
  };

  const w = WEIGHTS[opts.ageBand];
  const total = Math.round(
    100 *
      (w.hooks * pageTurnHookCoverage +
        w.fit * sentenceLengthFit +
        w.cadence * cadenceVariety +
        w.refrain * refrainScore +
        w.show * showDontTell +
        w.concrete * concreteness +
        w.dialogue * dialogueScore),
  );

  const feedback = buildFeedback(metrics, emotionLabelCount, opts.ageBand, caps.sentence_length_words);

  return {
    total,
    metrics,
    emotionLabelCount,
    refrain: refrainHit,
    feedback,
  };
}

// ─── Heuristics ──────────────────────────────────────────────────────────────

/** Flatten all spread texts in spreadIndex order. */
function flattenSpreadTexts(tree: SceneTree): string[] {
  const out: { idx: number; text: string }[] = [];
  for (const beat of tree.beats ?? []) {
    for (const scene of beat.scenes ?? []) {
      for (const spread of scene.spreads ?? []) {
        out.push({ idx: spread.spreadIndex ?? out.length, text: spread.spread_text ?? '' });
      }
    }
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.map((o) => o.text);
}

/**
 * Read-aloud sentence splitter. Colon included: a chant intro ("she sang:")
 * is its own breath unit when read to a kid.
 */
export function splitSentences(text: string): string[] {
  return (text ?? '')
    .split(/(?<=[.?!…:])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenize(text: string): string[] {
  return (text ?? '').toLowerCase().match(/[a-z']+/g) ?? [];
}

/** Does this spread end mid-tension or with a question? */
export function hasPageTurnHook(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length === 0) return false;
  // Strip trailing quotes/brackets so `…?"` still reads as a question end.
  const stripped = t.replace(/["'“”‘’»›)\]]+$/u, '').trimEnd();
  if (/\?$/.test(stripped)) return true;
  if (/(?:\.{3}|…)$/.test(stripped)) return true;
  if (/(?:—|–|--)$/.test(stripped)) return true;
  const sentences = splitSentences(t);
  const last = (sentences[sentences.length - 1] ?? '').replace(/^["'“”‘’«‹(\[]+/u, '').trimStart();
  return HOOK_OPENER_RE.test(last);
}

function computeCadence(lengths: number[], ageBand: AgeBand): number {
  // Toddler register: short uniform drum-beats are the GOAL, not a flaw.
  if (ageBand === 'toddler') return 1;
  if (lengths.length < 4) return 1;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lengths.length;
  const stdev = Math.sqrt(variance);
  return clamp01(stdev / 3);
}

/**
 * Detect a refrain: a sentence of ≥4 words recurring across the book.
 * Mutated refrains ("…which way is home?" → "…THIS way is home!") are
 * grouped via a shared 3-word prefix so the climax mutation still counts.
 */
function detectRefrain(sentences: string[]): { line: string; count: number } | null {
  const groups = new Map<string, { count: number; line: string }>();
  for (const s of sentences) {
    const toks = tokenize(s);
    if (toks.length < 4) continue;
    const key = toks.slice(0, 3).join(' ');
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { count: 1, line: s.trim() });
  }
  let best: { line: string; count: number } | null = null;
  for (const g of groups.values()) {
    if (g.count >= 2 && (!best || g.count > best.count)) best = { line: g.line, count: g.count };
  }
  return best;
}

function hasDialogue(text: string): boolean {
  return ((text ?? '').match(/["“”]/g) ?? []).length >= 2;
}

function scoreDialogue(ratio: number): number {
  const lo = 0.15;
  const hi = 0.65;
  if (ratio >= lo && ratio <= hi) return 1;
  if (ratio < lo) return clamp01(ratio / lo);
  return clamp01((1 - ratio) / (1 - hi));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ─── Feedback (quoted verbatim in the regen prompt — keep actionable) ────────

function buildFeedback(
  m: QualityMetrics,
  emotionLabelCount: number,
  ageBand: AgeBand,
  sentenceCap: number,
): string[] {
  const out: string[] = [];
  const pct = (n: number) => Math.round(n * 100);

  if (m.pageTurnHookCoverage < 0.7) {
    out.push(
      `Page-turn hooks: only ${pct(m.pageTurnHookCoverage)}% of non-final spreads end mid-tension or with a question. End almost every spread (except the last) with a question, an unresolved "But…", or a trailing "…" so the reader MUST turn the page.`,
    );
  }
  if (m.sentenceLengthFit < 0.8) {
    out.push(
      `Sentence length: only ${pct(m.sentenceLengthFit)}% of sentences fit the ${ageBand} cap of ${sentenceCap} words. Read each long sentence aloud — if you run out of breath, split it.`,
    );
  }
  if (ageBand !== 'toddler' && m.cadenceVariety < 0.6) {
    out.push(
      'Cadence: sentence lengths are too uniform. Mix 2-4 word punches ("Tap. Tap. Nothing.") with longer rolling sentences so the read-aloud rhythm breathes.',
    );
  }
  if (ageBand !== 'grade-school' && m.refrainScore < 1) {
    out.push(
      'Refrain: add one repeated line (a little song or chant the hero says) that appears at least 3 times across the book and CHANGES at the climax.',
    );
  }
  if (emotionLabelCount > 0) {
    out.push(
      `Show, don't tell: found ${emotionLabelCount} emotion-label phrase(s) like "was nervous" / "felt happy". Show the feeling in the body instead — "squeezed her backpack straps", "tummy did a flip".`,
    );
  }
  if (m.concreteness < 0.7) {
    out.push(
      'Specificity: the prose is too abstract. Use concrete nouns and verbs a kid can point at in the picture, and give every spread exactly one vivid sensory detail (a sound, a smell, a texture, a color).',
    );
  }
  if (m.dialogueScore < 0.7) {
    out.push(
      `Dialogue: ${pct(m.dialogueRatio)}% of spreads contain spoken lines. Aim for roughly one spread in three carrying a short, character-true spoken line in quotes.`,
    );
  }
  return out;
}
