// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/templateFallback.ts
//
// Deterministic Pixar 7-beat template synthesizer. Fires when the LLM path
// exhausts retries or returns wholly unusable output. Guarantees a valid
// SceneTree of the right shape so the downstream goals (assembler, UI) never
// see an undefined tree.
//
// 2026-06 storyteller-quality overhaul: the fallback is no longer "safe but
// flat". Three HAND-WRITTEN template stories (one per theme family) carry the
// same craft rules the LLM prompt demands and the StoryQualityScorer grades:
//   - page-turn hooks: every beats-1-6 line ends mid-tension or with a question
//   - a question-shaped REFRAIN that recurs (beats 3/4/5 first-lines, so it
//     survives the smallest budgets) and MUTATES at the climax (beat 6)
//   - show-don't-tell (body language, never "felt nervous")
//   - concrete nouns + one sensory detail per spread
//   - sprinkled dialogue
//   - toddler-safe sentence lengths (≤8 words/sentence) so one template
//     serves every age band
//   - per-spread illustration_brief written for an image model ("the hero",
//     never the kid's name — briefs may leave the device; prose does not)
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
  type StoryTheme,
} from './types';

// ─── Template story shapes ───────────────────────────────────────────────────

export type TemplateFamily = 'gentle-glow' | 'brave-step' | 'giggle-quest';

interface TemplateLine {
  text: (i: StoryInput) => string;
  brief: (i: StoryInput) => string;
}

interface TemplateStory {
  family: TemplateFamily;
  title: (i: StoryInput) => string;
  blurb: (i: StoryInput) => string;
  arcs: Record<BeatId, string>;
  lines: Record<BeatId, TemplateLine[]>;
}

/** Which hand-written story serves which theme. */
const THEME_FAMILY: Record<StoryTheme, TemplateFamily> = {
  bedtime: 'gentle-glow',
  'new-baby-arrives': 'gentle-glow',
  kindness: 'gentle-glow',
  'saying-goodbye': 'gentle-glow',
  friendship: 'gentle-glow',
  'overcoming-fear': 'brave-step',
  'first-day': 'brave-step',
  'lost-and-found': 'brave-step',
  'sibling-rivalry': 'brave-step',
  'silly-quest': 'giggle-quest',
  adventure: 'giggle-quest',
  curiosity: 'giggle-quest',
};

export function templateFamilyForTheme(theme: StoryTheme): TemplateFamily {
  return THEME_FAMILY[theme] ?? 'brave-step';
}

// ─── Story 1: gentle-glow — "the Lantern Light" ─────────────────────────────
// Refrain: "Glow, little glow, which way is home?" (beats 3/4/5)
// Climax mutation: "Glow, little glow, THIS way is home!"

const GENTLE_GLOW: TemplateStory = {
  family: 'gentle-glow',
  title: (i) => `${i.kidName} and the Lantern Light`,
  blurb: () =>
    `One firefly. One dark path. One small hero singing the way home. Read it twice — the glow stays.`,
  arcs: {
    1: 'calm and curious',
    2: 'surprise on the wind',
    3: 'a small worry, a small song',
    4: 'one brave foot, then the other',
    5: 'a slip, a soggy boot, more song',
    6: 'still… still… GLOW',
    7: 'home, warm, and glowing',
  },
  lines: {
    1: [
      {
        text: (i) =>
          `The sun slid low over the ${i.localeBiome}. ${i.kidName} held the lantern jar. One sleepy firefly blinked inside… blink… blink…`,
        brief: (i) =>
          `the hero at dusk in the ${i.localeBiome}, holding a glass lantern jar with one glowing firefly, warm low light, wide calm shot`,
      },
      {
        text: (i) =>
          `Moths drew soft circles in the light. ${i.kidName} whispered, "Time to go home. But which way?"`,
        brief: (i) =>
          `close on the hero whispering to the lantern jar, moths circling above, golden dusk, edges of the ${i.localeBiome} going dark`,
      },
      {
        text: () =>
          `The path split like a wishbone. One way smelled of pine. One way smelled of… something else…`,
        brief: (i) =>
          `a forked path before the hero, two trails fading into shadow, small lantern glow, tall ${i.localeBiome} shapes`,
      },
    ],
    2: [
      {
        text: () =>
          `Then — whoosh! — cold wind huffed past. The lantern door popped open. Where did the firefly go?`,
        brief: (i) =>
          `a gust of wind bursting the lantern door open, the firefly streaking away over the ${i.localeBiome}, the hero reaching out, deep blue evening`,
      },
      {
        text: (i) =>
          `One tiny spark bobbed far ahead. Could ${i.kidName} catch it before true night?`,
        brief: () =>
          `a tiny firefly spark far down the dark path, the hero holding the empty jar, first stars out`,
      },
    ],
    3: [
      {
        text: (i) =>
          `${i.kidName}'s tummy went tight as a knot. They hugged the jar and sang: "Glow, little glow, which way is home?"`,
        brief: () =>
          `the hero hugging the empty jar on the dark path, knees tucked, the firefly spark drifting further away, cool night blues`,
      },
      {
        text: () =>
          `Go back? Go on? The dark looked big as a whale. But the little spark waited…`,
        brief: () =>
          `the hero small between two dark trails, the faraway spark hovering and waiting, jar glinting`,
      },
    ],
    4: [
      {
        text: (i) =>
          `${i.kidName} stood up tall and tiptoed on. Tip-tip-tip, soft as snow. "Glow, little glow, which way is home?"`,
        brief: () =>
          `the hero tiptoeing along the path holding the jar out, the spark a little closer, moonrise behind the trees`,
      },
      {
        text: (i) =>
          `The spark dipped under a fern. ${i.kidName} crawled after it. Mud squished between their fingers — squish, squish…`,
        brief: () =>
          `the hero crawling under ferns after the spark, hands in soft mud, playful low angle, leaf shadows`,
      },
      {
        text: (i) =>
          `"Almost…" ${i.kidName} whispered. The firefly hopped to a stone. Then to a stump. Then — where?`,
        brief: () =>
          `the firefly hopping from stone to stump, the hero following with cupped hands, dotted trail of faint glow`,
      },
    ],
    5: [
      {
        text: (i) =>
          `At the creek, ${i.kidName} sang it soft: "Glow, little glow, which way is home?"`,
        brief: () =>
          `the hero at the creek edge, dark water sliding past, the spark hovering over the far bank`,
      },
      {
        text: (i) =>
          `${i.kidName} stretched for the spark — and slipped! Splash! Cold water soaked one boot. The jar rolled… and rolled…`,
        brief: () =>
          `the hero slipping at the creek edge, splash frozen mid-air, the jar rolling toward the water, the spark circling above`,
      },
      {
        text: (i) =>
          `${i.kidName} gripped a root and pulled up. One boot dripped. But quit now? Never…`,
        brief: () =>
          `the hero pulling up by a tree root, one dripping boot, jaw set, jar safe in one hand`,
      },
    ],
    6: [
      {
        text: (i) =>
          `The firefly landed on the jar lid. ${i.kidName} held still… still… and sang: "Glow, little glow, THIS way is home!"`,
        brief: () =>
          `the firefly landing on the jar lid, the hero perfectly still with wide eyes, glow lighting their face`,
      },
      {
        text: () =>
          `Tick! The lid clicked shut, soft as a yawn. Gold light spilled over the stones. Could they find the path now?`,
        brief: () =>
          `the jar full of golden light, stones lit warm around the hero's boots, the path appearing out of the dark`,
      },
      {
        text: (i) =>
          `Step by step, glow by glow, ${i.kidName} marched. The trees opened like curtains. And there — was that a porch light?`,
        brief: () =>
          `the hero marching with the glowing jar raised, trees parting to reveal a distant warm porch light`,
      },
    ],
    7: [
      {
        text: (i) =>
          `Home. Porch light. Warm bread smell. ${i.kidName} let the firefly go. Up, up, into the stars.`,
        brief: () =>
          `the hero on the porch releasing the firefly upward, stars out, front door open with warm light`,
      },
      {
        text: (i) =>
          `"Thank you, little glow," ${i.kidName} whispered. The spark blinked twice. Like a wink. Like a friend.`,
        brief: () =>
          `the tiny spark blinking twice above the porch, the hero waving goodnight, cozy night colors`,
      },
      {
        text: (i) =>
          `Sleep came soft and slow. And a small gold light glowed on. Right inside ${i.kidName}'s dreams.`,
        brief: () =>
          `the hero asleep in bed, a faint golden glow above the blanket, crescent moon in the window`,
      },
    ],
  },
};

// ─── Story 2: brave-step — "the Tall Gate" ──────────────────────────────────
// Refrain: "Big or small, who walks tall?" (beats 3/4/5)
// Climax mutation: "Big or small, I walk TALL!"

const BRAVE_STEP: TemplateStory = {
  family: 'brave-step',
  title: (i) => `${i.kidName} and the Tall Gate`,
  blurb: (i) =>
    `Something keeps knocking behind the Tall Gate. ${i.kidName} packs one map, one whistle, and one walking song. Who walks tall?`,
  arcs: {
    1: 'morning, boots, and a flutter',
    2: 'the gate knocks first',
    3: 'wobbly knees, steady song',
    4: 'one step, two steps, crunch',
    5: 'jump, miss, stack, stretch',
    6: 'CLICK — tall after all',
    7: 'gate-sized, after all',
  },
  lines: {
    1: [
      {
        text: (i) =>
          `Morning poked over the ${i.localeBiome}. ${i.kidName} laced both boots extra tight. Today was the day… wasn't it?`,
        brief: (i) =>
          `the hero lacing boots at dawn at the edge of the ${i.localeBiome}, packed backpack waiting, long soft shadows`,
      },
      {
        text: (i) =>
          `In the backpack: one map, one apple, one red whistle. ${i.kidName} squeezed the straps. Ready? Almost ready…`,
        brief: () =>
          `backpack contents laid out, map and apple and red whistle, the hero's hands gripping the straps`,
      },
      {
        text: (i) =>
          `Across the ${i.localeBiome} stood the Tall Gate. Dark. Tall. Taller than trees. Who could knock on THAT?`,
        brief: (i) =>
          `a distant towering gate looming over the ${i.localeBiome}, tiny hero silhouette facing it, big sky`,
      },
    ],
    2: [
      {
        text: () =>
          `Then the wind brought a sound. Knock… knock… KNOCK. The Tall Gate was knocking first. What waited behind it?`,
        brief: () =>
          `the gate shaking with each knock, leaves blowing past, the hero alert in a wide stance`,
      },
      {
        text: (i) =>
          `The sidekick tugged ${i.kidName}'s sleeve. "We could turn back," they said softly. Turn back? Hmm…`,
        brief: () =>
          `the sidekick tugging the hero's sleeve, both looking up at the gate, unsure body language`,
      },
    ],
    3: [
      {
        text: (i) =>
          `${i.kidName}'s knees wobbled like jelly. So ${i.kidName} whispered the walking song: "Big or small, who walks tall?"`,
        brief: () =>
          `the hero mid-whisper with comically bent knees, the sidekick listening close, the gate far behind`,
      },
      {
        text: (i) =>
          `Run home? Hide in the ferns? The whistle bumped ${i.kidName}'s chest. Tap, tap — like a tiny drum…`,
        brief: () =>
          `close on the red whistle on its string tapping the hero's chest, ferns swaying nearby`,
      },
    ],
    4: [
      {
        text: (i) =>
          `${i.kidName} stood up straight and took one step. Crunch. "Big or small, who walks tall?"`,
        brief: () =>
          `the hero taking a first step on the gravel path, chin up, the sidekick one pace behind`,
      },
      {
        text: () =>
          `Step two crunched louder. Step three splashed a puddle. The Gate grew bigger… and bigger…`,
        brief: () =>
          `the hero striding through puddles, the gate looming larger overhead, determined small figure`,
      },
      {
        text: (i) =>
          `The sidekick offered a hand. "I can do this part," said ${i.kidName}. But the shiny latch sat SO high…`,
        brief: () =>
          `the hero politely waving off help, reaching toward a high gate latch, the sidekick cheering`,
      },
    ],
    5: [
      {
        text: (i) =>
          `At the Gate, ${i.kidName} sang once more: "Big or small, who walks tall?"`,
        brief: () =>
          `the hero at the base of the towering gate, neck craned all the way up, singing`,
      },
      {
        text: (i) =>
          `${i.kidName} jumped for the latch — and missed. Thump. The apple rolled out of the backpack. Was that the end?`,
        brief: () =>
          `the hero landing after a missed jump, the apple rolling away, the latch still out of reach`,
      },
      {
        text: (i) =>
          `No. ${i.kidName} stacked two cool flat stones. Then climbed. Then stretched — fingers out — almost… almost…`,
        brief: () =>
          `the hero balancing on stacked stones, arm stretched, fingertips just below the latch`,
      },
    ],
    6: [
      {
        text: (i) =>
          `CLICK! The latch lifted. ${i.kidName} pushed the Gate wide and shouted: "Big or small, I walk TALL!"`,
        brief: () =>
          `the gate swinging open with the hero mid-shout, light pouring through the widening gap`,
      },
      {
        text: () =>
          `And behind the Tall Gate? A garden full of kites! The knocking? Just one loose kite door, bumping away. Who tied THAT many kites?`,
        brief: () =>
          `reveal of a walled garden full of bright kites, one loose kite-door bumping, the hero amazed`,
      },
      {
        text: (i) =>
          `${i.kidName} laughed so hard the whistle tooted. Toot! The sidekick cartwheeled. What would they fly first?`,
        brief: () =>
          `the hero laughing with the whistle mid-toot, the sidekick cartwheeling among kites`,
      },
    ],
    7: [
      {
        text: (i) =>
          `That night, ${i.kidName} drew the Tall Gate. Small. Just gate-sized. Knock, knock — no answer needed now.`,
        brief: () => `the hero drawing at a desk, the gate small on paper, warm lamp glow`,
      },
      {
        text: (i) =>
          `The whistle hung by the bed. The map got a gold star. And the walking song lived in ${i.kidName}'s boots.`,
        brief: () =>
          `bedroom wall with the whistle and a starred map, boots by the door, moonlight`,
      },
      {
        text: (i) =>
          `Some gates are tall. Some days are wobbly. But ${i.kidName} knew the song by heart.`,
        brief: () => `the hero asleep smiling, the gate and kites floating in a dream cloud`,
      },
    ],
  },
};

// ─── Story 3: giggle-quest — "the Runaway Sock" ─────────────────────────────
// Refrain: "Hoppity-bop — where did it stop?" (beats 3/4/5, bonus in beat 2)
// Climax mutation: "Hoppity-bop — THERE it stopped!"

const GIGGLE_QUEST: TemplateStory = {
  family: 'giggle-quest',
  title: (i) => `${i.kidName} and the Runaway Sock`,
  blurb: () =>
    `Socks do not hop. Except today. Grab your net, follow the boing, and count your socks twice!`,
  arcs: {
    1: 'laundry day, one sock short',
    2: 'boing, boing, GOING',
    3: 'ears up, net up',
    4: 'detective tiptoes',
    5: 'swoosh — wrong catch',
    6: 'the twin-sock trap',
    7: 'count twice, just in case',
  },
  lines: {
    1: [
      {
        text: (i) =>
          `Laundry day in the ${i.localeBiome}! Wet socks dripped on the line. One sock… two socks… and — wait. Where was sock number three?`,
        brief: (i) =>
          `a clothesline in the ${i.localeBiome}, the hero counting dripping socks, one clothespin empty`,
      },
      {
        text: () =>
          `There! By the big rock! One stripy sock, hopping like a frog. Since when do socks hop?`,
        brief: () => `a stripy sock mid-hop near a big rock, the hero pointing in disbelief`,
      },
    ],
    2: [
      {
        text: () =>
          `Boing! The sock bounced over the basket. Boing-boing! Right past the dog. Where was it GOING?`,
        brief: () =>
          `the sock bouncing over a picnic basket, a surprised dog watching, cartoon motion lines`,
      },
      {
        text: (i) =>
          `${i.kidName} grabbed the butterfly net. And hollered the chasing chant: "Hoppity-bop — where did it stop?"`,
        brief: () =>
          `the hero running with a butterfly net raised, the sock bouncing far ahead down the path`,
      },
    ],
    3: [
      {
        text: (i) =>
          `${i.kidName} skidded to a stop and listened. Ears up. Net up. "Hoppity-bop — where did it stop?"`,
        brief: () => `the hero frozen mid-listen with the net raised high, exaggerated listening pose`,
      },
      {
        text: () =>
          `Chase a sock alone? Or ask for help? The dog wagged. The wind giggled in the grass…`,
        brief: () =>
          `the hero glancing between the wagging dog and a rustling trail in the tall grass`,
      },
    ],
    4: [
      {
        text: () =>
          `Tip-toe, tip-toe through the grass. "Hoppity-bop — where did it stop?"`,
        brief: () =>
          `the hero tiptoeing through tall grass with the net, the dog sneaking close behind`,
      },
      {
        text: () =>
          `A clue! One muddy sock-print on a stone. Then two prints. Then ten! Which way now?`,
        brief: () =>
          `a trail of tiny muddy sock-prints across flat stones, the hero crouched like a detective`,
      },
      {
        text: (i) =>
          `The prints led to the hollow log. Something inside went fluff-fluff-shuffle. ${i.kidName} leaned closer… closer…`,
        brief: () =>
          `a dark hollow log with faint shuffling inside, the hero and dog leaning in close`,
      },
    ],
    5: [
      {
        text: (i) =>
          `${i.kidName} raised the net and whisper-sang: "Hoppity-bop — where did it stop?"`,
        brief: () => `the hero with the net raised over the log opening, the dog ready to pounce`,
      },
      {
        text: () =>
          `Swoosh! The net came down — on a toad. And the sock? Boing — gone again…`,
        brief: () => `the net over one unimpressed toad, the sock sailing right over the hero's head`,
      },
      {
        text: (i) =>
          `${i.kidName} flopped in the grass. Puff, puff. Give up? No way. Socks come in PAIRS…`,
        brief: () =>
          `the hero lying in the grass catching breath, holding up the matching sock with a sly look`,
      },
    ],
    6: [
      {
        text: (i) =>
          `${i.kidName} had a plan. The twin sock went on a sunny stone. The runaway hopped near… nearer… HOP! "Hoppity-bop — THERE it stopped!"`,
        brief: () =>
          `the runaway sock hopping toward its twin on a sunny stone, the hero hiding behind the rock`,
      },
      {
        text: (i) =>
          `The two socks snuggled like best friends. ${i.kidName} scooped them up, quick as a wink. Gotcha! But would they STAY caught?`,
        brief: () => `the hero scooping up both socks, the toad watching, triumphant grin`,
      },
      {
        text: (i) =>
          `Home they marched — stomp, stomp. ${i.kidName}, the dog, two tired socks. The toad waved one damp toe. Probably. Maybe?`,
        brief: () =>
          `a tiny parade home, the hero then the dog then the socks, the toad possibly waving`,
      },
    ],
    7: [
      {
        text: () =>
          `Back on the line, the socks swung. Side by side. Drip, drip, flap. The dog snored in the sun.`,
        brief: () =>
          `two socks pinned together on the line dripping, the dog asleep in a sun patch below`,
      },
      {
        text: (i) =>
          `"No more hopping," ${i.kidName} told them. The socks just dripped. But one of them — maybe — wiggled.`,
        brief: () => `the hero wagging a finger at the socks, one sock caught mid-wiggle`,
      },
      {
        text: (i) =>
          `And that is why ${i.kidName} counts socks. Always twice. Sometimes three times.`,
        brief: () =>
          `cozy final scene, the hero counting socks with exaggerated care, a wink to the reader`,
      },
    ],
  },
};

const STORIES: Record<TemplateFamily, TemplateStory> = {
  'gentle-glow': GENTLE_GLOW,
  'brave-step': BRAVE_STEP,
  'giggle-quest': GIGGLE_QUEST,
};

// ─── Synthesizer ─────────────────────────────────────────────────────────────

/**
 * Build a complete SceneTree from the hand-written template story matching
 * the input theme.
 *
 * Postconditions:
 *   - tree.beats.length === 7
 *   - sum(beat.scene.spreads) === input.targetSpreads
 *   - every beat has ≥ 1 scene; every scene has ≥ 1 spread
 *   - spread.spreadIndex is contiguous 0..targetSpreads-1
 *   - every spread carries an illustration_brief (says "the hero", never kidName)
 *   - tree.tier2_words === supplied tier2Words
 *   - tree.title + tree.back_cover_blurb are non-empty strings
 *
 * Note on Tier-2 vocab: the fallback prioritizes craft (refrain, hooks,
 * rhythm) over forced vocab insertion — bolting arbitrary-POS words into
 * hand-tuned lines reads worse than omitting them. tier2_words is still
 * echoed on the tree for the vocab inspector.
 */
export function synthesizeTemplateTree(
  input: StoryInput,
  tier2Words: string[],
  budget: BeatBudgetMap,
): SceneTree {
  const story = STORIES[templateFamilyForTheme(input.theme)];
  const beats: Beat[] = [];
  let nextSpreadIndex = 0;

  for (let i = 1; i <= 7; i++) {
    const id = i as BeatId;
    const target = Math.max(1, budget[id]); // min-1 invariant
    const scenes = buildScenes(id, story, input, target, nextSpreadIndex);
    nextSpreadIndex += target;
    beats.push({
      id,
      beat_name: BEAT_NAMES[id],
      emotional_arc: story.arcs[id],
      scenes,
    });
  }

  return {
    title: story.title(input),
    back_cover_blurb: story.blurb(input),
    page_budget: input.targetSpreads,
    beats,
    tier2_words: [...tier2Words],
  };
}

function buildScenes(
  beatId: BeatId,
  story: TemplateStory,
  input: StoryInput,
  totalSpreads: number,
  startingIndex: number,
): Scene[] {
  // If beat has ≤3 spreads we use ONE scene of that spread count.
  // If more, split into scenes of ≤3 spreads each (max 5 per spec).
  const scenes: Scene[] = [];
  const lines = story.lines[beatId];
  let lineCursor = 0;
  let spreadCursor = startingIndex;
  let remaining = totalSpreads;
  let sceneIdx = 1;

  while (remaining > 0) {
    const sceneSize = Math.min(5, Math.min(3, remaining));
    const spreads: Spread[] = [];
    let firstBrief = '';
    for (let s = 0; s < sceneSize; s++) {
      const line = lines[lineCursor % lines.length];
      lineCursor++;
      const brief = line.brief(input);
      if (!firstBrief) firstBrief = brief;
      spreads.push({
        spreadIndex: spreadCursor++,
        spread_text: line.text(input),
        text_focus: alternateFocus(spreadCursor),
        illustration_brief: brief,
      });
    }
    scenes.push({
      sceneId: `${BEAT_NAMES[beatId]}-${sceneIdx++}`,
      spreadCount: sceneSize as Scene['spreadCount'],
      sceneBrief: firstBrief,
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
