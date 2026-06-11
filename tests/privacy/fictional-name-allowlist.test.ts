// tests/privacy/fictional-name-allowlist.test.ts
//
// fix/privacy-fictional-names — story-internal fictional cast names must
// survive the PII gate when (and ONLY when) they were explicitly chosen via
// structured StoryInput cast fields and passed to scrub() as `allowNames`.
//
// Covers:
//   - allowlisted name passes through scrub un-redacted
//   - non-allowlisted names are still redacted (hardFail intact)
//   - missing / empty allowNames == today's behavior (safe default)
//   - allowlist applies to the `name` category ONLY (email etc. unaffected)
//   - multi-word spans require every token (or the full span) allowlisted
//   - possessive forms ("Pip's") are stripped before comparison
//   - matching is case-sensitive (exact literal forms only)
//   - castAllowNames() consumes ONLY explicit cast fields, never free text
//   - StoryAuthorService.scrubSceneBriefsAsync end-to-end (sceneBrief +
//     illustration_brief keep cast names; kidName still becomes "the hero")
//   - allowlist does not leak into other scrub call sites (per-call opt-in;
//     gift dedications / publishToUniversal chokepoint unchanged)

import { describe, expect, it, beforeEach } from 'vitest';

import {
  PrivacyFilterService,
  privacyFilterService,
} from '$lib/privacy/PrivacyFilterService';
import {
  StoryAuthorService,
  castAllowNames,
} from '$lib/services/author/StoryAuthorService';
import type { SceneTree, StoryInput } from '$lib/services/author/types';

// ── Helpers ──────────────────────────────────────────────────────────────

const SCENE_RENDER_PURPOSE = 'scene_render' as any;

/** Fresh service pinned to the deterministic regex stub backend. */
function freshStubService(): PrivacyFilterService {
  const svc = new PrivacyFilterService();
  svc._setProbeOrderForTests(['stub']);
  return svc;
}

function baseInput(over: Partial<StoryInput> = {}): StoryInput {
  return {
    kidName: 'Eli',
    ageBand: 'preschool',
    ehriPhase: 'partial-alphabetic',
    theme: 'overcoming-fear',
    occasion: 'just-because',
    sidekickSettlerId: 'sidekick-1',
    supportingCast: [],
    localeBiome: 'forest',
    targetSpreads: 24,
    dedicationText: '',
    dialogicPromptsEnabled: true,
    easierReadingMode: false,
    ...over,
  };
}

function oneSceneTree(sceneBrief: string, illustrationBrief: string): SceneTree {
  return {
    title: 't',
    back_cover_blurb: 'b',
    page_budget: 1,
    tier2_words: [],
    beats: [
      {
        id: 1,
        beat_name: 'setup',
        emotional_arc: 'a',
        scenes: [
          {
            sceneId: 'setup-1',
            spreadCount: 1,
            sceneBrief,
            spreads: [
              {
                spreadIndex: 0,
                spread_text: 't',
                text_focus: 'left',
                illustration_brief: illustrationBrief,
              },
            ],
          },
        ],
      },
    ] as unknown as SceneTree['beats'],
  };
}

// ── scrub(text, { allowNames }) ──────────────────────────────────────────

describe('PrivacyFilterService.scrub — allowNames', () => {
  it('allowlisted fictional name passes through un-redacted', async () => {
    const svc = freshStubService();
    const report = await svc.scrub(
      'The fox Pip packed a red drum for the journey.',
      { purpose: SCENE_RENDER_PURPOSE, allowNames: ['Pip'] },
    );
    expect(report.redactedText).toContain('Pip');
    expect(report.redactedText).not.toContain('[REDACTED:name]');
    expect(report.hardFail).toBe(false);
    expect(report.detections.filter((d) => d.category === 'name')).toHaveLength(0);
  });

  it('non-allowlisted name is still redacted and still hard-fails', async () => {
    const svc = freshStubService();
    const report = await svc.scrub(
      'The fox Pip waved at Sarah near the den.',
      { purpose: SCENE_RENDER_PURPOSE, allowNames: ['Pip'] },
    );
    expect(report.redactedText).toContain('Pip');
    expect(report.redactedText).not.toContain('Sarah');
    expect(report.redactedText).toContain('[REDACTED:name]');
    expect(report.hardFail).toBe(true);
  });

  it('no allowNames → fictional name still redacted (safe default unchanged)', async () => {
    const svc = freshStubService();
    const report = await svc.scrub('The fox Pip packed a red drum.');
    expect(report.redactedText).not.toContain('Pip');
    expect(report.redactedText).toContain('[REDACTED:name]');
    expect(report.hardFail).toBe(true);
  });

  it('empty allowNames array behaves exactly like no allowNames', async () => {
    const svc = freshStubService();
    const withEmpty = await svc.scrub('The fox Pip packed a red drum.', {
      allowNames: [],
    });
    const without = await svc.scrub('The fox Pip packed a red drum.');
    expect(withEmpty.redactedText).toBe(without.redactedText);
    expect(withEmpty.hardFail).toBe(true);
  });

  it('allowlist applies to the name category ONLY — email still redacted', async () => {
    const svc = freshStubService();
    const report = await svc.scrub(
      'Write to pip@forest.example about Pip.',
      { purpose: SCENE_RENDER_PURPOSE, allowNames: ['Pip', 'pip@forest.example'] },
    );
    expect(report.redactedText).toContain('[REDACTED:email]');
    expect(report.redactedText).not.toContain('pip@forest.example');
    expect(report.redactedText).toContain('Pip.');
    expect(report.hardFail).toBe(true); // email is HARD regardless of allowNames
  });

  it('separate allowlisted tokens do not compose into a multi-word name', async () => {
    const svc = freshStubService();
    const report = await svc.scrub('She met Pip Wiggins at the pond.', {
      purpose: SCENE_RENDER_PURPOSE,
      allowNames: ['Pip', 'Wiggins'],
    });
    expect(report.redactedText).not.toContain('Pip Wiggins');
    expect(report.redactedText).toContain('[REDACTED:name]');
    expect(report.hardFail).toBe(true);
  });

  it('multi-word span is still redacted when only one token is allowlisted', async () => {
    const svc = freshStubService();
    const report = await svc.scrub('She met Pip Wiggins at the pond.', {
      purpose: SCENE_RENDER_PURPOSE,
      allowNames: ['Pip'],
    });
    expect(report.redactedText).not.toContain('Wiggins');
    expect(report.redactedText).toContain('[REDACTED:name]');
    expect(report.hardFail).toBe(true);
  });

  it('full-span allowlist entry matches a multi-word detection', async () => {
    const svc = freshStubService();
    const report = await svc.scrub('She met Pip Wiggins at the pond.', {
      purpose: SCENE_RENDER_PURPOSE,
      allowNames: ['Pip Wiggins'],
    });
    expect(report.redactedText).toContain('Pip Wiggins');
    expect(report.hardFail).toBe(false);
  });

  it("possessive form (Pip's) is stripped before allowlist comparison", async () => {
    const svc = freshStubService();
    // Inject a mock backend so the detection text carries the possessive —
    // this also proves the allowlist is backend-independent (it filters
    // detections, not raw text).
    svc._setBackendForTests('wasm', {
      detect: async (text: string) => {
        const idx = text.indexOf("Pip's");
        return idx < 0
          ? []
          : [{ category: 'name' as const, start: idx, end: idx + 5, text: "Pip's", confidence: 0.9 }];
      },
      warmup: async () => true,
    });
    const report = await svc.scrub("Hold the drum, Pip's friend said.", {
      forceBackend: 'wasm',
      purpose: SCENE_RENDER_PURPOSE,
      allowNames: ['Pip'],
    });
    expect(report.redactedText).toContain("Pip's");
    expect(report.hardFail).toBe(false);
  });

  it('matching is case-sensitive — lowercase allowlist entry does not free-pass', async () => {
    const svc = freshStubService();
    const report = await svc.scrub('The fox Pip packed a red drum.', {
      purpose: SCENE_RENDER_PURPOSE,
      allowNames: ['pip'],
    });
    expect(report.redactedText).not.toContain('Pip');
    expect(report.hardFail).toBe(true);
  });

  it('allowNames is per-call — it does not stick to the service instance', async () => {
    const svc = freshStubService();
    const first = await svc.scrub('The fox Pip packed a red drum.', {
      purpose: SCENE_RENDER_PURPOSE,
      allowNames: ['Pip'],
    });
    expect(first.hardFail).toBe(false);
    // Gift-dedication-style call site: no allowNames → still redacts.
    const dedication = await svc.scrub('For my dearest Pip, love always.');
    expect(dedication.redactedText).not.toContain('Pip');
    expect(dedication.hardFail).toBe(true);
  });

  it('allowNames is ignored without the scene_render purpose', async () => {
    const svc = freshStubService();
    const report = await svc.scrub('The fox Pip packed a red drum.', {
      allowNames: ['Pip'],
    });
    expect(report.redactedText).not.toContain('Pip');
    expect(report.redactedText).toContain('[REDACTED:name]');
    expect(report.hardFail).toBe(true);
  });

  it('allowNames is ignored for non-scene privacy purposes', async () => {
    const svc = freshStubService();
    const report = await svc.scrub('The fox Pip packed a red drum.', {
      purpose: 'agent_prompt',
      allowNames: ['Pip'],
    });
    expect(report.redactedText).not.toContain('Pip');
    expect(report.redactedText).toContain('[REDACTED:name]');
    expect(report.hardFail).toBe(true);
  });
});

// ── castAllowNames(input) ────────────────────────────────────────────────

describe('castAllowNames — explicit StoryInput cast fields only', () => {
  it('collects kidName + sidekickName + supportingCast names; trims, dedupes, skips blanks', () => {
    const input = baseInput({
      kidName: ' Eli ',
      sidekickName: 'Pip',
      supportingCast: [
        { id: 'c1', role: 'dog (Otis)', name: 'Otis' },
        { id: 'c2', role: 'the cat Whiskers' }, // no explicit name field
        { id: 'c3', role: 'sister', name: '   ' }, // blank → skipped
        { id: 'c4', role: 'friend', name: 'Pip' }, // dupe → deduped
      ],
    });
    expect(castAllowNames(input)).toEqual(['Eli', 'Pip', 'Otis']);
  });

  it('never derives names from free text (role / dedication are ignored)', () => {
    const input = baseInput({
      kidName: 'Eli',
      dedicationText: 'For Grandma June, with love',
      supportingCast: [{ id: 'c1', role: 'the dog Otis' }],
    });
    const names = castAllowNames(input);
    expect(names).toEqual(['Eli']);
    expect(names).not.toContain('Otis');
    expect(names).not.toContain('June');
  });
});

// ── StoryAuthorService.scrubSceneBriefsAsync end-to-end ──────────────────

describe('StoryAuthorService.scrubSceneBriefsAsync — fictional cast allowlist', () => {
  beforeEach(() => {
    privacyFilterService._resetForTests();
    privacyFilterService._setProbeOrderForTests(['stub']);
  });

  it('explicit cast names survive in sceneBrief + illustration_brief; kid name still becomes "the hero"', async () => {
    const svc = new StoryAuthorService();
    const tree = oneSceneTree(
      'Eli and Pip wave at Otis by the creek',
      'Close-up of Pip the fox; Otis wags his tail; warm light',
    );
    const hardFails = await svc.scrubSceneBriefsAsync(
      tree,
      baseInput({
        kidName: 'Eli',
        sidekickName: 'Pip',
        supportingCast: [{ id: 'c1', role: 'dog (Otis)', name: 'Otis' }],
      }),
    );
    expect(hardFails).toBe(0);
    const scene = tree.beats[0].scenes[0];
    expect(scene.sceneBrief).toContain('the hero');
    expect(scene.sceneBrief).not.toMatch(/\bEli\b/);
    expect(scene.sceneBrief).toContain('Pip');
    expect(scene.sceneBrief).toContain('Otis');
    expect(scene.sceneBrief).not.toContain('[REDACTED');
    const ib = scene.spreads[0].illustration_brief as string;
    expect(ib).toContain('Pip');
    expect(ib).toContain('Otis');
    expect(ib).not.toContain('[REDACTED');
  });

  it('without explicit cast names the sidekick is still redacted (bug-era behavior is the safe default)', async () => {
    const svc = new StoryAuthorService();
    const tree = oneSceneTree(
      'Eli follows Pip into the den',
      'Wide shot of Pip leading the way',
    );
    const hardFails = await svc.scrubSceneBriefsAsync(
      tree,
      baseInput({ kidName: 'Eli' }), // no sidekickName, no cast names
    );
    expect(hardFails).toBeGreaterThan(0);
    const scene = tree.beats[0].scenes[0];
    expect(scene.sceneBrief).not.toContain('Pip');
    expect(scene.sceneBrief).toContain('[REDACTED:name]');
    expect(scene.spreads[0].illustration_brief).not.toContain('Pip');
  });
});

// ── Other call sites unchanged ───────────────────────────────────────────

describe('allowlist does not leak into other scrub call sites', () => {
  beforeEach(() => {
    privacyFilterService._resetForTests();
    privacyFilterService._setProbeOrderForTests(['stub']);
  });

  it('publishToUniversal (gift dedication / cross-layer chokepoint) still rejects fictional names', async () => {
    // The chokepoint has NO allowNames plumbing — a dedication carrying a
    // name (fictional or not) must still hard-fail exactly as before.
    const { audit, scrubbed } = await privacyFilterService.publishToUniversal({
      payload: { kind: 'gift-dedication' },
      text: 'A bedtime gift for dear Pip from the whole family',
      purpose: 'lexicon_hint', // non-kernel purpose → deterministic untagged scrub path
      publishedTo: 'p2p',
      callerName: 'fictional-name-allowlist-test',
    });
    expect(scrubbed).toBeNull();
    expect(audit.allowed).toBe(false);
    expect(audit.redactions.some((r) => r.category === 'name')).toBe(true);
  });
});
