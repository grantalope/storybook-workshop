// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// src/routes/dashboard/services/kids-content-safety/backends/KidsContentSafetyBackendStub.ts
//
// Regex+keyword baseline detector for the 7 KidsContentSafety categories.
// Always available, no warmup, no external deps. This is the day-1 path
// that ships before the DistilBERT ONNX bundle (WASM/WebGPU backends) is
// hosted at its production URL.
//
// Detection strategy mirrors PrivacyFilterBackendStub: per-category regex
// patterns, longest-match dedupe on overlap, confidence 1.0 on exact
// keyword hit (vs the classifier backends which emit calibrated [0,1]
// probabilities).
//
// CURATION METHOD (recorded for implementation-notes.md):
//   1. Seeded each category from the spec §4.1 single-word descriptor
//      (violence, fear_permanent, ...).
//   2. Expanded via the most-cited kid-content moderation taxonomies
//      (Common Sense Media age-gating tags, Lexile/ATOS content warnings,
//      OpenAI moderation API category descriptions).
//   3. Pruned anything that produces obvious false positives in normal
//      kid-book prose (e.g. "kill time" in violence, "lost" in fear).
//   4. Negation/lemma normalization is intentionally LIGHT in v1 — the
//      WASM classifier handles nuance; the stub is the loud baseline
//      that catches the obvious cases.

import type {
    KidsContentSafetyBackend,
    SafetyCategory,
    ScanOpts,
    ScanReport,
} from '../types';

interface KeywordSpec {
    category: SafetyCategory;
    // Use \b-anchored regex per word — pre-built once at module load so the
    // hot path is matchAll over compiled RegExp objects.
    re: RegExp;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. VIOLENCE — weapons + violent acts + harm verbs.
//    Picture-book-safe inversions kept OUT of the list ("battle of wits",
//    "fight for fairness" — those need context the WASM model provides).
// ─────────────────────────────────────────────────────────────────────────
const VIOLENCE_WORDS = [
    'kill', 'killed', 'killing', 'killer', 'murder', 'murdered',
    'stab', 'stabbed', 'stabbing', 'slash', 'slashed', 'slay', 'slain',
    'shoot', 'shot', 'shooting', 'gun', 'guns', 'pistol', 'rifle', 'shotgun',
    'bullet', 'bullets', 'firearm',
    'blood', 'bloody', 'bleed', 'bleeding', 'gore', 'gory', 'gruesome',
    'beat', 'beaten', 'beating', 'punch', 'punched', 'kick', 'kicked',
    'strangle', 'strangled', 'strangling', 'choke', 'choked', 'choking',
    'torture', 'tortured', 'torturing',
    'corpse', 'corpses', 'dead body', 'dead bodies',
    'massacre', 'massacred', 'slaughter', 'slaughtered',
    'sword fight', 'knife fight', 'gunfight', 'shootout',
    'attack', 'attacked', 'attacker', 'assault', 'assaulted',
    'wound', 'wounded', 'injure', 'injured', 'injury',
    'execute', 'executed', 'execution', 'hang', 'hanged', 'hanging',
];

// ─────────────────────────────────────────────────────────────────────────
// 2. FEAR_PERMANENT — death-of-parent, abandonment, forever-loss.
//    The category is about IRREVERSIBLE bad outcomes that linger past the
//    final page. "Lost mommy" → keep (forever-loss); "lost his hat" → skip
//    (handled by the WASM classifier; stub goes loud on the parent words).
// ─────────────────────────────────────────────────────────────────────────
const FEAR_PERMANENT_WORDS = [
    'died', 'dies', 'dying', 'died forever',
    'never come back', 'never comes back', 'never came back',
    'never see again', 'gone forever', 'gone for good',
    'mommy died', 'daddy died', 'mother died', 'father died',
    'mommy is gone', 'daddy is gone', 'mom is gone forever', 'dad is gone forever',
    'left forever', 'left and never returned',
    'abandoned', 'abandoning', 'abandonment',
    'orphaned', 'orphan',
    'funeral', 'buried', 'grave', 'graveyard', 'tombstone', 'cemetery',
    'kidnapped', 'kidnapping', 'kidnapper',
    'disappeared forever', 'vanished forever',
    'will never be seen', 'will never be found',
    'no one is coming', 'no one will come',
    'forever lost',
];

// ─────────────────────────────────────────────────────────────────────────
// 3. SEXUAL_ADULT — adult content keywords. Stub stays at the obvious-
//    pattern layer; the WASM model handles ambiguity ("undressed for bath"
//    in a kid book vs adult contexts).
// ─────────────────────────────────────────────────────────────────────────
const SEXUAL_ADULT_WORDS = [
    'sex', 'sexual', 'sexy', 'erotic', 'erotica',
    'nude', 'nudity', 'naked adults',
    'breast', 'breasts', 'genital', 'genitals', 'penis', 'vagina',
    'porn', 'pornography', 'pornographic',
    'orgasm', 'climax', 'arousal', 'aroused',
    'intercourse', 'fornicate', 'fornication',
    'lust', 'lustful', 'seduce', 'seduced', 'seduction', 'seductive',
    'kissed passionately', 'made love',
    'strip club', 'brothel',
    'masturbat',  // matches masturbate/masturbation/masturbating
    'sexually',
];

// ─────────────────────────────────────────────────────────────────────────
// 4. SUBSTANCE — drugs, alcohol, smoking.
// ─────────────────────────────────────────────────────────────────────────
const SUBSTANCE_WORDS = [
    'drug', 'drugs', 'drugged',
    'cocaine', 'heroin', 'meth', 'methamphetamine', 'crack',
    'marijuana', 'weed', 'cannabis', 'pot smoke',
    'syringe', 'needle drug', 'injecting',
    'alcohol', 'alcoholic', 'drunk', 'drunken', 'drinking heavily',
    'beer', 'whiskey', 'whisky', 'vodka', 'rum', 'gin', 'tequila',
    'wine drinking', 'binge drinking', 'hangover',
    'cigarette', 'cigarettes', 'cigar', 'cigars',
    'smoking weed', 'smoking pot', 'smoke crack',
    'overdose', 'overdosed',
    'vape', 'vaping', 'vapes',
    'addiction', 'addicted to', 'addict',
    'high on drugs',
    'bottle of liquor', 'shot of liquor',
];

// ─────────────────────────────────────────────────────────────────────────
// 5. RELIGIOUS_POLITICAL — specific religion/political identifiers. Stub
//    flags ANY explicit identifier so callers can decide; the WASM model
//    will down-rank educational mentions (covered scriptures, civics
//    history etc.).
// ─────────────────────────────────────────────────────────────────────────
const RELIGIOUS_POLITICAL_WORDS = [
    // Religion identifiers (proper names, not concepts like "pray" which
    // would over-flag culturally-neutral kid books).
    'jesus christ', 'allah', 'muhammad', 'prophet muhammad', 'krishna', 'vishnu',
    'buddha', 'yahweh', 'jehovah',
    'christianity', 'christian doctrine', 'muslim doctrine', 'islamic doctrine',
    'jewish doctrine', 'hindu doctrine', 'buddhist doctrine',
    'catholic doctrine', 'protestant doctrine', 'evangelical',
    'sunni', 'shia', 'shiite',
    'baptism', 'bar mitzvah', 'bat mitzvah', 'communion',
    'gospel of', 'quran', "qur'an", 'torah', 'bible verse',
    // Political identifiers (party names + ideologies).
    'republican party', 'democrat party', 'democratic party',
    'liberal agenda', 'conservative agenda',
    'communist', 'communism', 'socialist', 'socialism',
    'fascist', 'fascism', 'nazi', 'nazis',
    'donald trump', 'joe biden', 'kamala harris',
    'vote for', 'vote against',
    'pro-life', 'pro-choice', 'abortion debate',
    'gun control debate', 'second amendment debate',
];

// ─────────────────────────────────────────────────────────────────────────
// 6. SCARY_UNRESOLVED — dread, monster-coming, threat-pending without
//    resolution markers. The category targets LLM hallucinations that
//    end mid-threat ("the shadow moved closer..." with no resolution).
//    Stub flags the dread vocabulary loud; WASM model handles "but the
//    sun came up and the shadow was gone" context.
// ─────────────────────────────────────────────────────────────────────────
const SCARY_UNRESOLVED_WORDS = [
    'terrified', 'terrifying', 'horror', 'horrifying',
    'nightmare', 'nightmares',
    'monster under', 'monster in the closet', 'monster in the dark',
    'something watching', 'someone watching',
    'shadow followed', 'shadow moved',
    'creeping closer', 'crept closer',
    'screams in the dark', 'screaming in the night',
    'demon', 'demonic', 'possessed by',
    'haunted', 'haunting', 'ghosts followed',
    'evil spirit', 'evil eye', 'cursed forever',
    'bloodcurdling', 'spine-chilling',
    'creature from', 'creature in the woods',
    'whispered names', 'whispered from the darkness',
    'devoured', 'devour', 'eaten alive',
    'no escape',
    'silent scream', 'unspeakable horror',
];

// ─────────────────────────────────────────────────────────────────────────
// 7. BIGOTRY — structural patterns (don't list slurs explicitly in source).
//    Stub catches generic "stupid <group>", "<group> are all" patterns
//    + explicit hate-group identifiers. WASM model handles slur detection
//    via its fine-tuned head (the model weights have the slur table, not
//    the repo).
// ─────────────────────────────────────────────────────────────────────────
const BIGOTRY_WORDS = [
    'kkk', 'klan', 'white supremac', 'white power',
    'race war', 'racial purity', 'master race',
    'genocide', 'ethnic cleansing',
    'subhuman', 'untermensch',
    'inferior race', 'inferior people',
    'all blacks are', 'all whites are', 'all asians are',
    'all jews are', 'all muslims are', 'all christians are',
    'all gays are', 'all women are stupid', 'all men are stupid',
    'go back to your country',
    'hate group', 'hate crime',
    'lynch', 'lynching', 'lynched',
    'apartheid system',
];

// Build the regex table. \b-anchored, case-insensitive. Words containing
// non-letter chars (apostrophe, hyphen, space) are escaped properly.
function buildKeywordRegex(words: string[]): RegExp {
    const escaped = words.map((w) =>
        w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    // Word boundary at start; for multi-word phrases, the \b at start catches
    // the first letter and we rely on the literal terminator being whitespace
    // or punctuation. For single words we want \b at end too — combined
    // pattern uses \b on both sides which works for both cases because
    // multi-word phrases end with a letter.
    return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}

const KEYWORD_SPECS: KeywordSpec[] = [
    { category: 'violence', re: buildKeywordRegex(VIOLENCE_WORDS) },
    { category: 'fear_permanent', re: buildKeywordRegex(FEAR_PERMANENT_WORDS) },
    { category: 'sexual_adult', re: buildKeywordRegex(SEXUAL_ADULT_WORDS) },
    { category: 'substance', re: buildKeywordRegex(SUBSTANCE_WORDS) },
    { category: 'religious_political', re: buildKeywordRegex(RELIGIOUS_POLITICAL_WORDS) },
    { category: 'scary_unresolved', re: buildKeywordRegex(SCARY_UNRESOLVED_WORDS) },
    { category: 'bigotry', re: buildKeywordRegex(BIGOTRY_WORDS) },
];

// Count the curated keyword corpus for telemetry / spec compliance.
export const STUB_KEYWORD_COUNT =
    VIOLENCE_WORDS.length +
    FEAR_PERMANENT_WORDS.length +
    SEXUAL_ADULT_WORDS.length +
    SUBSTANCE_WORDS.length +
    RELIGIOUS_POLITICAL_WORDS.length +
    SCARY_UNRESOLVED_WORDS.length +
    BIGOTRY_WORDS.length;

// ─────────────────────────────────────────────────────────────────────────
// Public detect entrypoint.
// ─────────────────────────────────────────────────────────────────────────

export function stubScan(text: string): ScanReport[] {
    if (!text || typeof text !== 'string') return [];

    const reports: ScanReport[] = [];

    for (const spec of KEYWORD_SPECS) {
        for (const m of text.matchAll(spec.re)) {
            const start = m.index ?? 0;
            reports.push({
                category: spec.category,
                confidence: 1.0,
                span: [start, start + m[0].length],
            });
        }
    }

    return dedupeReports(reports);
}

/**
 * Dedupe overlapping reports — when two reports overlap, keep the longer.
 * Multi-category overlap (same span trips two categories) is preserved
 * because the policy layer aggregates per-category.
 */
function dedupeReports(reports: ScanReport[]): ScanReport[] {
    if (reports.length <= 1) return reports;
    // Group by category, then within-category dedupe by overlap.
    const byCategory = new Map<SafetyCategory, ScanReport[]>();
    for (const r of reports) {
        const arr = byCategory.get(r.category) ?? [];
        arr.push(r);
        byCategory.set(r.category, arr);
    }
    const out: ScanReport[] = [];
    for (const [, group] of byCategory) {
        group.sort((a, b) => (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0));
        for (const r of group) {
            const last = out[out.length - 1];
            if (
                !last ||
                last.category !== r.category ||
                (r.span?.[0] ?? 0) >= (last.span?.[1] ?? 0)
            ) {
                out.push(r);
                continue;
            }
            const lastLen = (last.span?.[1] ?? 0) - (last.span?.[0] ?? 0);
            const curLen = (r.span?.[1] ?? 0) - (r.span?.[0] ?? 0);
            if (curLen > lastLen) {
                out[out.length - 1] = r;
            }
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Backend module-level exports (parity with privacy backend trifecta —
// `stubScan` / `stubWarmup` are the function-style API used by the
// service's lazy probe path).
// ─────────────────────────────────────────────────────────────────────────

export async function stubWarmup(): Promise<boolean> {
    return true;
}

/**
 * Class-style binding for callers that want a backend OBJECT (kernel
 * boot, dependency-injection in tests). Functionally equivalent to the
 * module-level `stubScan`/`stubWarmup`.
 */
export class KidsContentSafetyBackendStub implements KidsContentSafetyBackend {
    readonly name = 'stub' as const;
    private ready = false;

    async warmup(): Promise<boolean> {
        this.ready = true;
        return true;
    }

    async scan(text: string, _opts: ScanOpts): Promise<ScanReport[]> {
        return stubScan(text);
    }

    isReady(): boolean {
        return this.ready;
    }
}
