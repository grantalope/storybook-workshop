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
import 'fake-indexeddb/auto';

import {
  PrivacyFilterService,
  privacyFilterService,
} from '$lib/privacy/PrivacyFilterService';
import {
  StoryAuthorService,
  castAllowNames,
  type KidsContentSafetyLike,
} from '$lib/services/author/StoryAuthorService';
import type { SceneTree, StoryInput } from '$lib/services/author/types';
import { buildStoryInput } from '$lib/workshop/services/WorkshopBookPipeline';
import {
  __TEST_resetKidProfileStore,
  getKidProfileStore,
} from '$lib/workshop/services/KidProfileStore';
import type { StationOutputs, WorkshopDraft } from '$lib/workshop/types';

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

function validAuthorTreeJson(sceneBrief: string, illustrationBrief: string): string {
  const beatNames = ['setup', 'catalyst', 'debate', 'midpoint', 'trial', 'climax', 'resolution'] as const;
  const spreadText = [
    'Once upon a time, the hero lived by the forest.',
    'Suddenly a bell rang.',
    'The hero felt worried.',
    'So the hero tried the path.',
    'But the path twisted, so the hero tried again.',
    'Finally, the hero found the gate.',
    'The hero smiled and felt proud. The end.',
  ];
  return JSON.stringify({
    title: 'The Brave Trail',
    back_cover_blurb: 'A gentle story about courage.',
    page_budget: 7,
    tier2_words: ['brave', 'trail', 'gentle'],
    beats: beatNames.map((beat_name, i) => ({
      id: i + 1,
      beat_name,
      emotional_arc: 'steady',
      scenes: [
        {
          sceneId: `${beat_name}-1`,
          spreadCount: 1,
          sceneBrief: i === 0 ? sceneBrief : 'the hero follows a moonlit trail',
          spreads: [
            {
              spreadIndex: i,
              spread_text: spreadText[i],
              text_focus: 'left',
              illustration_brief: i === 0 ? illustrationBrief : 'the hero on a quiet trail',
            },
          ],
        },
      ],
    })),
  });
}

const PERMISSIVE_SAFETY: KidsContentSafetyLike = {
  async scan() {
    return { passed: true, categories: [], confidence: 0 };
  },
};

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

describe('castAllowNames — structured fictional fields only', () => {
  it('collects trusted fictionalCastNames + explicitly-fictional supporting names; skips display-only names', () => {
    const input = baseInput({
      kidName: ' Eli ',
      sidekickName: 'Sarah',
      fictionalCastNames: ['Pip'],
      supportingCast: [
        { id: 'c1', role: 'dog (Otis)', name: 'Otis', fictionalName: true },
        { id: 'c2', role: 'sister', name: 'Sarah' }, // real/unmarked → skipped
        { id: 'c2', role: 'the cat Whiskers' }, // no explicit name field
        { id: 'c3', role: 'sister', name: '   ' }, // blank → skipped
        { id: 'c4', role: 'friend', name: 'Pip' }, // dupe → deduped
      ],
    });
    expect(castAllowNames(input)).toEqual(['Pip', 'Otis']);
    expect(castAllowNames(input)).not.toContain('Eli');
    expect(castAllowNames(input)).not.toContain('Sarah');
  });

  it('never derives names from free text (role / dedication are ignored)', () => {
    const input = baseInput({
      kidName: 'Eli',
      dedicationText: 'For Grandma June, with love',
      supportingCast: [{ id: 'c1', role: 'the dog Otis' }],
    });
    const names = castAllowNames(input);
    expect(names).toEqual([]);
    expect(names).not.toContain('Eli');
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

  it('fictional cast names survive in sceneBrief + illustration_brief; kid name still becomes "the hero"', async () => {
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
        fictionalCastNames: ['Pip'],
        supportingCast: [{ id: 'c1', role: 'dog (Otis)', name: 'Otis', fictionalName: true }],
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

  it('unmarked supporting-cast names are redacted even when sidekickName is allowed', async () => {
    const svc = new StoryAuthorService();
    const tree = oneSceneTree(
      'Eli follows Pip and Sarah into the den',
      'Wide shot of Sarah holding a lantern beside Pip',
    );
    const hardFails = await svc.scrubSceneBriefsAsync(
      tree,
      baseInput({
        kidName: 'Eli',
        sidekickName: 'Pip',
        fictionalCastNames: ['Pip'],
        supportingCast: [{ id: 'c1', role: 'sister', name: 'Sarah' }],
      }),
    );
    expect(hardFails).toBeGreaterThan(0);
    const scene = tree.beats[0].scenes[0];
    expect(scene.sceneBrief).toContain('Pip');
    expect(scene.sceneBrief).not.toContain('Sarah');
    expect(scene.sceneBrief).toContain('[REDACTED:name]');
    const ib = scene.spreads[0].illustration_brief as string;
    expect(ib).toContain('Pip');
    expect(ib).not.toContain('Sarah');
  });

  it('sidekickName alone is display metadata and does not bypass the scrub', async () => {
    const svc = new StoryAuthorService();
    const tree = oneSceneTree(
      'Eli follows Pip into the den',
      'Wide shot of Pip leading the way',
    );
    const hardFails = await svc.scrubSceneBriefsAsync(
      tree,
      baseInput({ kidName: 'Eli', sidekickName: 'Pip' }),
    );
    expect(hardFails).toBeGreaterThan(0);
    const scene = tree.beats[0].scenes[0];
    expect(scene.sceneBrief).not.toContain('Pip');
    expect(scene.sceneBrief).toContain('[REDACTED:name]');
    expect(scene.spreads[0].illustration_brief).not.toContain('Pip');
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

// ── StoryAuthorService.author gate regression ────────────────────────────

describe('StoryAuthorService.author — scene-render privacy gate', () => {
  beforeEach(() => {
    privacyFilterService._resetForTests();
    privacyFilterService._setProbeOrderForTests(['stub']);
  });

  it('does not ship an LLM tree whose scene briefs still contain unallowlisted real names', async () => {
    const svc = new StoryAuthorService();
    const tree = await svc.author(
      baseInput({
        kidName: 'Eli',
        sidekickName: 'Pip',
        fictionalCastNames: ['Pip'],
        targetSpreads: 7,
      }),
      {
        chatOverride: async () => ({
          content: validAuthorTreeJson(
            'the hero asks Sarah to follow Pip',
            'Sarah stands beside Pip under a lantern',
          ),
        } as any),
        safetyOverride: PERMISSIVE_SAFETY,
        maxLlmRetries: 0,
        skipQualityGate: true,
      },
    );
    expect(JSON.stringify(tree)).not.toContain('Sarah');
    expect(tree.meta?.template_fallback).toBe(true);
  });
});

// ── Workshop trust boundary ──────────────────────────────────────────────

describe('buildStoryInput — fictional sidekick trust boundary', () => {
  beforeEach(async () => {
    __TEST_resetKidProfileStore();
    await getKidProfileStore().__TEST_clear();
  });

  it('derives sidekickName from the catalog id instead of trusting saved draft text', async () => {
    const kid = await getKidProfileStore().create({
      name: 'Eli',
      birthdayIso: '2021-01-01',
    });
    const draft = {
      draftId: 'draft-1',
      kidId: kid.kidId,
      mode: 'standard',
      currentStation: 's6',
      outputs: {},
      createdAt: 0,
      updatedAt: 0,
      expiresAt: 1,
    } satisfies WorkshopDraft;
    const outputs = {
      s1: {
        theme: 'bedtime',
        occasion: 'just-because',
        lengthTier: 'bedtime',
        targetSpreads: 7,
        ehriPhase: 'partial-alphabetic',
      },
      s2: { pillarId: 'pillar-1' },
      s3: { dedicationText: 'For family.' },
      s4: {
        heroName: 'Eli',
        sidekickSettlerId: 'ada',
        sidekickName: 'Sarah',
        supportingCast: [],
        localeBiome: 'forest',
      },
      s5: {
        artStyle: 'octopath-hd2d',
        easierReadingMode: false,
        dialogicPromptsEnabled: true,
      },
    } satisfies StationOutputs;
    const input = await buildStoryInput(draft, outputs);
    expect(input.sidekickName).toBe('Ada');
    expect(input.fictionalCastNames).toEqual(['Ada']);
    expect(input.sidekickName).not.toBe('Sarah');
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
