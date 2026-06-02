// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/tier2-vocab-corpus.ts
//
// Curated Tier-2 vocabulary corpus for children's-book story authoring.
// Per Beck, McKeown & Kucan (2013) Bringing Words to Life: Tier-2 words are
// the high-utility academic/literate words found across subject domains but
// uncommon in everyday spoken vocabulary. These are the words that pay the
// highest cognitive dividends per minute of read-aloud (Nagy 1985).
//
// Each entry carries an `ageBandMin` so the planner can match to the kid's
// age band. The kid-friendly `definition_kid` surfaces in the advanced-mode
// Vocabulary Inspector (goal #7). `themeAffinities` drives the planner's
// theme-relevance score (Phase 2.4 in goal markdown).
//
// Size target: ~500 words. Curated, not exhaustive — quality > raw count.
// Sourced from Beck/McKeown lists + filtered against age-appropriateness
// (no abstract finance/political terms, no jargon, no euphemisms).

import type { Tier2WordEntry, StoryTheme } from './types';

// Helper for terse literals
const w = (
  word: string,
  syllables: number,
  ageBandMin: Tier2WordEntry['ageBandMin'],
  definition_kid: string,
  themeAffinities: StoryTheme[],
): Tier2WordEntry => ({ word, syllables, ageBandMin, definition_kid, themeAffinities });

// ─── BEDTIME / NIGHT cluster ────────────────────────────────────────────────
const BEDTIME: Tier2WordEntry[] = [
  w('drowsy', 2, 'preschool', 'feeling sleepy', ['bedtime']),
  w('slumber', 2, 'preschool', 'deep sleep', ['bedtime']),
  w('snug', 1, 'toddler', 'warm and tightly tucked', ['bedtime']),
  w('hush', 1, 'toddler', 'a soft, quiet sound', ['bedtime', 'kindness']),
  w('twilight', 2, 'preschool', 'the soft time between day and night', ['bedtime', 'adventure']),
  w('moonlit', 2, 'preschool', 'lit by the moon', ['bedtime', 'adventure']),
  w('lullaby', 3, 'toddler', 'a gentle song for sleep', ['bedtime', 'new-baby-arrives']),
  w('cozy', 2, 'toddler', 'warm and comfy', ['bedtime', 'kindness']),
  w('gentle', 2, 'toddler', 'soft and careful', ['bedtime', 'kindness']),
  w('peaceful', 2, 'preschool', 'calm and quiet', ['bedtime', 'kindness']),
  w('doze', 1, 'preschool', 'to fall lightly asleep', ['bedtime']),
  w('yawn', 1, 'toddler', 'opening your mouth when sleepy', ['bedtime']),
  w('snooze', 1, 'preschool', 'a short nap', ['bedtime']),
  w('dim', 1, 'toddler', 'a little bit dark', ['bedtime']),
  w('soft', 1, 'toddler', 'gentle to the touch', ['bedtime', 'kindness']),
  w('drift', 1, 'preschool', 'to float along slowly', ['bedtime', 'curiosity']),
  w('shimmer', 2, 'preschool', 'to shine with tiny flickers', ['bedtime', 'adventure']),
  w('glimmer', 2, 'preschool', 'a small twinkle of light', ['bedtime', 'adventure']),
  w('whisper', 2, 'toddler', 'to talk very softly', ['bedtime', 'kindness', 'friendship']),
  w('blanket', 2, 'toddler', 'a cover that keeps you warm', ['bedtime']),
  w('pillow', 2, 'toddler', 'a soft cushion for your head', ['bedtime']),
  w('nightlight', 2, 'toddler', 'a small lamp that glows in the dark', ['bedtime']),
  w('starry', 2, 'preschool', 'full of stars', ['bedtime', 'adventure']),
  w('dreamy', 2, 'preschool', 'soft and full of dreams', ['bedtime']),
  w('slow', 1, 'toddler', 'not fast', ['bedtime']),
  w('quiet', 2, 'toddler', 'making no noise', ['bedtime', 'kindness']),
  w('still', 1, 'toddler', 'not moving', ['bedtime']),
  w('moonbeam', 2, 'preschool', 'a ray of moonlight', ['bedtime', 'adventure']),
  w('tucked', 1, 'toddler', 'put snugly into place', ['bedtime']),
  w('dusk', 1, 'preschool', 'the last light before night', ['bedtime', 'adventure']),
];

// ─── FIRST-DAY / SCHOOL cluster ─────────────────────────────────────────────
const FIRST_DAY: Tier2WordEntry[] = [
  w('nervous', 2, 'preschool', 'a wiggly worried feeling', ['first-day', 'overcoming-fear']),
  w('brave', 1, 'toddler', 'doing it even when it feels scary', ['first-day', 'overcoming-fear', 'adventure']),
  w('friendly', 2, 'toddler', 'kind to new people', ['first-day', 'friendship', 'kindness']),
  w('classroom', 2, 'preschool', 'the room where you learn', ['first-day']),
  w('teacher', 2, 'toddler', 'the grown-up who helps you learn', ['first-day']),
  w('schedule', 2, 'grade-school', 'the plan for your day', ['first-day']),
  w('bustle', 2, 'preschool', 'lots of busy noise and motion', ['first-day', 'adventure']),
  w('introduce', 3, 'preschool', 'to tell someone your name', ['first-day', 'friendship']),
  w('greet', 1, 'preschool', 'to say hello', ['first-day', 'friendship']),
  w('lonely', 2, 'preschool', 'wishing for company', ['first-day', 'friendship']),
  w('shy', 1, 'toddler', 'quiet around new people', ['first-day', 'overcoming-fear']),
  w('eager', 2, 'preschool', 'really wanting to do something', ['first-day', 'curiosity', 'adventure']),
  w('explore', 3, 'preschool', 'to look around carefully', ['first-day', 'adventure', 'curiosity']),
  w('hallway', 2, 'preschool', 'a long path inside a building', ['first-day']),
  w('locker', 2, 'grade-school', 'a small cabinet for your things', ['first-day']),
  w('lunchbox', 2, 'toddler', 'a box for your lunch', ['first-day']),
  w('backpack', 2, 'toddler', 'a bag you wear on your shoulders', ['first-day', 'adventure']),
  w('practice', 2, 'preschool', 'to do something again to get better', ['first-day']),
  w('lesson', 2, 'preschool', 'something you learn', ['first-day']),
  w('proud', 1, 'toddler', 'feeling good about what you did', ['first-day', 'overcoming-fear']),
  w('butterflies', 4, 'preschool', 'a flutter in your stomach when nervous', ['first-day', 'overcoming-fear']),
  w('whoosh', 1, 'toddler', 'a fast, sweeping sound', ['first-day', 'adventure']),
  w('rumble', 2, 'preschool', 'a low, rolling sound', ['first-day', 'adventure']),
  w('jitter', 2, 'preschool', 'a little shaky feeling', ['first-day', 'overcoming-fear']),
];

// ─── LOST-AND-FOUND cluster ─────────────────────────────────────────────────
const LOST_AND_FOUND: Tier2WordEntry[] = [
  w('search', 1, 'toddler', 'to look everywhere for something', ['lost-and-found', 'adventure']),
  w('seek', 1, 'preschool', 'to try to find', ['lost-and-found', 'adventure']),
  w('wander', 2, 'preschool', 'to walk around without a plan', ['lost-and-found', 'adventure']),
  w('missing', 2, 'toddler', 'not where it should be', ['lost-and-found']),
  w('scoured', 1, 'grade-school', 'looked very carefully', ['lost-and-found', 'adventure']),
  w('retrace', 2, 'preschool', 'to go back the way you came', ['lost-and-found']),
  w('reunite', 3, 'preschool', 'to come back together', ['lost-and-found', 'friendship']),
  w('discover', 3, 'preschool', 'to find something new', ['lost-and-found', 'curiosity', 'adventure']),
  w('hidden', 2, 'toddler', 'not easy to see', ['lost-and-found', 'curiosity']),
  w('clue', 1, 'preschool', 'a hint that helps you find something', ['lost-and-found', 'curiosity']),
  w('trail', 1, 'preschool', 'a path of marks to follow', ['lost-and-found', 'adventure']),
  w('vanish', 2, 'preschool', 'to disappear suddenly', ['lost-and-found', 'curiosity']),
  w('appear', 2, 'preschool', 'to show up', ['lost-and-found', 'curiosity']),
  w('familiar', 4, 'preschool', 'something you know well', ['lost-and-found']),
  w('stranger', 2, 'preschool', 'someone you do not know yet', ['lost-and-found']),
  w('rescue', 2, 'preschool', 'to save someone in trouble', ['lost-and-found', 'kindness', 'adventure']),
  w('lantern', 2, 'preschool', 'a small light you can carry', ['lost-and-found', 'adventure']),
  w('compass', 2, 'preschool', 'a tool that points north', ['lost-and-found', 'adventure']),
  w('footprint', 2, 'toddler', 'the mark a foot leaves', ['lost-and-found', 'adventure']),
  w('shortcut', 2, 'preschool', 'a faster way to get somewhere', ['lost-and-found', 'adventure']),
];

// ─── OVERCOMING-FEAR cluster ────────────────────────────────────────────────
const OVERCOMING_FEAR: Tier2WordEntry[] = [
  w('courage', 2, 'preschool', 'being brave when it is hard', ['overcoming-fear', 'adventure']),
  w('tremble', 2, 'preschool', 'to shake a little from fear or cold', ['overcoming-fear']),
  w('shadow', 2, 'toddler', 'the dark shape behind something in light', ['overcoming-fear', 'adventure']),
  w('ferocious', 4, 'grade-school', 'fierce and a little scary', ['overcoming-fear', 'adventure']),
  w('worried', 2, 'toddler', 'feeling unsure something bad will happen', ['overcoming-fear']),
  w('stomach', 2, 'toddler', 'the middle of your belly', ['overcoming-fear']),
  w('shiver', 2, 'preschool', 'a little shake from cold or fear', ['overcoming-fear', 'adventure']),
  w('squeak', 1, 'toddler', 'a tiny high sound', ['overcoming-fear', 'silly-quest']),
  w('giant', 2, 'toddler', 'very, very big', ['overcoming-fear', 'adventure']),
  w('looming', 2, 'preschool', 'looking large and close', ['overcoming-fear', 'adventure']),
  w('roar', 1, 'toddler', 'a loud animal sound', ['overcoming-fear', 'adventure']),
  w('confront', 2, 'grade-school', 'to face something directly', ['overcoming-fear']),
  w('brave', 1, 'toddler', 'doing the hard thing even when scared', ['overcoming-fear']),
  w('dared', 1, 'preschool', 'tried something risky', ['overcoming-fear', 'adventure']),
  w('peer', 1, 'preschool', 'to look closely', ['overcoming-fear', 'curiosity']),
  w('flinch', 1, 'preschool', 'to jerk back from something surprising', ['overcoming-fear']),
  w('startled', 2, 'preschool', 'suddenly surprised', ['overcoming-fear']),
  w('panic', 2, 'preschool', 'a big rush of scared feelings', ['overcoming-fear']),
  w('calm', 1, 'toddler', 'quiet and steady inside', ['overcoming-fear', 'kindness']),
  w('steady', 2, 'preschool', 'not wobbly, not shaky', ['overcoming-fear']),
  w('breathe', 1, 'toddler', 'to take air in and out', ['overcoming-fear']),
  w('overcome', 3, 'grade-school', 'to beat something hard', ['overcoming-fear', 'adventure']),
];

// ─── NEW-BABY-ARRIVES cluster ───────────────────────────────────────────────
const NEW_BABY: Tier2WordEntry[] = [
  w('cradle', 2, 'toddler', 'a tiny rocking bed', ['new-baby-arrives']),
  w('bundle', 2, 'toddler', 'something wrapped up', ['new-baby-arrives', 'kindness']),
  w('sibling', 2, 'preschool', 'a brother or sister', ['new-baby-arrives', 'sibling-rivalry']),
  w('tiny', 2, 'toddler', 'very small', ['new-baby-arrives']),
  w('coo', 1, 'toddler', 'a soft baby sound', ['new-baby-arrives']),
  w('giggle', 2, 'toddler', 'a little quick laugh', ['new-baby-arrives', 'silly-quest', 'friendship']),
  w('rock', 1, 'toddler', 'to move gently back and forth', ['new-baby-arrives', 'bedtime']),
  w('hush', 1, 'toddler', 'a soft, quiet sound', ['new-baby-arrives', 'bedtime']),
  w('embrace', 2, 'preschool', 'to hold someone close', ['new-baby-arrives', 'kindness', 'friendship']),
  w('newborn', 2, 'preschool', 'a brand-new baby', ['new-baby-arrives']),
  w('careful', 2, 'toddler', 'doing something slowly so nothing breaks', ['new-baby-arrives', 'kindness']),
  w('share', 1, 'toddler', 'to let someone use a thing too', ['new-baby-arrives', 'kindness', 'sibling-rivalry']),
  w('helper', 2, 'toddler', 'someone who helps', ['new-baby-arrives', 'kindness']),
  w('bigger', 2, 'toddler', 'larger than before', ['new-baby-arrives']),
  w('rattle', 2, 'toddler', 'a baby toy that makes a sound', ['new-baby-arrives']),
];

// ─── KINDNESS cluster ───────────────────────────────────────────────────────
const KINDNESS: Tier2WordEntry[] = [
  w('thoughtful', 2, 'preschool', 'thinking about how others feel', ['kindness', 'friendship']),
  w('generous', 3, 'preschool', 'happy to share what you have', ['kindness', 'friendship']),
  w('helpful', 2, 'toddler', 'doing things to help', ['kindness']),
  w('gentle', 2, 'toddler', 'soft and careful', ['kindness']),
  w('patient', 2, 'preschool', 'happy to wait', ['kindness']),
  w('care', 1, 'toddler', 'to be worried about how someone feels', ['kindness', 'friendship']),
  w('comfort', 2, 'preschool', 'to make someone feel better', ['kindness']),
  w('soothe', 1, 'preschool', 'to calm someone down', ['kindness', 'bedtime']),
  w('warmly', 2, 'preschool', 'with kindness and love', ['kindness']),
  w('forgive', 2, 'preschool', 'to let go of being upset with someone', ['kindness', 'friendship', 'sibling-rivalry']),
  w('listen', 2, 'toddler', 'to pay attention with your ears', ['kindness', 'friendship']),
  w('include', 2, 'preschool', 'to invite someone to join in', ['kindness', 'friendship']),
  w('welcome', 2, 'toddler', 'to make someone feel they belong', ['kindness', 'first-day']),
  w('cheer', 1, 'toddler', 'to make someone feel happy', ['kindness']),
  w('thank', 1, 'toddler', 'to say you are grateful', ['kindness']),
  w('grateful', 2, 'preschool', 'thankful', ['kindness']),
  w('respect', 2, 'preschool', 'treating someone the way they want to be treated', ['kindness']),
  w('praise', 1, 'preschool', 'saying nice things about someone', ['kindness']),
];

// ─── ADVENTURE cluster ──────────────────────────────────────────────────────
const ADVENTURE: Tier2WordEntry[] = [
  w('journey', 2, 'preschool', 'a long trip', ['adventure']),
  w('expedition', 4, 'grade-school', 'a planned trip to a special place', ['adventure']),
  w('voyage', 2, 'preschool', 'a long trip on water', ['adventure']),
  w('daring', 2, 'preschool', 'brave and bold', ['adventure', 'overcoming-fear']),
  w('intrepid', 3, 'grade-school', 'very brave', ['adventure', 'overcoming-fear']),
  w('quest', 1, 'preschool', 'a special big search', ['adventure', 'silly-quest']),
  w('gallant', 2, 'grade-school', 'brave and noble', ['adventure', 'kindness']),
  w('explore', 3, 'preschool', 'to look around new places', ['adventure', 'curiosity']),
  w('discover', 3, 'preschool', 'to find something new', ['adventure', 'curiosity']),
  w('summit', 2, 'preschool', 'the very top of a mountain', ['adventure']),
  w('horizon', 3, 'preschool', 'where the sky meets the ground far away', ['adventure']),
  w('uncharted', 3, 'grade-school', 'not on any map', ['adventure', 'curiosity']),
  w('treasure', 2, 'preschool', 'something special you really want to find', ['adventure', 'lost-and-found']),
  w('map', 1, 'toddler', 'a picture that shows the way', ['adventure']),
  w('compass', 2, 'preschool', 'a tool that points north', ['adventure', 'lost-and-found']),
  w('wilderness', 3, 'grade-school', 'wild land far from buildings', ['adventure']),
  w('valley', 2, 'preschool', 'a low place between hills', ['adventure']),
  w('canyon', 2, 'preschool', 'a deep narrow gap with steep sides', ['adventure']),
  w('cavern', 2, 'preschool', 'a big cave', ['adventure', 'curiosity']),
  w('boulder', 2, 'preschool', 'a big rock', ['adventure']),
  w('thicket', 2, 'preschool', 'a tangled patch of bushes', ['adventure']),
  w('clearing', 2, 'preschool', 'an open space in a forest', ['adventure', 'lost-and-found']),
  w('voyager', 3, 'preschool', 'someone on a long trip', ['adventure']),
  w('captain', 2, 'preschool', 'the leader of a boat or ship', ['adventure']),
  w('rope', 1, 'toddler', 'a strong braided string', ['adventure']),
  w('torch', 1, 'preschool', 'a flame you hold to see in the dark', ['adventure']),
  w('peer', 1, 'preschool', 'to look closely', ['adventure', 'curiosity', 'overcoming-fear']),
  w('scout', 1, 'preschool', 'someone who looks ahead to check', ['adventure']),
];

// ─── CURIOSITY cluster ──────────────────────────────────────────────────────
const CURIOSITY: Tier2WordEntry[] = [
  w('wonder', 2, 'toddler', 'to think with big eyes about something', ['curiosity']),
  w('ponder', 2, 'preschool', 'to think carefully', ['curiosity']),
  w('investigate', 4, 'grade-school', 'to look into something to learn more', ['curiosity', 'adventure']),
  w('peek', 1, 'toddler', 'a quick little look', ['curiosity', 'lost-and-found']),
  w('examine', 3, 'preschool', 'to look very closely', ['curiosity']),
  w('mystery', 3, 'preschool', 'a puzzle you want to solve', ['curiosity', 'adventure']),
  w('puzzle', 2, 'preschool', 'a thing that is hard to figure out', ['curiosity']),
  w('observe', 2, 'preschool', 'to watch carefully', ['curiosity']),
  w('inspect', 2, 'preschool', 'to look at something checking for details', ['curiosity']),
  w('discover', 3, 'preschool', 'to find something new', ['curiosity', 'adventure']),
  w('marvel', 2, 'preschool', 'to look at something amazing', ['curiosity']),
  w('amazed', 2, 'preschool', 'really surprised in a good way', ['curiosity']),
  w('astonish', 3, 'preschool', 'to surprise in a very big way', ['curiosity']),
  w('imagine', 3, 'preschool', 'to picture something in your head', ['curiosity', 'silly-quest']),
  w('question', 2, 'toddler', 'something you ask to find out more', ['curiosity']),
  w('curious', 3, 'preschool', 'wanting to know more', ['curiosity']),
  w('peculiar', 4, 'grade-school', 'a little strange and interesting', ['curiosity', 'silly-quest']),
  w('strange', 1, 'toddler', 'not like usual', ['curiosity', 'silly-quest']),
  w('odd', 1, 'preschool', 'not what you expected', ['curiosity', 'silly-quest']),
  w('unusual', 4, 'preschool', 'not the normal kind', ['curiosity']),
  w('clue', 1, 'preschool', 'a hint that helps you figure out', ['curiosity', 'lost-and-found']),
  w('study', 2, 'toddler', 'to look at carefully', ['curiosity']),
];

// ─── FRIENDSHIP cluster ─────────────────────────────────────────────────────
const FRIENDSHIP: Tier2WordEntry[] = [
  w('companion', 4, 'grade-school', 'a friend who is with you', ['friendship']),
  w('ally', 2, 'preschool', 'a friend on your side', ['friendship']),
  w('bond', 1, 'preschool', 'a strong feeling between two friends', ['friendship']),
  w('trust', 1, 'toddler', 'to believe in your friend', ['friendship', 'kindness']),
  w('loyal', 2, 'preschool', 'always sticking with your friends', ['friendship']),
  w('team', 1, 'toddler', 'a group working together', ['friendship', 'adventure']),
  w('partner', 2, 'preschool', 'someone working with you', ['friendship']),
  w('share', 1, 'toddler', 'to let someone use a thing too', ['friendship', 'kindness']),
  w('include', 2, 'preschool', 'to invite someone to play too', ['friendship', 'kindness']),
  w('promise', 2, 'preschool', 'a strong word you really mean', ['friendship']),
  w('apologize', 4, 'preschool', 'to say sorry', ['friendship', 'sibling-rivalry']),
  w('forgive', 2, 'preschool', 'to let go of being upset with someone', ['friendship', 'kindness']),
  w('hug', 1, 'toddler', 'to wrap arms around someone with love', ['friendship', 'kindness']),
  w('cheer', 1, 'toddler', 'to make someone feel happy', ['friendship', 'kindness']),
  w('laugh', 1, 'toddler', 'a happy noise you make', ['friendship', 'silly-quest']),
  w('giggle', 2, 'toddler', 'a little quick laugh', ['friendship', 'silly-quest']),
  w('chum', 1, 'preschool', 'a close friend', ['friendship']),
  w('buddy', 2, 'toddler', 'a friend', ['friendship']),
  w('greet', 1, 'preschool', 'to say hello', ['friendship']),
];

// ─── SIBLING-RIVALRY cluster ────────────────────────────────────────────────
const SIBLING: Tier2WordEntry[] = [
  w('squabble', 2, 'preschool', 'a small noisy fight', ['sibling-rivalry']),
  w('bicker', 2, 'preschool', 'to argue about little things', ['sibling-rivalry']),
  w('rival', 2, 'preschool', 'someone you are trying to beat', ['sibling-rivalry']),
  w('jealous', 2, 'preschool', 'wanting what someone else has', ['sibling-rivalry']),
  w('fair', 1, 'toddler', 'the same for everyone', ['sibling-rivalry', 'kindness']),
  w('share', 1, 'toddler', 'to let someone use a thing too', ['sibling-rivalry', 'kindness']),
  w('turn', 1, 'toddler', 'when it is your time', ['sibling-rivalry']),
  w('argument', 3, 'preschool', 'a noisy disagreement', ['sibling-rivalry']),
  w('disagree', 3, 'preschool', 'to think the opposite of someone', ['sibling-rivalry']),
  w('mine', 1, 'toddler', 'belongs to me', ['sibling-rivalry']),
  w('grump', 1, 'toddler', 'feeling cranky', ['sibling-rivalry']),
  w('huff', 1, 'preschool', 'a noisy upset breath', ['sibling-rivalry']),
  w('stomp', 1, 'toddler', 'to walk down hard with anger', ['sibling-rivalry']),
  w('fume', 1, 'preschool', 'to be very upset inside', ['sibling-rivalry']),
  w('pout', 1, 'toddler', 'to make an upset face', ['sibling-rivalry']),
  w('compromise', 3, 'grade-school', 'to meet in the middle', ['sibling-rivalry', 'kindness']),
  w('teamwork', 2, 'preschool', 'when people work together', ['sibling-rivalry', 'friendship']),
  w('peace', 1, 'toddler', 'calm and quiet between people', ['sibling-rivalry', 'kindness']),
];

// ─── SAYING-GOODBYE cluster ─────────────────────────────────────────────────
const GOODBYE: Tier2WordEntry[] = [
  w('farewell', 2, 'preschool', 'a kind goodbye', ['saying-goodbye']),
  w('memory', 3, 'preschool', 'something you remember', ['saying-goodbye']),
  w('cherish', 2, 'preschool', 'to love and hold dear', ['saying-goodbye', 'kindness']),
  w('treasure', 2, 'preschool', 'something you love very much', ['saying-goodbye', 'kindness']),
  w('parting', 2, 'preschool', 'going apart from someone', ['saying-goodbye']),
  w('tear', 1, 'toddler', 'a drop of water from your eye', ['saying-goodbye']),
  w('miss', 1, 'toddler', 'to wish someone was with you', ['saying-goodbye', 'lost-and-found']),
  w('remember', 3, 'toddler', 'to keep something in your head', ['saying-goodbye']),
  w('forever', 3, 'preschool', 'for all time', ['saying-goodbye', 'kindness']),
  w('always', 2, 'toddler', 'every time, every day', ['saying-goodbye', 'kindness']),
  w('keepsake', 2, 'preschool', 'a small thing kept to remember', ['saying-goodbye']),
  w('photograph', 3, 'preschool', 'a picture you take', ['saying-goodbye']),
  w('wave', 1, 'toddler', 'to move your hand to say hi or bye', ['saying-goodbye']),
  w('hug', 1, 'toddler', 'a wrap-around-with-arms with love', ['saying-goodbye', 'kindness']),
  w('promise', 2, 'preschool', 'a strong word you really mean', ['saying-goodbye', 'friendship']),
];

// ─── SILLY-QUEST cluster ────────────────────────────────────────────────────
const SILLY: Tier2WordEntry[] = [
  w('silly', 2, 'toddler', 'a little goofy', ['silly-quest']),
  w('peculiar', 4, 'grade-school', 'a little strange and interesting', ['silly-quest', 'curiosity']),
  w('absurd', 2, 'grade-school', 'very silly in a funny way', ['silly-quest']),
  w('wacky', 2, 'preschool', 'silly and wild', ['silly-quest']),
  w('giggle', 2, 'toddler', 'a little quick laugh', ['silly-quest']),
  w('hilarious', 4, 'preschool', 'very, very funny', ['silly-quest']),
  w('goof', 1, 'toddler', 'a silly mistake or person', ['silly-quest']),
  w('tickle', 2, 'toddler', 'a feathery feeling that makes you laugh', ['silly-quest']),
  w('snicker', 2, 'preschool', 'a sneaky little laugh', ['silly-quest']),
  w('chuckle', 2, 'preschool', 'a small soft laugh', ['silly-quest']),
  w('zany', 2, 'preschool', 'wild and goofy', ['silly-quest']),
  w('topsy', 2, 'preschool', 'turned over in a silly way', ['silly-quest']),
  w('boggle', 2, 'preschool', 'when your brain feels mixed up', ['silly-quest', 'curiosity']),
  w('boing', 1, 'toddler', 'a bouncy sound', ['silly-quest']),
  w('zoom', 1, 'toddler', 'to go very fast', ['silly-quest', 'adventure']),
  w('whirl', 1, 'preschool', 'to spin around', ['silly-quest']),
  w('twirl', 1, 'toddler', 'to spin in a circle', ['silly-quest']),
  w('flop', 1, 'toddler', 'to fall down softly', ['silly-quest']),
  w('plop', 1, 'toddler', 'a small soft thud', ['silly-quest']),
  w('zigzag', 2, 'toddler', 'a path that bends side to side', ['silly-quest', 'adventure']),
];

// ─── EMOTION + DESCRIPTORS cross-theme cluster ──────────────────────────────
const EMOTION: Tier2WordEntry[] = [
  w('cheerful', 2, 'toddler', 'happy and full of smiles', ['kindness', 'friendship']),
  w('glum', 1, 'preschool', 'feeling down and sad', ['saying-goodbye', 'lost-and-found']),
  w('grouchy', 2, 'toddler', 'cranky and upset', ['sibling-rivalry']),
  w('delighted', 3, 'preschool', 'very, very happy', ['kindness', 'friendship']),
  w('overjoyed', 3, 'preschool', 'so happy you can hardly hold it', ['kindness', 'friendship']),
  w('puzzled', 2, 'preschool', 'a little confused', ['curiosity', 'lost-and-found']),
  w('astonished', 4, 'preschool', 'very surprised', ['curiosity']),
  w('thrilled', 1, 'preschool', 'really excited', ['adventure', 'first-day']),
  w('excited', 3, 'toddler', 'full of happy energy', ['first-day', 'adventure']),
  w('proud', 1, 'toddler', 'feeling good about what you did', ['kindness', 'overcoming-fear']),
  w('content', 2, 'preschool', 'happy and at peace', ['kindness', 'bedtime']),
  w('fond', 1, 'preschool', 'liking very much', ['friendship', 'kindness']),
  w('weary', 2, 'preschool', 'very tired', ['bedtime']),
  w('hungry', 2, 'toddler', 'wanting food', ['adventure']),
  w('thirsty', 2, 'toddler', 'wanting a drink', ['adventure']),
  w('clever', 2, 'preschool', 'smart in a quick way', ['curiosity', 'adventure']),
  w('wise', 1, 'preschool', 'knowing the right thing to do', ['kindness']),
  w('humble', 2, 'preschool', 'not bragging', ['kindness', 'friendship']),
  w('honest', 2, 'preschool', 'telling the truth', ['kindness', 'friendship']),
  w('truthful', 2, 'preschool', 'telling what is real', ['kindness', 'friendship']),
];

// ─── ACTION / VERBS cross-theme cluster ─────────────────────────────────────
const ACTIONS: Tier2WordEntry[] = [
  w('gather', 2, 'toddler', 'to bring things together', ['adventure', 'kindness']),
  w('scatter', 2, 'preschool', 'to spread out everywhere', ['silly-quest', 'lost-and-found']),
  w('tumble', 2, 'toddler', 'to fall in a rolling way', ['silly-quest']),
  w('scramble', 2, 'preschool', 'to climb up fast', ['adventure']),
  w('clamber', 2, 'preschool', 'to climb with hands and feet', ['adventure']),
  w('scurry', 2, 'preschool', 'to hurry on quick little steps', ['lost-and-found', 'silly-quest']),
  w('scamper', 2, 'preschool', 'to run quickly in short steps', ['silly-quest', 'adventure']),
  w('dash', 1, 'toddler', 'to run fast', ['adventure']),
  w('hop', 1, 'toddler', 'a small jump', ['silly-quest']),
  w('skip', 1, 'toddler', 'a happy step-jump', ['silly-quest', 'friendship']),
  w('stride', 1, 'preschool', 'a long sure step', ['adventure']),
  w('tiptoe', 2, 'toddler', 'to walk quietly on the toes', ['curiosity', 'bedtime']),
  w('crouch', 1, 'preschool', 'to bend low', ['adventure', 'curiosity']),
  w('lean', 1, 'toddler', 'to tilt to one side', ['curiosity']),
  w('reach', 1, 'toddler', 'to stretch your hand out', ['adventure', 'kindness']),
  w('clutch', 1, 'preschool', 'to hold very tightly', ['overcoming-fear', 'adventure']),
  w('grasp', 1, 'preschool', 'to hold on firmly', ['adventure']),
  w('clasp', 1, 'preschool', 'to hold tightly together', ['friendship', 'kindness']),
  w('soar', 1, 'preschool', 'to fly high and free', ['adventure']),
  w('plunge', 1, 'grade-school', 'to dive down fast', ['adventure', 'overcoming-fear']),
  w('drift', 1, 'preschool', 'to float along slowly', ['curiosity', 'bedtime']),
  w('twinkle', 2, 'toddler', 'to sparkle with tiny light', ['bedtime', 'curiosity']),
  w('flicker', 2, 'preschool', 'to shine on and off quickly', ['bedtime', 'overcoming-fear']),
  w('glow', 1, 'toddler', 'to give off soft light', ['bedtime', 'curiosity']),
  w('blossom', 2, 'preschool', 'to open up like a flower', ['kindness', 'friendship']),
  w('flourish', 2, 'grade-school', 'to grow strong and well', ['kindness', 'adventure']),
  w('spring', 1, 'toddler', 'to jump suddenly', ['silly-quest', 'adventure']),
  w('leap', 1, 'toddler', 'to jump far', ['adventure', 'silly-quest']),
  w('vanish', 2, 'preschool', 'to disappear', ['curiosity', 'lost-and-found']),
  w('appear', 2, 'preschool', 'to show up', ['curiosity', 'lost-and-found']),
];

// ─── NATURE / WORLD cross-theme cluster ─────────────────────────────────────
const NATURE: Tier2WordEntry[] = [
  w('meadow', 2, 'preschool', 'a grassy open field', ['adventure', 'kindness']),
  w('grove', 1, 'preschool', 'a small patch of trees', ['adventure']),
  w('brook', 1, 'preschool', 'a tiny stream of water', ['adventure', 'bedtime']),
  w('stream', 1, 'toddler', 'a small flowing river', ['adventure']),
  w('river', 2, 'toddler', 'a long flowing water', ['adventure']),
  w('pebble', 2, 'toddler', 'a small smooth stone', ['adventure', 'curiosity']),
  w('boulder', 2, 'preschool', 'a big rock', ['adventure']),
  w('thicket', 2, 'preschool', 'a tangled patch of bushes', ['adventure', 'curiosity']),
  w('breeze', 1, 'toddler', 'a soft gentle wind', ['bedtime', 'kindness']),
  w('gust', 1, 'preschool', 'a quick burst of wind', ['adventure']),
  w('drizzle', 2, 'preschool', 'a light rain', ['adventure']),
  w('downpour', 2, 'preschool', 'a heavy rain', ['adventure', 'overcoming-fear']),
  w('puddle', 2, 'toddler', 'a small pool of water', ['silly-quest']),
  w('blizzard', 2, 'preschool', 'a snow storm', ['adventure', 'overcoming-fear']),
  w('mist', 1, 'preschool', 'a thin cloud near the ground', ['curiosity', 'adventure']),
  w('fog', 1, 'toddler', 'thick mist that hides things', ['curiosity', 'overcoming-fear', 'lost-and-found']),
  w('dew', 1, 'preschool', 'tiny water drops on grass in the morning', ['bedtime', 'kindness']),
  w('blossom', 2, 'preschool', 'a flower that has opened', ['kindness', 'friendship']),
  w('petal', 2, 'preschool', 'one part of a flower', ['kindness']),
  w('branch', 1, 'toddler', 'an arm of a tree', ['adventure']),
  w('canopy', 3, 'grade-school', 'the top cover of a forest', ['adventure']),
  w('horizon', 3, 'preschool', 'where the sky meets the ground far away', ['adventure']),
  w('crescent', 2, 'preschool', 'a curved moon shape', ['bedtime']),
  w('flutter', 2, 'preschool', 'to move with quick small wings', ['kindness', 'silly-quest']),
  w('rustle', 2, 'preschool', 'a soft crackly sound of leaves', ['bedtime', 'curiosity']),
  w('chirp', 1, 'toddler', 'a tiny bird sound', ['kindness']),
  w('hum', 1, 'toddler', 'a steady soft sound', ['bedtime']),
  w('crackle', 2, 'preschool', 'a small popping sound', ['bedtime', 'overcoming-fear']),
];

// ─── CHARACTERS / ROLES cluster ─────────────────────────────────────────────
const CHARACTERS: Tier2WordEntry[] = [
  w('hero', 2, 'toddler', 'the brave main person of a story', ['adventure', 'overcoming-fear']),
  w('heroine', 3, 'preschool', 'a girl or woman hero', ['adventure', 'overcoming-fear']),
  w('villain', 2, 'preschool', 'the bad-acting person in a story', ['adventure', 'overcoming-fear']),
  w('explorer', 4, 'preschool', 'someone who looks at new places', ['adventure', 'curiosity']),
  w('guide', 1, 'preschool', 'someone who shows the way', ['adventure', 'kindness']),
  w('wizard', 2, 'preschool', 'a magic person', ['adventure', 'silly-quest']),
  w('witch', 1, 'preschool', 'a magic woman', ['adventure', 'silly-quest']),
  w('giant', 2, 'toddler', 'a very, very big person', ['adventure', 'overcoming-fear']),
  w('dragon', 2, 'toddler', 'a story creature that breathes fire', ['adventure', 'overcoming-fear']),
  w('knight', 1, 'preschool', 'a soldier in shining armor', ['adventure']),
  w('royal', 2, 'preschool', 'belonging to a king or queen', ['adventure']),
  w('crew', 1, 'preschool', 'a team of helpers on a ship or plane', ['adventure', 'friendship']),
  w('captain', 2, 'preschool', 'the leader of a boat or team', ['adventure']),
  w('inventor', 3, 'preschool', 'someone who makes new things', ['curiosity', 'silly-quest']),
  w('detective', 3, 'preschool', 'someone who solves mysteries', ['curiosity', 'lost-and-found']),
  w('scholar', 2, 'grade-school', 'someone who studies a lot', ['curiosity']),
  w('friend', 1, 'toddler', 'someone you like to be with', ['friendship', 'kindness']),
  w('stranger', 2, 'preschool', 'someone you do not know yet', ['first-day', 'lost-and-found']),
  w('neighbor', 2, 'preschool', 'someone who lives near you', ['kindness', 'friendship']),
];

// ─── DESCRIPTORS / SENSE cluster ────────────────────────────────────────────
const DESCRIPTORS: Tier2WordEntry[] = [
  w('gigantic', 3, 'preschool', 'very, very big', ['adventure', 'overcoming-fear', 'silly-quest']),
  w('enormous', 3, 'preschool', 'very, very big', ['adventure', 'silly-quest']),
  w('tiny', 2, 'toddler', 'very small', ['new-baby-arrives', 'silly-quest']),
  w('miniature', 4, 'grade-school', 'tiny size of a normal thing', ['silly-quest', 'curiosity']),
  w('huge', 1, 'toddler', 'very big', ['adventure']),
  w('immense', 2, 'grade-school', 'extremely big', ['adventure']),
  w('vast', 1, 'preschool', 'very wide and open', ['adventure']),
  w('teeny', 2, 'toddler', 'super small', ['silly-quest', 'new-baby-arrives']),
  w('crisp', 1, 'preschool', 'fresh and a little crunchy', ['adventure']),
  w('frosty', 2, 'preschool', 'a little icy', ['adventure', 'bedtime']),
  w('toasty', 2, 'toddler', 'warm and cozy', ['bedtime']),
  w('chilly', 2, 'toddler', 'a little cold', ['bedtime']),
  w('damp', 1, 'preschool', 'a little wet', ['adventure']),
  w('soggy', 2, 'toddler', 'wet and squishy', ['silly-quest', 'adventure']),
  w('sticky', 2, 'toddler', 'staying on your fingers', ['silly-quest']),
  w('sturdy', 2, 'preschool', 'strong and solid', ['adventure']),
  w('fragile', 3, 'preschool', 'easy to break', ['new-baby-arrives', 'kindness']),
  w('delicate', 3, 'preschool', 'soft and breakable', ['new-baby-arrives', 'kindness']),
  w('graceful', 2, 'preschool', 'moving with smooth pretty motion', ['kindness']),
  w('elegant', 3, 'grade-school', 'beautifully simple', ['kindness']),
  w('plain', 1, 'preschool', 'simple, not fancy', ['kindness']),
  w('peculiar', 4, 'grade-school', 'a little strange and interesting', ['curiosity', 'silly-quest']),
  w('ordinary', 4, 'preschool', 'not special, just normal', ['silly-quest']),
  w('marvelous', 3, 'preschool', 'really wonderful', ['adventure', 'friendship']),
  w('splendid', 2, 'preschool', 'really nice and great', ['adventure', 'friendship']),
  w('wonderful', 3, 'toddler', 'really, really nice', ['friendship', 'kindness']),
];

// ─── TIME + PLACE cross-theme ───────────────────────────────────────────────
const TIME_PLACE: Tier2WordEntry[] = [
  w('dawn', 1, 'preschool', 'the first light of morning', ['adventure', 'bedtime']),
  w('twilight', 2, 'preschool', 'the soft time between day and night', ['bedtime']),
  w('midnight', 2, 'preschool', 'the middle of the night', ['bedtime', 'overcoming-fear']),
  w('noon', 1, 'toddler', 'the middle of the day', ['adventure']),
  w('moment', 2, 'toddler', 'a tiny bit of time', ['kindness']),
  w('forever', 3, 'preschool', 'for all time', ['saying-goodbye', 'kindness']),
  w('beyond', 2, 'preschool', 'past where you can see', ['adventure', 'curiosity']),
  w('above', 2, 'toddler', 'higher than', ['adventure']),
  w('below', 2, 'toddler', 'lower than', ['adventure']),
  w('beneath', 2, 'preschool', 'underneath', ['curiosity', 'adventure']),
  w('beside', 2, 'toddler', 'right next to', ['friendship']),
  w('between', 2, 'toddler', 'in the middle of two things', ['curiosity']),
  w('through', 1, 'toddler', 'from one side to the other', ['adventure']),
  w('toward', 2, 'preschool', 'in the direction of', ['adventure']),
  w('homeward', 2, 'preschool', 'on the way home', ['adventure', 'lost-and-found']),
  w('village', 2, 'preschool', 'a tiny town', ['adventure']),
  w('cottage', 2, 'preschool', 'a small cozy house', ['bedtime', 'kindness']),
  w('castle', 2, 'preschool', 'a big stone home for royal people', ['adventure']),
  w('cave', 1, 'toddler', 'a hole in a hill', ['adventure', 'curiosity']),
  w('shore', 1, 'preschool', 'where land meets water', ['adventure']),
  w('island', 2, 'preschool', 'land all around with water', ['adventure']),
  w('attic', 2, 'preschool', 'a room at the top of a house', ['curiosity']),
  w('garden', 2, 'toddler', 'a place where plants grow', ['kindness']),
];

// ─── SOUND / SENSE cluster ──────────────────────────────────────────────────
const SOUND: Tier2WordEntry[] = [
  w('whoosh', 1, 'toddler', 'a fast wind sound', ['adventure', 'silly-quest']),
  w('rustle', 2, 'preschool', 'a soft crackly sound of leaves', ['curiosity']),
  w('rumble', 2, 'preschool', 'a low rolling sound', ['overcoming-fear', 'adventure']),
  w('boom', 1, 'toddler', 'a big loud sound', ['adventure', 'overcoming-fear']),
  w('crash', 1, 'toddler', 'a huge breaking sound', ['adventure', 'silly-quest']),
  w('clatter', 2, 'preschool', 'a noisy clinking sound', ['silly-quest']),
  w('chime', 1, 'preschool', 'a bell-like ringing sound', ['kindness', 'bedtime']),
  w('jingle', 2, 'toddler', 'a happy little ringing sound', ['silly-quest']),
  w('thud', 1, 'toddler', 'a heavy soft hit sound', ['adventure', 'overcoming-fear']),
  w('thump', 1, 'toddler', 'a strong heart-like beat sound', ['overcoming-fear']),
  w('squeal', 1, 'toddler', 'a high happy sound', ['silly-quest', 'friendship']),
  w('shriek', 1, 'preschool', 'a sharp loud cry', ['overcoming-fear']),
  w('murmur', 2, 'preschool', 'a soft mumble sound', ['bedtime', 'curiosity']),
  w('chatter', 2, 'preschool', 'lots of quick talking', ['friendship', 'first-day']),
  w('echo', 2, 'preschool', 'a sound that comes back', ['adventure', 'curiosity']),
  w('silent', 2, 'preschool', 'with no sound at all', ['bedtime', 'curiosity']),
  w('hiss', 1, 'toddler', 'a snake-like sss sound', ['overcoming-fear']),
];

// ─── FEELINGS / ABSTRACT cluster ────────────────────────────────────────────
const FEELINGS: Tier2WordEntry[] = [
  w('relief', 2, 'preschool', 'the good feeling when worry stops', ['overcoming-fear', 'lost-and-found']),
  w('joy', 1, 'toddler', 'big happy feeling', ['kindness', 'friendship']),
  w('hope', 1, 'toddler', 'wishing for something good', ['kindness']),
  w('faith', 1, 'preschool', 'believing in someone or something', ['kindness', 'friendship']),
  w('love', 1, 'toddler', 'the warmest feeling for someone', ['kindness', 'friendship']),
  w('comfort', 2, 'preschool', 'a soft feeling of safety', ['kindness', 'bedtime']),
  w('pride', 1, 'preschool', 'feeling good about what you did', ['overcoming-fear']),
  w('gratitude', 3, 'grade-school', 'feeling thankful', ['kindness']),
  w('wonder', 2, 'toddler', 'a big-eyed amazed feeling', ['curiosity']),
  w('curiosity', 5, 'preschool', 'wanting to know more', ['curiosity']),
  w('respect', 2, 'preschool', 'treating someone the way they want to be treated', ['kindness']),
  w('empathy', 3, 'grade-school', 'feeling what someone else feels', ['kindness']),
  w('mercy', 2, 'preschool', 'being kind even when you do not have to', ['kindness']),
  w('honor', 2, 'preschool', 'doing what is right', ['kindness']),
  w('truth', 1, 'preschool', 'what is real', ['kindness']),
];

// ─── COLOR + LIGHT cluster (kid-friendly poetic) ────────────────────────────
const COLOR_LIGHT: Tier2WordEntry[] = [
  w('crimson', 2, 'grade-school', 'a deep rich red', ['adventure']),
  w('scarlet', 2, 'grade-school', 'a bright clear red', ['adventure']),
  w('amber', 2, 'preschool', 'a warm orange-yellow', ['bedtime']),
  w('emerald', 3, 'preschool', 'a bright green like grass', ['adventure']),
  w('sapphire', 2, 'grade-school', 'a deep blue', ['adventure']),
  w('violet', 3, 'preschool', 'a soft purple', ['kindness']),
  w('golden', 2, 'toddler', 'shining like gold', ['adventure', 'kindness']),
  w('silver', 2, 'toddler', 'shining like a coin', ['bedtime']),
  w('bronze', 1, 'preschool', 'a brownish gold', ['adventure']),
  w('pearly', 2, 'preschool', 'shiny white like a pearl', ['bedtime']),
  w('rosy', 2, 'preschool', 'a pretty pink', ['kindness']),
  w('inky', 2, 'preschool', 'dark like black ink', ['bedtime', 'overcoming-fear']),
  w('hazy', 2, 'preschool', 'a little blurry and soft', ['bedtime', 'curiosity']),
  w('bright', 1, 'toddler', 'full of light', ['adventure']),
  w('dim', 1, 'toddler', 'a little dark', ['bedtime']),
  w('radiant', 3, 'grade-school', 'shining with light', ['kindness', 'friendship']),
];

// ─── FOOD + DOMESTIC cluster ────────────────────────────────────────────────
const FOOD_HOME: Tier2WordEntry[] = [
  w('feast', 1, 'preschool', 'a big happy meal', ['kindness', 'friendship']),
  w('crumb', 1, 'toddler', 'a tiny piece of bread', ['silly-quest']),
  w('sip', 1, 'toddler', 'a small drink', ['kindness']),
  w('munch', 1, 'toddler', 'to chew with a soft sound', ['silly-quest']),
  w('nibble', 2, 'preschool', 'to take tiny bites', ['silly-quest']),
  w('savor', 2, 'preschool', 'to enjoy slowly', ['kindness']),
  w('aroma', 3, 'preschool', 'a nice smell', ['kindness']),
  w('cozy', 2, 'toddler', 'warm and comfy', ['kindness', 'bedtime']),
  w('kitchen', 2, 'toddler', 'the room where food is made', ['kindness']),
  w('hearth', 1, 'preschool', 'the floor in front of a fireplace', ['bedtime', 'kindness']),
  w('blanket', 2, 'toddler', 'a cover that keeps you warm', ['bedtime', 'kindness']),
  w('quilt', 1, 'preschool', 'a blanket sewn from many pieces', ['bedtime', 'kindness']),
  w('rug', 1, 'toddler', 'a soft floor cover', ['kindness', 'bedtime']),
];

// ─── ABSTRACT / VALUES cluster ──────────────────────────────────────────────
const VALUES: Tier2WordEntry[] = [
  w('promise', 2, 'preschool', 'a strong word you really mean', ['friendship', 'kindness']),
  w('honor', 2, 'preschool', 'doing what is right', ['adventure', 'kindness']),
  w('honesty', 3, 'preschool', 'telling the truth', ['kindness']),
  w('justice', 2, 'grade-school', 'when things are fair', ['kindness']),
  w('mercy', 2, 'preschool', 'kindness when you could be tough', ['kindness']),
  w('respect', 2, 'preschool', 'treating someone the way they want', ['kindness']),
  w('responsibility', 6, 'grade-school', 'doing what you said you would', ['kindness']),
  w('teamwork', 2, 'preschool', 'people working as one', ['friendship', 'adventure']),
  w('determined', 3, 'preschool', 'not giving up', ['overcoming-fear', 'adventure']),
  w('persevere', 3, 'grade-school', 'keep trying when it is hard', ['overcoming-fear', 'adventure']),
  w('curiosity', 5, 'preschool', 'wanting to know more', ['curiosity']),
  w('imagination', 5, 'preschool', 'pictures in your head', ['curiosity', 'silly-quest']),
];

// ─── Combine all clusters into the master corpus ────────────────────────────

export const TIER2_VOCAB_CORPUS: Tier2WordEntry[] = [
  ...BEDTIME,
  ...FIRST_DAY,
  ...LOST_AND_FOUND,
  ...OVERCOMING_FEAR,
  ...NEW_BABY,
  ...KINDNESS,
  ...ADVENTURE,
  ...CURIOSITY,
  ...FRIENDSHIP,
  ...SIBLING,
  ...GOODBYE,
  ...SILLY,
  ...EMOTION,
  ...ACTIONS,
  ...NATURE,
  ...CHARACTERS,
  ...DESCRIPTORS,
  ...TIME_PLACE,
  ...SOUND,
  ...FEELINGS,
  ...COLOR_LIGHT,
  ...FOOD_HOME,
  ...VALUES,
];

/** Deduplicate by `word` (a word may appear in multiple clusters above). */
export const TIER2_VOCAB_CORPUS_DEDUPED: Tier2WordEntry[] = (() => {
  const seen = new Map<string, Tier2WordEntry>();
  for (const entry of TIER2_VOCAB_CORPUS) {
    const existing = seen.get(entry.word);
    if (!existing) {
      seen.set(entry.word, entry);
    } else {
      // Merge theme affinities; keep youngest ageBandMin (most permissive).
      const merged: Tier2WordEntry = {
        ...existing,
        themeAffinities: Array.from(
          new Set([...existing.themeAffinities, ...entry.themeAffinities]),
        ),
        ageBandMin: ageBandLooser(existing.ageBandMin, entry.ageBandMin),
      };
      seen.set(entry.word, merged);
    }
  }
  return Array.from(seen.values());
})();

function ageBandRank(b: Tier2WordEntry['ageBandMin']): number {
  if (b === 'toddler') return 0;
  if (b === 'preschool') return 1;
  return 2;
}
function ageBandLooser(
  a: Tier2WordEntry['ageBandMin'],
  b: Tier2WordEntry['ageBandMin'],
): Tier2WordEntry['ageBandMin'] {
  return ageBandRank(a) <= ageBandRank(b) ? a : b;
}

/** Stable count for tests + telemetry. Useful when corpus grows. */
export const TIER2_VOCAB_CORPUS_SIZE: number = TIER2_VOCAB_CORPUS_DEDUPED.length;
