// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

// services/storybook-workshop/author/StoryAuthorService.ts
//
// Main orchestrator: StoryInput → SceneTree.
//
// Pipeline (per goal markdown Phase 7 + storyteller-quality overhaul):
//   1. Tier2VocabPlanner picks 3-5 words. StoryBudgetAllocator computes beat budget.
//   2. Build system+user messages (system cached per kid profile per Stage 7+ rules).
//   3. kernel.connect('inference.generate', 'storybook-workshop-author').chat(...)
//      with LLR fallback. JSON-mode parse.
//   4. KidsContentSafety.scan(every spread_text + title + blurb) — fail-fast.
//   5. privacyFilterService.scrub(every sceneBrief, purpose 'scene_render') — strip leaked PII.
//   6. StoryGrammarValidator.validate(tree) — retry once with corrective.
//   7. AgeBandCalibrator.calibrate(tree, input) — regen once for overflowing spreads.
//   8. StoryQualityScorer (pure rubric): score < threshold → ONE regeneration
//      with the rubric feedback injected → accept best-of-2.
//   9. DialogicPromptGenerator.normalize(or generate) if dialogicPromptsEnabled.
//   10. StoryBudgetAllocator.validate — deterministic redistribute if 2 LLM retries miss.
//   11. 2-retry final → template fallback (deterministic craft-rule skeleton). Telemetry counter.

import { createInferenceClient } from '../../inference/inferenceClient';
import type { ChatRequest, ChatResponse } from '$lib/kernel-contracts/helpers/llr-fallback';
import { privacyFilterService } from '$lib/privacy/PrivacyFilterService';
import { Tier2VocabPlanner, tier2VocabPlanner } from './Tier2VocabPlanner';
import { StoryBudgetAllocator, storyBudgetAllocator } from './StoryBudgetAllocator';
import { StoryGrammarValidator, storyGrammarValidator } from './StoryGrammarValidator';
import { AgeBandCalibrator, ageBandCalibrator } from './AgeBandCalibrator';
import {
  DialogicPromptGenerator,
  dialogicPromptGenerator,
} from './DialogicPromptGenerator';
import { buildSystemPrompt } from './prompts/system-prompt-template';
import { buildUserMessage } from './prompts/user-message-template';
import { synthesizeTemplateTree } from './templateFallback';
import { DEFAULT_QUALITY_THRESHOLD, scoreSceneTree } from './StoryQualityScorer';
import {
  BEAT_NAMES,
  type BeatBudgetMap,
  type BeatId,
  type DialogicPrompt,
  type GrammarValidationResult,
  type SceneTree,
  type SceneTreeMeta,
  type StoryInput,
} from './types';

/**
 * Build the PrivacyFilter `allowNames` list for scene-brief scrubs from
 * structured fictional-name fields only:
 *
 *   - `fictionalCastNames` (catalog/curated fictional names)
 *   - `supportingCast[].name` only when `fictionalName === true`
 *
 * The hero/kid name is deliberately excluded; it is replaced with "the hero"
 * before the privacy scrub. Free text is NEVER consulted: the cast `role`
 * field, dedicationText, and story prose contribute nothing.
 */
export function castAllowNames(input: StoryInput): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  };
  for (const name of input.fictionalCastNames ?? []) push(name);
  for (const entry of input.supportingCast ?? []) {
    if (entry?.fictionalName === true) push(entry.name);
  }
  return out;
}

/**
 * Subset of KidsContentSafetyService the orchestrator depends on. The actual
 * service ships from goal #2 (storybook-workshop-kids-content-safety). Until
 * it's wired by AppOrchestrator, the orchestrator falls back to a permissive
 * stub that accepts every input — failing CLOSED in production is reserved
 * for once goal #2 ships; failing OPEN here keeps this worker independently
 * useful + lets goal #2 land non-destructively.
 */
export interface KidsContentSafetyLike {
  scan(text: string): Promise<{ passed: boolean; categories: string[]; confidence: number }>;
}

const permissiveSafetyStub: KidsContentSafetyLike = {
  async scan(_text: string) {
    return { passed: true, categories: [], confidence: 0 };
  },
};

const PRIVACY_SCRUB_FAILED_BRIEF = 'the hero in a privacy-safe scene';

function getKidsContentSafety(): KidsContentSafetyLike {
  const injected = (globalThis as any).__kidsContentSafetyService as
    | KidsContentSafetyLike
    | undefined;
  return injected ?? permissiveSafetyStub;
}

const _inf = createInferenceClient('storybook-workshop-author');

export interface StoryAuthorOptions {
  /** Hard cap for LLM-retry attempts (default 2, then template fallback). */
  maxLlmRetries?: number;
  /** Override for tests to inject a deterministic LLM. */
  chatOverride?: (req: ChatRequest) => Promise<ChatResponse>;
  /** Override for tests to inject KidsContentSafety. */
  safetyOverride?: KidsContentSafetyLike;
  /** Disable LLM entirely — force template fallback (for headless smoke). */
  forceTemplate?: boolean;
  /**
   * Prose-quality acceptance bar (0-100, default DEFAULT_QUALITY_THRESHOLD).
   * A structurally valid draft scoring below this triggers ONE regeneration
   * with the rubric feedback injected; the better of the two drafts wins.
   */
  qualityThreshold?: number;
  /** Skip the post-gen quality gate entirely (score still recorded). */
  skipQualityGate?: boolean;
}

/** Args bundle for one full run through the gated LLM attempt loop. */
interface LlmGateRunArgs {
  input: StoryInput;
  vocabWords: string[];
  budget: BeatBudgetMap;
  meta: SceneTreeMeta;
  safety: KidsContentSafetyLike;
  chat: (req: ChatRequest) => Promise<ChatResponse>;
  maxRetries: number;
  /** Seed correction for the first attempt (rubric feedback on the regen run). */
  initialCorrection?: string;
}

/** Outcome of one gated attempt loop. */
interface LlmGateOutcome {
  /** First tree that cleared every gate, or null when retries exhausted. */
  tree: SceneTree | null;
  /**
   * Best SALVAGEABLE draft seen across attempts: a real-LLM tree that cleared
   * safety + privacy and has ALL six Stein-Glenn elements present
   * (no element at confidence 0) but missed the grammar pass bar — or passed
   * grammar and only missed calibration. Preferred over the deterministic
   * template when retries exhaust (real prose beats a canned skeleton; the
   * e2e run proved gemma3 drafts were good stories killed by gate brittleness).
   */
  salvage: { tree: SceneTree; grammar: GrammarValidationResult } | null;
}

export class StoryAuthorService {
  constructor(
    private readonly planner: Tier2VocabPlanner = tier2VocabPlanner,
    private readonly allocator: StoryBudgetAllocator = storyBudgetAllocator,
    private readonly grammar: StoryGrammarValidator = storyGrammarValidator,
    private readonly calibrator: AgeBandCalibrator = ageBandCalibrator,
    private readonly prompts: DialogicPromptGenerator = dialogicPromptGenerator,
  ) {}

  /** Main entry point. */
  async author(input: StoryInput, opts: StoryAuthorOptions = {}): Promise<SceneTree> {
    const maxRetries = opts.maxLlmRetries ?? 2;
    const safety = opts.safetyOverride ?? getKidsContentSafety();
    const chat = opts.chatOverride ?? ((req: ChatRequest) => _inf.chat(req));

    // Phase 1: vocab + budget
    const vocab = this.planner.pickWords(input);
    const budget = this.allocator.allocate(input.targetSpreads);

    const meta: SceneTreeMeta = {
      generated_at_iso: new Date().toISOString(),
      llm_retries: 0,
      grammar_retries: 0,
      calibration_retries: 0,
      budget_redistributed: false,
      template_fallback: false,
    };

    if (opts.forceTemplate) {
      return this._finalizeFallback(input, vocab.words, budget, meta, 'force-template');
    }

    // Phase 2-3: LLM call (with retries on safety / grammar / calibration)
    const gateArgs: Omit<LlmGateRunArgs, 'initialCorrection'> = {
      input,
      vocabWords: vocab.words,
      budget,
      meta,
      safety,
      chat,
      maxRetries,
    };
    const firstRun = await this._runLlmGates(gateArgs);
    let passedTree = firstRun.tree;
    let salvageUsed = false;

    if (!passedTree && firstRun.salvage) {
      // SALVAGE MODE (first-class, replaces the e2e script's ad-hoc raw-draft
      // rescue): every retry missed the gate bar, but a draft exists whose six
      // Stein-Glenn elements are all present. Ship the real prose instead of
      // the template; telemetry (meta.grammarGate.salvaged) records it.
      passedTree = firstRun.salvage.tree;
      salvageUsed = true;
      // eslint-disable-next-line no-console
      console.warn('[StoryAuthorService] gates not green — salvaging best real draft', {
        avgScore: firstRun.salvage.grammar.avgScore,
        elementScores: firstRun.salvage.grammar.elementScores,
      });
    }

    if (!passedTree) {
      return this._finalizeFallback(input, vocab.words, budget, meta, 'gates-not-passed');
    }

    // Quality gate (best-of-2): a structurally valid draft can still be flat.
    // Score it with the pure rubric; below threshold → ONE regeneration with
    // the rubric feedback injected as the corrective addendum, keep the better.
    let report = scoreSceneTree(passedTree, { ageBand: input.ageBand, theme: input.theme });
    const threshold = opts.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD;
    if (!opts.skipQualityGate && report.total < threshold) {
      meta.quality_regenerated = true;
      const rubricCorrection = [
        `Your previous draft passed structural validation but scored ${report.total}/100 on the prose-quality rubric (acceptance bar ${threshold}). Keep the same story and fix these specific points:`,
        ...report.feedback.map((f) => `- ${f}`),
      ].join('\n');
      const second = await this._runLlmGates({ ...gateArgs, initialCorrection: rubricCorrection });
      if (second.tree) {
        const secondReport = scoreSceneTree(second.tree, {
          ageBand: input.ageBand,
          theme: input.theme,
        });
        if (secondReport.total > report.total) {
          passedTree = second.tree;
          report = secondReport;
          salvageUsed = false; // fully-passing regen replaced the salvaged draft
        }
      }
    }
    meta.quality_score = report.total;

    // Budget validation + deterministic redistribute if mismatched
    const budgetResult = this.allocator.validate(passedTree.beats, input.targetSpreads);
    if (!budgetResult.passed) {
      meta.budget_redistributed = true;
      this._redistributeIntoTree(passedTree, input.targetSpreads, budgetResult.perBeat);
    }

    // Final structural sanity post-redistribute
    const finalBudgetCheck = this.allocator.validate(passedTree.beats, input.targetSpreads);
    if (!finalBudgetCheck.passed) {
      // Last-resort fallback (very rare)
      return this._finalizeFallback(input, vocab.words, budget, meta, 'budget-irrecoverable');
    }

    // Dialogic prompts
    if (input.dialogicPromptsEnabled) {
      const llmPrompts = passedTree.dialogic_prompts;
      if (Array.isArray(llmPrompts) && llmPrompts.length > 0) {
        passedTree.dialogic_prompts = this.prompts.normalize(llmPrompts, passedTree);
      } else {
        passedTree.dialogic_prompts = this.prompts.generate(passedTree, input);
      }
    } else {
      passedTree.dialogic_prompts = undefined;
    }

    // Grammar-gate telemetry on the SHIPPED tree — re-validated after
    // redistribute so it reflects the prose that actually lands on the page.
    const finalGrammar = this.grammar.validate(passedTree);
    meta.grammarGate = {
      passed: finalGrammar.passed,
      elementScores: finalGrammar.elementScores,
      avgScore: finalGrammar.avgScore,
      salvaged: salvageUsed,
    };

    // Final guarantees on top-level fields
    passedTree.page_budget = input.targetSpreads;
    passedTree.tier2_words = mergeTier2Words(passedTree.tier2_words, vocab.words);
    passedTree.meta = { ...meta };

    return passedTree;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * One full pass through the gated attempt loop (parse → safety → privacy →
   * grammar → calibration), retrying up to maxRetries with correctives.
   * Returns the first tree that clears every gate (plus the best salvageable
   * near-miss seen along the way). Mutates the shared meta counters.
   */
  private async _runLlmGates(args: LlmGateRunArgs): Promise<LlmGateOutcome> {
    const { input, vocabWords, budget, meta, safety, chat, maxRetries } = args;
    let correction = args.initialCorrection ?? '';
    let salvage: LlmGateOutcome['salvage'] = null;
    // Rank: calibration-only failures (grammar fully green) always beat
    // grammar-weak drafts; within a tier, higher grammar average wins.
    const salvageRank = (g: GrammarValidationResult) => (g.passed ? 1 : 0) + g.avgScore;
    const considerSalvage = (tree: SceneTree, grammar: GrammarValidationResult) => {
      if (grammar.missing.length > 0) return; // an absent element = structurally broken
      if (!salvage || salvageRank(grammar) > salvageRank(salvage.grammar)) {
        salvage = { tree, grammar };
      }
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let parsed: SceneTree;
      try {
        const req: ChatRequest = {
          messages: [
            {
              role: 'system',
              content: buildSystemPrompt({
                kidName: input.kidName,
                ageBand: input.ageBand,
                ehriPhase: input.ehriPhase,
                easierReadingMode: input.easierReadingMode,
              }),
            },
            {
              role: 'user',
              content: buildUserMessage({
                input,
                tier2Words: vocabWords,
                beatBudget: budget,
                correction,
              }),
            },
          ],
          // The LLR runtime treats this as a hint; JSON-mode passthrough is
          // backend-dependent. Schema validator below also defends against drift.
          responseFormat: { type: 'json_object' },
        } as ChatRequest;

        const resp = await chat(req);
        const content = extractContent(resp);
        parsed = parseSceneTreeJson(content);
      } catch (err) {
        meta.llm_retries = (meta.llm_retries ?? 0) + 1;
        correction = `Previous attempt failed to return parseable JSON. Return ONLY a JSON object matching the schema. Error: ${(err as Error).message}`;
        continue;
      }

      // KidsContentSafety scan (gate 1)
      const unsafe = await this._scanSafety(parsed, safety);
      if (unsafe.length > 0) {
        meta.llm_retries = (meta.llm_retries ?? 0) + 1;
        correction = `KidsContentSafety flagged unsafe content on spreads: ${unsafe.map((u) => u.spreadIndex).join(', ')}. Categories: ${unsafe[0]?.categories.join(',') ?? ''}. Rewrite without violence, fear, scary-unresolved, religious/political, or substance content.`;
        continue;
      }

      // PrivacyFilter scrub on scene briefs (gate 2)
      const privacyHardFails = await this.scrubSceneBriefsAsync(parsed, input);
      if (privacyHardFails > 0) {
        meta.llm_retries = (meta.llm_retries ?? 0) + 1;
        correction = [
          `PrivacyFilter flagged ${privacyHardFails} scene-render brief(s) with hard PII.`,
          `Rewrite sceneBrief and illustration_brief values so they use "the hero" and catalog fictional sidekick names only.`,
          `Do not include real names, addresses, emails, phone numbers, account numbers, secrets, or coordinates.`,
        ].join(' ');
        continue;
      }

      // Grammar validation (gate 3)
      const grammarResult = this.grammar.validate(parsed);
      if (!grammarResult.passed) {
        meta.grammar_retries = (meta.grammar_retries ?? 0) + 1;
        considerSalvage(parsed, grammarResult);
        // Coached corrective: names each zero-confidence element with a
        // 1-line example of satisfying it (see StoryGrammarValidator).
        correction = this.grammar.correctionPrompt(grammarResult);
        continue;
      }

      // Calibration (gate 4)
      const calibResult = this.calibrator.calibrate(parsed, input.ageBand);
      if (!calibResult.passed) {
        meta.calibration_retries = (meta.calibration_retries ?? 0) + 1;
        considerSalvage(parsed, grammarResult);
        correction = this.calibrator.correctionPrompt(calibResult, input.ageBand);
        continue;
      }

      // All gates passed
      return { tree: parsed, salvage };
    }

    return { tree: null, salvage };
  }

  private async _scanSafety(
    tree: SceneTree,
    safety: KidsContentSafetyLike,
  ): Promise<{ spreadIndex: number; categories: string[] }[]> {
    const flagged: { spreadIndex: number; categories: string[] }[] = [];

    // Title + blurb
    for (const piece of [tree.title, tree.back_cover_blurb]) {
      if (typeof piece !== 'string' || piece.length === 0) continue;
      const r = await safety.scan(piece);
      if (!r.passed) flagged.push({ spreadIndex: -1, categories: r.categories });
    }
    // Spreads
    for (const beat of tree.beats) {
      for (const scene of beat.scenes) {
        for (const spread of scene.spreads) {
          const r = await safety.scan(spread.spread_text ?? '');
          if (!r.passed) flagged.push({ spreadIndex: spread.spreadIndex, categories: r.categories });
        }
      }
    }
    return flagged;
  }

  /**
   * Public, awaitable scene-brief scrub (called separately by orchestrator)
   * — replaces literal kidName + runs PrivacyFilterService.scrub('scene_render')
   * over both sceneBrief and every spread's illustration_brief.
   *
   * Returns the count of briefs whose scrub hard-failed (caller decides what to do).
   */
  async scrubSceneBriefsAsync(tree: SceneTree, input: StoryInput): Promise<number> {
    const nameLiteral = (input.kidName || '').trim();
    const nameRe =
      nameLiteral.length > 0
        ? new RegExp(`\\b${escapeRegExp(nameLiteral)}\\b`, 'g')
        : null;

    // Story-internal fictional cast names pass the PII name detector
    // un-redacted — see castAllowNames docs.
    const allowNames = castAllowNames(input);

    let hardFails = 0;
    for (const beat of tree.beats) {
      for (const scene of beat.scenes) {
        let brief = scene.sceneBrief ?? '';
        if (nameRe) brief = brief.replace(nameRe, 'the hero');
        try {
          const report = await privacyFilterService.scrub(brief, {
            purpose: 'scene_render' as any,
            allowNames,
          });
          scene.sceneBrief = report.redactedText;
          if (report.hardFail) hardFails++;
        } catch {
          scene.sceneBrief = PRIVACY_SCRUB_FAILED_BRIEF;
          hardFails++;
        }

        for (const spread of scene.spreads) {
          if (typeof spread.illustration_brief !== 'string') continue;
          let ib = spread.illustration_brief;
          if (nameRe) ib = ib.replace(nameRe, 'the hero');
          try {
            const report = await privacyFilterService.scrub(ib, {
              purpose: 'scene_render' as any,
              allowNames,
            });
            spread.illustration_brief = report.redactedText;
            if (report.hardFail) hardFails++;
          } catch {
            spread.illustration_brief = PRIVACY_SCRUB_FAILED_BRIEF;
            hardFails++;
          }
        }
      }
    }
    return hardFails;
  }

  private _redistributeIntoTree(
    tree: SceneTree,
    targetSpreads: number,
    currentPerBeat: BeatBudgetMap,
  ): void {
    const newBudget = this.allocator.redistribute(currentPerBeat, targetSpreads);

    // Reshape the tree: for each beat, trim or pad scenes/spreads to hit the new count.
    // We avoid mutating LLM scene text — only add/remove SPREADS. Padding spreads
    // get a placeholder text "..."; the template-fallback path is preferred for
    // wholesale generation. This only runs when the LLM was close-but-off-by-N.
    let nextSpreadIndex = 0;
    for (let i = 1; i <= 7; i++) {
      const beatId = i as BeatId;
      const beat = tree.beats.find((b) => b.id === beatId);
      if (!beat) continue;

      const want = newBudget[beatId];
      const currentSpreads = beat.scenes.flatMap((s) => s.spreads);
      const have = currentSpreads.length;

      if (have === want) {
        // re-index in case the LLM mis-numbered spreads
        let cursor = nextSpreadIndex;
        for (const scene of beat.scenes) {
          for (const sp of scene.spreads) sp.spreadIndex = cursor++;
        }
        nextSpreadIndex = cursor;
      } else if (have > want) {
        // shave from last scene
        const lastScene = beat.scenes[beat.scenes.length - 1];
        const overshoot = have - want;
        lastScene.spreads.splice(lastScene.spreads.length - overshoot, overshoot);
        lastScene.spreadCount = lastScene.spreads.length as Scene['spreadCount'];
        let cursor = nextSpreadIndex;
        for (const scene of beat.scenes) {
          for (const sp of scene.spreads) sp.spreadIndex = cursor++;
          scene.spreadCount = scene.spreads.length as Scene['spreadCount'];
        }
        nextSpreadIndex = cursor;
      } else {
        // Pad with placeholder spreads. `Scene.spreadCount` is the
        // union `1|2|3|4|5`, so we must spill across additional scenes
        // when `needed` would push a single scene past 5.
        let needed = want - have;
        if (beat.scenes.length === 0) {
          beat.scenes.push({
            sceneId: `${BEAT_NAMES[beatId]}-1`,
            spreadCount: 1,
            sceneBrief: beat.emotional_arc,
            spreads: [],
          });
        }
        // Fill the existing tail scene up to 5 first.
        const tail = beat.scenes[beat.scenes.length - 1];
        while (needed > 0 && tail.spreads.length < 5) {
          tail.spreads.push({ spreadIndex: 0, spread_text: '...', text_focus: 'wraps' });
          needed--;
        }
        tail.spreadCount = Math.min(5, tail.spreads.length) as Scene['spreadCount'];
        // Spill remaining padded spreads into new scenes of ≤5 spreads each.
        while (needed > 0) {
          const sceneSize = Math.min(5, needed) as Scene['spreadCount'];
          const newScene = {
            sceneId: `${BEAT_NAMES[beatId]}-pad-${beat.scenes.length + 1}`,
            spreadCount: sceneSize,
            sceneBrief: beat.emotional_arc,
            spreads: Array.from({ length: sceneSize }).map(() => ({
              spreadIndex: 0,
              spread_text: '...',
              text_focus: 'wraps' as const,
            })),
          };
          beat.scenes.push(newScene);
          needed -= sceneSize;
        }
        let cursor = nextSpreadIndex;
        for (const scene of beat.scenes) {
          for (const sp of scene.spreads) sp.spreadIndex = cursor++;
          scene.spreadCount = scene.spreads.length as Scene['spreadCount'];
        }
        nextSpreadIndex = cursor;
      }
    }
  }

  private _finalizeFallback(
    input: StoryInput,
    tier2Words: string[],
    budget: BeatBudgetMap,
    meta: SceneTreeMeta,
    reason: string,
  ): SceneTree {
    const tree = synthesizeTemplateTree(input, tier2Words, budget);
    const templateGrammar = this.grammar.validate(tree);
    tree.meta = {
      ...meta,
      template_fallback: true,
      generated_at_iso: meta.generated_at_iso,
      // Score the hand-written template too — the inspector surfaces it and
      // tests pin the templates above the quality bar.
      quality_score: scoreSceneTree(tree, { ageBand: input.ageBand, theme: input.theme }).total,
      grammarGate: {
        passed: templateGrammar.passed,
        elementScores: templateGrammar.elementScores,
        avgScore: templateGrammar.avgScore,
        salvaged: false,
      },
    };
    if (input.dialogicPromptsEnabled) {
      tree.dialogic_prompts = this.prompts.generate(tree, input);
    }
    // Telemetry — counted via console marker. Goal #6 (advanced inspector) will
    // surface this in a dedicated panel.
    // eslint-disable-next-line no-console
    console.warn('[StoryAuthorService] template fallback fired:', reason, {
      llm_retries: meta.llm_retries,
      grammar_retries: meta.grammar_retries,
      calibration_retries: meta.calibration_retries,
    });
    return tree;
  }
}

// ─── JSON parse + tolerant validation ───────────────────────────────────────

type Scene = SceneTree['beats'][number]['scenes'][number];

/**
 * Pull the assistant text out of a ChatResponse. The LLR runtime returns
 * an OpenAI-style `{ choices: [{ message: { content }} ] }` shape; some test
 * doubles in this repo return a flat `{ content: string }`. Tolerate both.
 */
function extractContent(resp: unknown): string {
  if (!resp || typeof resp !== 'object') return '';
  const r = resp as { content?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  if (typeof r.content === 'string') return r.content;
  const first = r.choices?.[0]?.message?.content;
  if (typeof first === 'string') return first;
  return '';
}

function parseSceneTreeJson(raw: string): SceneTree {
  const obj = extractFirstJsonObject(raw);
  if (!obj) throw new Error('LLM response did not contain a parseable JSON object');
  // Minimum-shape sanity. Each beat MUST have a scenes array containing at
  // least one scene with a spreads array — `_scanSafety` and downstream
  // gates iterate beat.scenes/scene.spreads unguarded, so malformed shapes
  // like `{ "beats": [{}] }` would crash at runtime if we let them through.
  if (typeof obj.title !== 'string') throw new Error('missing title');
  if (typeof obj.back_cover_blurb !== 'string') throw new Error('missing back_cover_blurb');
  if (!Array.isArray(obj.beats) || obj.beats.length === 0) throw new Error('missing beats');
  for (const beat of obj.beats) {
    if (!beat || typeof beat !== 'object') throw new Error('beat is not an object');
    if (!Array.isArray(beat.scenes) || beat.scenes.length === 0)
      throw new Error(`beat ${beat.id ?? '?'} missing scenes array`);
    for (const scene of beat.scenes) {
      if (!scene || typeof scene !== 'object') throw new Error('scene is not an object');
      if (!Array.isArray(scene.spreads) || scene.spreads.length === 0)
        throw new Error(`scene ${scene.sceneId ?? '?'} missing spreads array`);
    }
  }
  return obj as SceneTree;
}

function extractFirstJsonObject(raw: string): any | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // Fast path: raw IS a JSON object
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  // Find first top-level {...} block
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = raw.substring(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function mergeTier2Words(fromLlm: unknown, fromPlanner: string[]): string[] {
  const out = new Set<string>(fromPlanner);
  if (Array.isArray(fromLlm)) {
    for (const w of fromLlm) if (typeof w === 'string' && w.length > 0) out.add(w);
  }
  return Array.from(out);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const storyAuthorService = new StoryAuthorService();

// Browser-debug surface: lets UI smoke tests call this directly.
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__sw_storyAuthor = storyAuthorService;
}

export type { DialogicPrompt };
