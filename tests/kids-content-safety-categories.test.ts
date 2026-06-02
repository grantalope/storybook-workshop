/**
 * KidsContentSafety — 7 categories × 5 cases.
 *
 * Each category has 5 positive (must trip) and 5 negative (must NOT trip)
 * cases drawn from real picture-book example sentences. The negatives are
 * the canary set — false-fails on neutral kid-book prose break the user
 * flow, and this suite locks the stub backend against drift.
 *
 * Stub backend used throughout; the WASM/Ollama backends are out-of-scope
 * for this suite (they need fine-tuned model weights, deferred per goal).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { kidsContentSafetyService } from '$lib/kids-content-safety';
import type { ScanOpts } from '$lib/kids-content-safety/types';

const opts: ScanOpts = { source: 'story_author' };

beforeEach(() => {
    kidsContentSafetyService._resetForTests();
    kidsContentSafetyService._setProbeOrderForTests(['stub']);
});

async function tripsCategory(text: string, category: string): Promise<boolean> {
    const r = await kidsContentSafetyService.scan(text, opts);
    return r.reports.some(
        (rep) => rep.category === category && rep.confidence >= 0.5,
    );
}

// ─────────────────────────────────────────────────────────────────────────
// 1. VIOLENCE
// ─────────────────────────────────────────────────────────────────────────

describe('Category: violence', () => {
    const positives = [
        'The soldier shot his rifle into the crowd.',
        'Blood dripped from the wound on her arm.',
        'The bully punched the smaller boy on the playground.',
        'A masked attacker stabbed the shopkeeper with a knife.',
        'The captain killed the pirate with a single sword stroke.',
    ];
    const negatives = [
        'The rabbit hopped through the meadow.',
        'They built a sandcastle by the shore.',
        'Mira painted a picture of the moon.',
        'The cat curled up on the soft pillow and purred.',
        'A gentle breeze rustled the leaves of the apple tree.',
    ];

    for (const t of positives) {
        it(`positive trips violence: "${t}"`, async () => {
            expect(await tripsCategory(t, 'violence')).toBe(true);
        });
    }
    for (const t of negatives) {
        it(`negative passes (no violence): "${t}"`, async () => {
            expect(await tripsCategory(t, 'violence')).toBe(false);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 2. FEAR_PERMANENT
// ─────────────────────────────────────────────────────────────────────────

describe('Category: fear_permanent', () => {
    const positives = [
        'Mira’s mommy died and was gone forever.',
        'The little boy was abandoned at the train station.',
        'They walked past the lonely cemetery on the hill.',
        'The kidnapper drove away with the children.',
        'Her father left and never came back.',
    ];
    const negatives = [
        'Mira’s mommy hugged her tight before bedtime.',
        'They walked past the gentle pond and waved at the ducks.',
        'The little boy hid behind the tree for the surprise.',
        'Her father read a story before turning out the light.',
        'The kitten was lost for a few minutes but found again.',
    ];
    for (const t of positives) {
        it(`positive trips fear_permanent: "${t}"`, async () => {
            expect(await tripsCategory(t, 'fear_permanent')).toBe(true);
        });
    }
    for (const t of negatives) {
        it(`negative passes (no fear_permanent): "${t}"`, async () => {
            expect(await tripsCategory(t, 'fear_permanent')).toBe(false);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 3. SEXUAL_ADULT
// ─────────────────────────────────────────────────────────────────────────

describe('Category: sexual_adult', () => {
    const positives = [
        'The two adults made love that night.',
        'A pornographic magazine sat on the coffee table.',
        'She felt a flush of erotic arousal as he leaned closer.',
        'They had sex in the back of the car.',
        'He flipped to the nude photograph on page four.',
    ];
    const negatives = [
        'The mom kissed her baby on the cheek.',
        'The naked baby splashed in the bath.',
        'The newlyweds danced under the lights.',
        'She felt a wave of joy as the music swelled.',
        'They held hands as they crossed the bridge.',
    ];
    for (const t of positives) {
        it(`positive trips sexual_adult: "${t}"`, async () => {
            expect(await tripsCategory(t, 'sexual_adult')).toBe(true);
        });
    }
    for (const t of negatives) {
        it(`negative passes (no sexual_adult): "${t}"`, async () => {
            expect(await tripsCategory(t, 'sexual_adult')).toBe(false);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 4. SUBSTANCE
// ─────────────────────────────────────────────────────────────────────────

describe('Category: substance', () => {
    const positives = [
        'The man poured himself a glass of whiskey.',
        'She was high on cocaine at the party.',
        'He lit a cigarette and exhaled into the cold air.',
        'The teens were smoking weed behind the gym.',
        'The drunken sailor stumbled down the dock.',
    ];
    const negatives = [
        'She poured a glass of milk for the puppy.',
        'He lit a candle on the birthday cake.',
        'The boy was high on the swing set.',
        'They smoked salmon for the picnic.',
        'The sailor whistled as he tied the rope.',
    ];
    for (const t of positives) {
        it(`positive trips substance: "${t}"`, async () => {
            expect(await tripsCategory(t, 'substance')).toBe(true);
        });
    }
    for (const t of negatives) {
        it(`negative passes (no substance): "${t}"`, async () => {
            expect(await tripsCategory(t, 'substance')).toBe(false);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 5. RELIGIOUS_POLITICAL
// ─────────────────────────────────────────────────────────────────────────

describe('Category: religious_political', () => {
    const positives = [
        'Donald Trump waved from the campaign stage.',
        'The communist party held a rally that evening.',
        'She quoted a verse from the Quran during the lesson.',
        'Joe Biden signed the bill into law.',
        'The evangelical preacher addressed the crowd.',
    ];
    const negatives = [
        'The family went to church together on Sunday.',
        'She paused to pray for safe travels.',
        'They lit a candle at the temple steps.',
        'The bell rang as the children filed inside.',
        'A flag hung quietly above the school door.',
    ];
    for (const t of positives) {
        it(`positive trips religious_political: "${t}"`, async () => {
            expect(await tripsCategory(t, 'religious_political')).toBe(true);
        });
    }
    for (const t of negatives) {
        it(`negative passes (no religious_political): "${t}"`, async () => {
            expect(await tripsCategory(t, 'religious_political')).toBe(false);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 6. SCARY_UNRESOLVED
// ─────────────────────────────────────────────────────────────────────────

describe('Category: scary_unresolved', () => {
    const positives = [
        'The monster in the closet whispered her name in the dark.',
        'A shadow moved silently behind the gate as she ran.',
        'The shadow followed her down the long hallway.',
        'A demonic figure crept closer through the fog.',
        'The haunted lighthouse loomed silent on the cliff.',
    ];
    const negatives = [
        'The friendly dragon waved hello before flying away.',
        'A flickering candle lit her way back to bed.',
        'The owl hooted softly from the oak tree.',
        'A small breeze brushed her cheek as she ran.',
        'The lighthouse beam swept calmly across the cliffs.',
    ];
    for (const t of positives) {
        it(`positive trips scary_unresolved: "${t}"`, async () => {
            expect(await tripsCategory(t, 'scary_unresolved')).toBe(true);
        });
    }
    for (const t of negatives) {
        it(`negative passes (no scary_unresolved): "${t}"`, async () => {
            expect(await tripsCategory(t, 'scary_unresolved')).toBe(false);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 7. BIGOTRY
// ─────────────────────────────────────────────────────────────────────────

describe('Category: bigotry', () => {
    const positives = [
        'The KKK rallied at the courthouse that morning.',
        'White power slogans covered the hateful pamphlet.',
        'Their leader called for a race war on the radio.',
        'The leaflet declared the master race must rule.',
        'Genocide was the only word for what had happened.',
    ];
    const negatives = [
        'Her best friend had a different skin color than hers.',
        'The classroom had children from many countries.',
        'They celebrated each other’s holidays together.',
        'The town hall welcomed every family equally.',
        'The new student spoke a language nobody in the class knew yet.',
    ];
    for (const t of positives) {
        it(`positive trips bigotry: "${t}"`, async () => {
            expect(await tripsCategory(t, 'bigotry')).toBe(true);
        });
    }
    for (const t of negatives) {
        it(`negative passes (no bigotry): "${t}"`, async () => {
            expect(await tripsCategory(t, 'bigotry')).toBe(false);
        });
    }
});
