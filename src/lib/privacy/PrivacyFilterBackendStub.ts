// @graph-layer: join
// @rationale: join (privacy filter backend — chokepoint detector implementation)

// d:\devbox\pachinko-app\src\routes\game\narrative\debug-dashboard\services\privacy\PrivacyFilterBackendStub.ts

/**
 * PrivacyFilterBackendStub — regex-based PII detector.
 *
 * The fallback backend used when WebGPU/WASM/Ollama are unavailable. Exists
 * primarily to keep the privacy gate green in test environments and during
 * model warmup. Real production traffic should hit the WebGPU backend whenever
 * possible.
 *
 * Detection strategy: pattern-by-category, then overlap dedupe (longest
 * detection wins on overlap), then a small allowlist of common non-name words
 * that the proper-noun pattern would otherwise capture.
 *
 * Spec: docs/superpowers/specs/2026-04-26-recipe-native-feed-engagement-design.md §6
 */

import type { PIICategory, PIIDetection } from '$lib/privacy/PrivacyTypes';

interface PatternSpec {
    category: PIICategory;
    re: RegExp;
    confidence: number;
}

// ── Allowlist for proper-noun pattern false positives ────────────────────
// Common single capitalized words and prompt-card lead-ins that look like
// names but aren't. Keep sorted alphabetically for diff sanity.
//
// SECURITY: Do NOT add real first names here. Doing so makes the solo-name
// pass silently free-pass mentions like "I met Sarah at the cafe", letting
// HARD-category PII flow through the stub backend (which is the active
// detector whenever WebGPU/WASM/Ollama warmup fails — CI, Node tests,
// headless Chromium, any browser without WebGPU). The 2-word `name` pattern
// is gated separately on TECH_NOUN_ALLOWLIST so removing real names from
// THIS list does not affect the "Email Jane at ..." 2-word golden corpus
// case.
const NON_NAME_ALLOWLIST = new Set([
    'Account', 'Accounts', 'Add', 'Address', 'Advice', 'After', 'Agent', 'Agents',
    'Already', 'Anagram', 'And', 'Android', 'Angular', 'Anonymous', 'Answer', 'API', 'Approve',
    'Are', 'As', 'At', 'Audit', 'Author', 'AWS', 'Azure',
    'Bank', 'Bearer', 'Before', 'Bingo', 'Blind', 'Block', 'Bold',
    'Born', 'Bracket', 'But', 'Buy', 'By',
    'Call', 'Caption', 'Card', 'Cards', 'Carousel', 'Cell',
    'Champion', 'Chat', 'Choose', 'City', 'Click', 'Cloud', 'Code', 'Coffee',
    'Comment', 'Common', 'Compare', 'Complete', 'Confession', 'Confirm',
    'Connect', 'Contact', 'Continue', 'Could', 'Creator', 'Crystal', 'CSS',
    'Daily', 'Date', 'Day', 'Days', 'Dear', 'Decision', 'Detail', 'Did', 'Django',
    'Direct', 'Discover', 'Discussion', 'Do', 'Docker', 'Does', 'Domain', 'Done',
    'Down', 'Drop', 'During',
    'Email', 'Emoji', 'Estimation', 'Even', 'Ever', 'Every',
    'Everyone', 'Explain', 'Express', 'External',
    'Family', 'Fast', 'Favorite', 'Feed', 'Few', 'Fill', 'Find',
    'Firebase', 'First', 'Flag', 'Floor', 'Flutter', 'Follow', 'For', 'From', 'Future',
    'GCP', 'Gift', 'Git', 'GitHub', 'Give', 'Go', 'Golang', 'Good', 'Got', 'GraphQL', 'Guess',
    'Had', 'Has', 'Have', 'He', 'Help', 'Here', 'Hey', 'High',
    'Higher', 'Hill', 'His', 'Honest', 'How', 'HTML', 'HTTP',
    'I', 'If', 'In', 'Insta', 'Instead', 'Invest', 'iOS', 'Is', 'It', 'Its',
    'Java', 'JavaScript', 'JSON', 'Just',
    'Keep', 'Key', 'Knowledge', 'Kotlin', 'Kubernetes',
    'Late', 'Later', 'Launch', 'Left', 'Less', 'Let', 'Like', 'Linux',
    'Live', 'Lock', 'Locked', 'Long', 'Look', 'Love', 'Low', 'Lower',
    'Mac', 'macOS', 'Mail', 'Make', 'Match', 'Maximize', 'Maybe', 'Me', 'Memory',
    'Menu', 'Message', 'Micro', 'Minute', 'Mint', 'MongoDB', 'Money', 'Mood',
    'More', 'Morning', 'Most', 'Must', 'My', 'Mystery',
    'Name', 'Need', 'New', 'News', 'Next', 'No', 'Node', 'Not', 'Note', 'Now', 'NPM',
    'Of', 'Off', 'OK', 'On', 'One', 'Online', 'Open', 'Or', 'Other',
    'Our', 'Out', 'Override',
    'Palette', 'Path', 'Patient', 'People', 'Perfect', 'PHP', 'Phone',
    'Pick', 'Picked', 'Pineapple', 'Pizza', 'Place', 'Play', 'Please',
    'Plot', 'Point', 'Poll', 'Postgres', 'PostgreSQL', 'Power', 'Predict', 'Premium', 'Press',
    'Price', 'Privacy', 'Probably', 'Prompt', 'Prove', 'Public', 'Push', 'Python', 'PyTorch',
    'Quality', 'Question', 'Quick', 'Quote',
    'R', 'Rank', 'Rapid', 'Rate', 'Rated', 'React', 'Read', 'Ready', 'Recipe',
    'Record', 'Reddit', 'Redis', 'Regret', 'Regretting', 'Remember', 'Reply',
    'REST', 'Report', 'Reveal', 'Right', 'Roast', 'Roll', 'Routing', 'Ruby', 'Run', 'Rust',
    'Same', 'Save', 'Say', 'Says', 'Scala', 'Scale', 'Score', 'Scroll',
    'Search', 'See', 'Send', 'September', 'Set', 'Settle', 'Several',
    'Shake', 'Share', 'Ship', 'Should', 'Show', 'Side', 'Silence',
    'Silent', 'Sit', 'Skill', 'Slow', 'Snap', 'So', 'Solidity', 'Some',
    'Someone', 'Soon', 'Sort', 'Source', 'Speak', 'Speed', 'Spotify', 'SQL',
    'Stack', 'Start', 'State', 'Status', 'Step', 'Still', 'Stop',
    'Story', 'Strategy', 'Stretch', 'Submit', 'Subscription', 'Such',
    'Survey', 'Svelte', 'Swap', 'Swift', 'Swipe',
    'Tag', 'Take', 'TensorFlow', 'Tell', 'Terrace', 'Test', 'Text', 'Than', 'Thank',
    'Thanks', 'That', 'The', 'Their', 'Then', 'There', 'These',
    'They', 'Thing', 'Things', 'Think', 'This', 'Those', 'Three',
    'Thursday', 'Time', 'Tiny', 'Tip', 'To', 'Today', 'Token',
    'Tomorrow', 'Top', 'Touch', 'Track', 'Trade', 'Trending', 'Trust',
    'Try', 'Turn', 'Tuesday', 'Tune', 'Twenty', 'Two', 'Type',
    'Ubuntu', 'Unity', 'Up', 'Update', 'Use', 'User',
    'Value', 'Vibes', 'Video', 'View', 'Visit', 'Voice', 'Vote', 'Vue',
    'Wait', 'Walk', 'Wallet', 'Warning', 'Was', 'Watch', 'We',
    'Web', 'Wednesday', 'Week', 'Weekly', 'Welcome', 'Were', 'What', 'When',
    'Where', 'Which', 'While', 'Who', 'Why', 'Will', 'Win', 'Window',
    'Windows', 'Wire', 'With', 'Without', 'Won', 'Wordle', 'Word', 'World',
    'Would', 'Write', 'Wrong',
    'XML',
    'Year', 'Years', 'Yes', 'Yesterday', 'You', 'Your',
]);

// ── Patterns ─────────────────────────────────────────────────────────────

const PATTERNS: PatternSpec[] = [
    // Email — RFC-ish, captures most real-world cases.
    { category: 'email', confidence: 0.98,
      re: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g },

    // Phone — requires explicit phone-shaped formatting: parenthesized area
    // code OR explicit separator (space/dot/dash) between groups. Bare 10-digit
    // runs like "9876543210" fall through to the account_number pattern.
    { category: 'phone', confidence: 0.9,
      re: /(?:\+?\d{1,3}[\s.\-])?(?:\(\d{3}\)\s?\d{3}[\s.\-]?\d{4}|\d{3}[\s.\-]\d{3}[\s.\-]\d{4})/g },

    // URL — http(s) or bare www.
    { category: 'url', confidence: 0.97,
      re: /(?:https?:\/\/|www\.)[^\s)<>\]]+/gi },

    // Date — ISO (YYYY-MM-DD) and US-style M/D/YYYY or MM/DD/YYYY.
    { category: 'date', confidence: 0.85,
      re: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g },

    // Account number — 10–19 digits (banks/cards), allowing dash/space groupings.
    { category: 'account_number', confidence: 0.8,
      re: /\b(?:\d[\d\- ]{8,22}\d)\b/g },

    // Secret — common API token shapes (sk-..., AKIA..., bearer-style hex blocks
    // ≥24 chars, JWT triplets).
    { category: 'secret', confidence: 0.95,
      re: /\b(?:sk-[A-Za-z0-9_\-]{16,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+|[A-Fa-f0-9]{32,})\b/g },

    // Address — US-style street: number + street name + suffix. Wide net,
    // allowlist filters common false hits.
    { category: 'address', confidence: 0.85,
      re: /\b\d{1,5}[A-Z]?\s+(?:[A-Z][a-zA-Z]+\s+){0,4}(?:Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Terrace|Place|Pl|Square|Sq|Parkway|Pkwy)\b\.?/g },

    // Coords — decimal lat/lng pair, e.g. "37.7749, -122.4194" (IRL Quest
    // Engine Phase 2 §6.1.1). Requires ≥3 decimal places on each side to
    // avoid catching benign decimals like "3.5" or "12.0".
    { category: 'coords', confidence: 0.95,
      re: /-?\d{1,3}\.\d{3,}[,\s]+-?\d{1,3}\.\d{3,}/g },

    // Name — Title-cased two-word run, optional middle initial. Aggressive;
    // single-word capitalized tokens deferred to a second-pass solo-name rule
    // below, gated by allowlist.
    { category: 'name', confidence: 0.75,
      re: /\b[A-Z][a-z]{1,15}(?:\s+[A-Z]\.)?\s+[A-Z][a-z]{1,20}\b/g },
];

// Single-word capitalized name pass — only triggers when token is NOT in the
// allowlist. Lower confidence; primarily catches first-name-only hits.
const SOLO_NAME_RE = /\b[A-Z][a-z]{1,15}\b/g;

// Tech / proper-noun allowlist — strictly used by the 2-word "name" pattern
// to free-pass capitalized tech terms that follow a sentence-lead verb
// ("Learn Rust", "Build Python tutor", "Try Vue"). Kept separate from the
// general NON_NAME_ALLOWLIST so it can't dilute solo-name detection: even
// if "React" lives in NON_NAME_ALLOWLIST for the solo pass, a 2-word match
// like "Learn React" is still skipped at the start-of-sentence-tech-suffix
// position. Real first names are NOT in either allowlist.
const TECH_NOUN_ALLOWLIST = new Set([
    'Android', 'Angular', 'API', 'AWS', 'Azure',
    'Cloud', 'CSS',
    'Django', 'Docker',
    'Firebase', 'Flutter',
    'GCP', 'Git', 'GitHub', 'Go', 'Golang', 'GraphQL',
    'HTML', 'HTTP',
    'iOS',
    'Java', 'JavaScript', 'JSON',
    'Kotlin', 'Kubernetes',
    'Linux',
    'Mac', 'macOS', 'MongoDB',
    'Node', 'NPM',
    'PHP', 'Postgres', 'PostgreSQL', 'Python', 'PyTorch',
    'R', 'React', 'Redis', 'REST', 'Ruby', 'Rust',
    'Scala', 'Solidity', 'SQL', 'Svelte', 'Swift',
    'TensorFlow', 'TypeScript',
    'Ubuntu', 'Unity',
    'Vue',
    'Web', 'Windows',
    'XML',
]);

// ── Detection ────────────────────────────────────────────────────────────

export function stubDetect(text: string): PIIDetection[] {
    if (!text || typeof text !== 'string') return [];

    const out: PIIDetection[] = [];

    for (const spec of PATTERNS) {
        for (const m of text.matchAll(spec.re)) {
            const start = m.index ?? 0;
            // Multi-word 'name' pattern is the dominant false-positive source
            // for free-text goals like "Learn Rust in 6 weeks" or "Build a
            // Python tutor". Skip the match when (a) it starts at the
            // sentence-lead position (the first token is a verb that the
            // solo-name pass already free-passes), AND (b) every following
            // token is a TECH allowlist entry (not the wider non-name
            // allowlist, which contains exemplar names like "Jane" / "Sarah"
            // that are intentionally allowed to trigger 2-word detection).
            if (spec.category === 'name' && start === 0) {
                const tokens = m[0].split(/\s+/).filter(t => t.length > 0);
                if (tokens.length >= 2) {
                    const rest = tokens.slice(1);
                    const restAllTech = rest.every(tok =>
                        TECH_NOUN_ALLOWLIST.has(tok.replace(/\.$/, '')),
                    );
                    if (restAllTech) continue;
                }
            }
            out.push({
                category: spec.category,
                start,
                end: start + m[0].length,
                text: m[0],
                confidence: spec.confidence,
            });
        }
    }

    // Solo-name pass — gated by allowlist to keep FP rate low on prompt copy.
    for (const sm of text.matchAll(SOLO_NAME_RE)) {
        const tok = sm[0];
        const start = sm.index ?? 0;
        if (NON_NAME_ALLOWLIST.has(tok)) continue;
        // Skip when token is the lead char of the full text (sentence start
        // bias would explode FP otherwise — most card prompts start
        // capitalized).
        if (start === 0) continue;
        // Skip when surrounded by alphanumerics (mid-word match).
        const prev = text[start - 1] ?? ' ';
        const next = text[start + tok.length] ?? ' ';
        if (/[A-Za-z0-9]/.test(prev) || /[A-Za-z0-9]/.test(next)) continue;
        // Skip contractions — token followed by an apostrophe is "Don't",
        // "I'm", "It's", "We're", etc.
        if (next === "'" || next === '’') continue;
        out.push({
            category: 'name',
            start,
            end: start + tok.length,
            text: tok,
            confidence: 0.55,
        });
    }

    return dedupeOverlaps(out);
}

/**
 * When two detections overlap, keep the higher-confidence one; on tie, keep
 * the longer span. Sort first by start asc to make the linear sweep correct.
 */
function dedupeOverlaps(detections: PIIDetection[]): PIIDetection[] {
    if (detections.length <= 1) return [...detections].sort((a, b) => a.start - b.start);

    const sorted = [...detections].sort((a, b) => a.start - b.start || b.end - a.end);
    const result: PIIDetection[] = [];

    for (const d of sorted) {
        const last = result[result.length - 1];
        if (!last || d.start >= last.end) {
            result.push(d);
            continue;
        }
        // Overlap. Decide which wins.
        const lastLen = last.end - last.start;
        const curLen = d.end - d.start;
        const lastBetter =
            last.confidence > d.confidence ||
            (last.confidence === d.confidence && lastLen >= curLen);
        if (!lastBetter) {
            result[result.length - 1] = d;
        }
    }

    return result;
}

// ── Async wrappers (parity with backend trifecta) ────────────────────────

export async function stubWarmup(): Promise<boolean> {
    return true;
}

export async function stubDetectAsync(text: string): Promise<PIIDetection[]> {
    return stubDetect(text);
}
