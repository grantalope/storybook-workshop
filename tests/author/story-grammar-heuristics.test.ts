// tests/storybook-workshop/author/story-grammar-heuristics.test.ts
//
// Un-brittled Stein-Glenn grammar gate (fix/story-grammar-gate).
//
// Context: a live e2e run on claude.local had gemma3:12b produce 6 real
// drafts; the old single-keyword gate rejected 5/5 non-empty ones even though
// every Stein-Glenn element was semantically present ("A sudden breeze
// rustled the leaves" = initiating event with no "suddenly"; "Juniper
// scrambled over the log" = attempt with no "tried"). The 6th draft was an
// empty-prose skeleton that deserved rejection. These tests pin:
//   1. heuristic signal families accept the REAL failing patterns,
//   2. per-element confidence + the avg>=0.6/no-zero pass rule,
//   3. negation-aware emotion matching,
//   4. coached correction prompts (element named + 1-line example),
//   5. salvage mode in StoryAuthorService + grammarGate telemetry,
//   6. WorkshopBookPipeline surfacing the telemetry.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import {
  GRAMMAR_PASS_AVG,
  StoryGrammarValidator,
} from '$lib/services/author/StoryGrammarValidator';
import {
  StoryAuthorService,
  type KidsContentSafetyLike,
} from '$lib/services/author/StoryAuthorService';
import type { ChatRequest, ChatResponse } from '$lib/kernel-contracts/helpers/llr-fallback';
import {
  BEAT_NAMES,
  type Beat,
  type BeatId,
  type SceneTree,
  type StoryInput,
} from '$lib/services/author/types';
import { IdbKeyValueStore } from '$lib/workshop/advanced/services/IdbKeyValueStore';
import {
  getKidProfileStore,
  __TEST_resetKidProfileStore,
} from '$lib/workshop/services/KidProfileStore';
import { WorkshopDraftStore } from '$lib/workshop/services/WorkshopDraftStore';
import { WorkshopOrchestrator } from '$lib/workshop/services/WorkshopOrchestrator';
import { runWorkshopPipeline } from '$lib/workshop/services/WorkshopBookPipeline';
import type { WorkshopDraft } from '$lib/workshop/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function tree(beatTexts: Record<BeatId, string>, briefs?: Record<BeatId, string>): SceneTree {
  const beats: Beat[] = ([1, 2, 3, 4, 5, 6, 7] as BeatId[]).map((id) => ({
    id,
    beat_name: BEAT_NAMES[id],
    emotional_arc: 'content → apprehensive',
    scenes: [
      {
        sceneId: `${BEAT_NAMES[id]}-1`,
        spreadCount: 1,
        sceneBrief: briefs?.[id] ?? 'brief',
        spreads: [{ spreadIndex: id - 1, spread_text: beatTexts[id] ?? '', text_focus: 'left' }],
      },
    ],
  }));
  return { title: 't', back_cover_blurb: 'b', page_budget: 7, tier2_words: [], beats };
}

const v = new StoryGrammarValidator();

/**
 * Close paraphrase of the gemma3:12b drafts the old keyword gate rejected:
 * implicit initiating event (no "suddenly"/"arrived"), movement-verb attempts
 * (no "tried"), obstacle consequences (no "failed"/"managed").
 */
const GEMMA3_STYLE: Record<BeatId, string> = {
  1: 'Sunbeams danced on the moss. The woods smelled like warm pine. Juniper loved her woods.',
  2: 'Whoosh! A sudden breeze rustled the leaves. "Hush… hush," the trees seemed to say. Did you hear that?',
  3: "Juniper's tummy did a flip. She felt very nervous. Maybe we should go back. But what if it is something?",
  4: 'Taking one small, daring step, Juniper peeked around a giant tree. Tip-tip-tiptoe through the leaves.',
  5: 'A tangled vine tripped Juniper! A rushing stream blocked their way. "We need to find a way across!"',
  6: "Stepping across the log, Juniper found a baby owl! It was making all the whispering sounds. \"Let's help it find its family!\"",
  7: "Back at the edge of the woods, Juniper smiled. She was brave! The woods didn't seem so scary anymore.",
};

/** All six elements present, but each only via one weak/medium signal — fails the bar, salvageable. */
const WEAK_BUT_COMPLETE: Record<BeatId, string> = {
  1: 'By the tall trees it waited.',
  2: 'A strange noise drifted near.',
  3: 'What if the path twisted away?',
  4: 'Stepped past the gate quickly.',
  5: 'But the gate would not open wide.',
  6: 'So the door stood there quietly.',
  7: 'She remembered the long road.',
};

/** Structurally broken: internal_response (and more) at confidence 0 everywhere. */
const HARD_BROKEN: Record<BeatId, string> = {
  1: 'static prose here',
  2: 'still nothing here',
  3: 'no emotion in this beat',
  4: 'static',
  5: 'static',
  6: 'static',
  7: 'static',
};

const PERMISSIVE_SAFETY: KidsContentSafetyLike = {
  async scan() {
    return { passed: true, categories: [], confidence: 0 };
  },
};

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
    targetSpreads: 7,
    dedicationText: '',
    dialogicPromptsEnabled: false,
    easierReadingMode: false,
    ...over,
  };
}

function chatReturning(content: string): (req: ChatRequest) => Promise<ChatResponse> {
  return async () => ({ content }) as unknown as ChatResponse;
}

// ─── 1. Real gemma3 failure patterns now score ──────────────────────────────

describe('StoryGrammarValidator — heuristic signal families (real gemma3 patterns)', () => {
  it('passes the full gemma3-style draft the keyword gate rejected 5/5', () => {
    const r = v.validate(tree(GEMMA3_STYLE));
    expect(r.passed).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.avgScore).toBeGreaterThanOrEqual(GRAMMAR_PASS_AVG);
  });

  it('initiating_event accepts a sudden-event pattern without "suddenly" (draft 4 beat 2)', () => {
    const r = v.validate(tree({ ...GEMMA3_STYLE, 2: 'Whoosh! A sudden breeze rustled the leaves.' }));
    expect(r.elementScores.initiating_event).toBeGreaterThanOrEqual(0.6);
    expect(r.beatGaps[2]).toEqual([]);
  });

  it('attempt accepts hero-subject + movement verb without "tried" (draft 5 beat 4)', () => {
    const r = v.validate(
      tree({ ...GEMMA3_STYLE, 4: 'Taking a breath, Juniper stepped out. Into the woods, shadows so tall.' }),
    );
    expect(r.elementScores.attempt).toBeGreaterThanOrEqual(0.6);
    expect(r.beatGaps[4]).toEqual([]);
  });

  it('consequence accepts obstacle phrasing without "failed"/"managed" (draft 1 beat 5)', () => {
    const r = v.validate(
      tree({
        ...GEMMA3_STYLE,
        5: 'A tangled vine tripped Juniper! A rushing stream blocked their way. "We need to find a way across!"',
        6: 'So the door stood there quietly.', // strip beat-6 outcome so beat 5 carries it
      }),
    );
    expect(r.elementScores.consequence).toBeGreaterThan(0);
    expect(r.beatGaps[5]).toEqual([]); // both attempt + consequence found in-beat
  });

  it('subject+action structural signal scores higher than a bare action verb', () => {
    const withSubject = v.validate(tree({ ...GEMMA3_STYLE, 4: 'Juniper scrambled over the log.' }));
    const without = v.validate(tree({ ...GEMMA3_STYLE, 4: 'Scrambled over, quickly now, hooray.' }));
    expect(withSubject.elementScores.attempt).toBeGreaterThan(without.elementScores.attempt);
    expect(without.elementScores.attempt).toBeGreaterThan(0); // verb alone still counts
  });
});

// ─── 2. Hard failures stay hard ─────────────────────────────────────────────

describe('StoryGrammarValidator — still rejects genuinely broken drafts', () => {
  it('hard-fails the empty-prose skeleton (gemma3 draft 2 pattern) even with rich scene briefs', () => {
    const briefs: Record<BeatId, string> = {
      1: 'The hero stands at the edge of a sun-dappled forest.',
      2: 'A sound is heard deep in the woods.',
      3: 'The hero and sidekick discuss whether to continue.',
      4: 'The hero takes a tentative step forward.',
      5: 'The path becomes tricky; obstacles appear.',
      6: 'The source of the whispers is revealed.',
      7: 'The hero returns home, feeling brave.',
    };
    const empty = tree({ 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '' }, briefs);
    const r = v.validate(empty);
    expect(r.passed).toBe(false);
    expect(r.missing.length).toBe(6); // briefs/arcs must never carry the gate
    for (const score of Object.values(r.elementScores)) expect(score).toBe(0);
  });

  it('fails a complete-but-weak draft on the average bar with missing empty', () => {
    const r = v.validate(tree(WEAK_BUT_COMPLETE));
    expect(r.passed).toBe(false);
    expect(r.missing).toEqual([]); // every element present…
    expect(r.avgScore).toBeLessThan(GRAMMAR_PASS_AVG); // …but too faint overall
  });

  it('negation guard: negated emotion words do not satisfy internal_response', () => {
    const r = v.validate(tree({ ...GEMMA3_STYLE, 3: 'Mute beat here. No worry. No wonder.', 4: 'Stepped past the gate quickly.' }));
    expect(r.elementScores.internal_response).toBe(0);
    expect(r.beatGaps[3]).toContain('internal_response');
  });

  it('negated fear is still a valid reaction ("didn\'t seem so scary anymore")', () => {
    const r = v.validate(tree({ ...GEMMA3_STYLE, 7: "The woods didn't seem so scary anymore." }));
    expect(r.elementScores.reaction).toBeGreaterThan(0);
    expect(r.beatGaps[7]).toEqual([]);
  });
});

// ─── 3. Score semantics ─────────────────────────────────────────────────────

describe('StoryGrammarValidator — confidence semantics', () => {
  it('elementScores are within [0,1] and avgScore is their mean', () => {
    const r = v.validate(tree(GEMMA3_STYLE));
    const scores = Object.values(r.elementScores);
    expect(scores.length).toBe(6);
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(Math.abs(r.avgScore - mean)).toBeLessThanOrEqual(0.005); // round2 tolerance
  });
});

// ─── 4. Coached correction prompts ──────────────────────────────────────────

describe('StoryGrammarValidator — coached correction prompts', () => {
  it('names each zero-confidence element with a 1-line example of satisfying it', () => {
    const r = v.validate(tree({ ...GEMMA3_STYLE, 2: 'Filler words sit here calmly.', 3: 'More filler sits here calmly.' }));
    expect(r.missing).toContain('initiating_event');
    const prompt = v.correctionPrompt(r);
    expect(prompt).toContain('initiating_event');
    expect(prompt).toContain('Beat 2 must contain the moment the problem starts');
    expect(prompt).toContain('e.g.');
  });

  it('nudges weak-but-present elements without a full-rewrite directive', () => {
    const r = v.validate(tree(WEAK_BUT_COMPLETE));
    const prompt = v.correctionPrompt(r);
    expect(prompt).toContain('Present but faint');
  });

  it('returns an empty prompt when the draft passes', () => {
    const r = v.validate(tree(GEMMA3_STYLE));
    expect(v.correctionPrompt(r)).toBe('');
  });
});

// ─── 5. Salvage mode + grammarGate telemetry ────────────────────────────────

describe('StoryAuthorService — salvage mode + grammarGate telemetry', () => {
  it('salvages a complete-but-weak real draft instead of template fallback', async () => {
    const svc = new StoryAuthorService();
    const weak = { ...tree(WEAK_BUT_COMPLETE), title: 'Weak But Real' };
    const result = await svc.author(baseInput(), {
      chatOverride: chatReturning(JSON.stringify(weak)),
      safetyOverride: PERMISSIVE_SAFETY,
      maxLlmRetries: 1,
      skipQualityGate: true,
    });
    expect(result.title).toBe('Weak But Real'); // the real draft shipped
    expect(result.meta?.template_fallback).toBeFalsy();
    expect(result.meta?.grammarGate?.salvaged).toBe(true);
    expect(result.meta?.grammarGate?.passed).toBe(false);
    expect(result.meta?.grammarGate?.elementScores.setting).toBeGreaterThan(0);
    expect(result.meta?.grammar_retries).toBeGreaterThan(0);
  });

  it('does NOT salvage a draft with a hard-missing element — template fallback fires', async () => {
    const svc = new StoryAuthorService();
    const broken = tree(HARD_BROKEN);
    const result = await svc.author(baseInput(), {
      chatOverride: chatReturning(JSON.stringify(broken)),
      safetyOverride: PERMISSIVE_SAFETY,
      maxLlmRetries: 1,
      skipQualityGate: true,
    });
    expect(result.meta?.template_fallback).toBe(true);
    expect(result.meta?.grammarGate?.salvaged).toBe(false);
  });

  it('records grammarGate passed + not salvaged on the happy path', async () => {
    const svc = new StoryAuthorService();
    const good = { ...tree(GEMMA3_STYLE), title: 'Clean Pass' };
    const result = await svc.author(baseInput(), {
      chatOverride: chatReturning(JSON.stringify(good)),
      safetyOverride: PERMISSIVE_SAFETY,
      maxLlmRetries: 1,
      skipQualityGate: true,
    });
    expect(result.title).toBe('Clean Pass');
    expect(result.meta?.grammarGate?.passed).toBe(true);
    expect(result.meta?.grammarGate?.salvaged).toBe(false);
    expect(result.meta?.grammarGate?.avgScore).toBeGreaterThanOrEqual(GRAMMAR_PASS_AVG);
  });
});

// ─── 6. Pipeline surfaces the telemetry ─────────────────────────────────────

describe('WorkshopBookPipeline — surfaces grammarGate', () => {
  it('PipelineResult.grammarGate mirrors tree.meta.grammarGate (template path)', async () => {
    const draftsIdb = new IdbKeyValueStore<WorkshopDraft>(
      `grammar-gate-${crypto.randomUUID()}`,
      'drafts',
    );
    const drafts = new WorkshopDraftStore({ idb: draftsIdb });
    __TEST_resetKidProfileStore();
    const kids = getKidProfileStore();
    await kids.__TEST_clear();
    const kid = await kids.create({ name: 'Eli', birthdayIso: '2021-01-01' });
    const draft = await drafts.create({ kidId: kid.kidId });
    const orch = new WorkshopOrchestrator(drafts, draft);

    await orch.advance(); // kid-picker → s1
    await orch.saveOutput('s1', {
      theme: 'bedtime',
      occasion: 'just-because',
      lengthTier: 'bedtime',
      targetSpreads: 8,
      ehriPhase: 'partial-alphabetic',
    });
    await orch.advance();
    await orch.saveOutput('s2', { pillarId: 'pillar-mvp-1' });
    await orch.advance();
    await orch.saveOutput('s3', { dedicationText: 'Stay curious, Eli.' });
    await orch.advance();
    await orch.saveOutput('s4', {
      heroName: 'Eli',
      sidekickSettlerId: 'ada',
      supportingCast: [],
      localeBiome: 'forest',
    });
    await orch.advance();
    await orch.saveOutput('s5', {
      artStyle: 'octopath-hd2d',
      easierReadingMode: false,
      dialogicPromptsEnabled: true,
    });
    await orch.advance();

    const result = await runWorkshopPipeline(orch.draft, { forceTemplate: true });
    expect(result.grammarGate).toBeDefined();
    expect(result.grammarGate).toEqual(result.tree.meta?.grammarGate);
    expect(result.grammarGate?.salvaged).toBe(false); // template path is never a salvage
  });
});
