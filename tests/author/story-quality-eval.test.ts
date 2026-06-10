// tests/author/story-quality-eval.test.ts
//
// LIVE prose-quality eval harness. SKIPPED by default in CI — enable with:
//
//   STORY_EVAL=1 pnpm exec vitest run tests/author/story-quality-eval.test.ts
//
// Requires a local Ollama (`ollama serve`) with the eval model pulled
// (default llama3.1:8b — override via STORY_EVAL_MODEL / OLLAMA_URL).
//
// Generates N=3 stories across age bands / themes through the REAL
// StoryAuthorService pipeline (including its post-gen quality gate and
// best-of-2 regeneration), then scores the final trees with the pure-function
// rubric and prints the full reports for operator inspection.

import { describe, expect, it } from 'vitest';

import {
  StoryAuthorService,
  type KidsContentSafetyLike,
} from '$lib/services/author/StoryAuthorService';
import { scoreSceneTree } from '$lib/services/author/StoryQualityScorer';
import type { ChatRequest, ChatResponse } from '$lib/kernel-contracts/helpers/llr-fallback';
import type { StoryInput } from '$lib/services/author/types';

const STORY_EVAL = process.env.STORY_EVAL === '1';
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.STORY_EVAL_MODEL ?? 'llama3.1:8b';
const PER_STORY_TIMEOUT_MS = 600_000;

const PERMISSIVE_SAFETY: KidsContentSafetyLike = {
  async scan() {
    return { passed: true, categories: [], confidence: 0 };
  },
};

/** Direct Ollama chat bridge (vitest has no WebGPU; kernel not booted). */
async function ollamaChat(req: ChatRequest): Promise<ChatResponse> {
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: (req as { messages: Array<{ role: string; content: string }> }).messages,
      stream: false,
      format: 'json',
      options: { temperature: 0.8, num_predict: 8192 },
    }),
  });
  if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { message?: { content?: string } };
  return { content: data.message?.content ?? '' } as unknown as ChatResponse;
}

const CASES: Array<{ name: string; input: StoryInput }> = [
  {
    name: 'toddler / bedtime / meadow',
    input: {
      kidName: 'Mira',
      ageBand: 'toddler',
      ehriPhase: 'pre-alphabetic',
      theme: 'bedtime',
      occasion: 'just-because',
      sidekickSettlerId: 'sidekick-1',
      supportingCast: [],
      localeBiome: 'meadow',
      targetSpreads: 16,
      dedicationText: '',
      dialogicPromptsEnabled: false,
      easierReadingMode: false,
    },
  },
  {
    name: 'preschool / overcoming-fear / forest',
    input: {
      kidName: 'Theo',
      ageBand: 'preschool',
      ehriPhase: 'partial-alphabetic',
      theme: 'overcoming-fear',
      occasion: 'birthday',
      sidekickSettlerId: 'sidekick-2',
      supportingCast: [],
      localeBiome: 'forest',
      targetSpreads: 16,
      dedicationText: '',
      dialogicPromptsEnabled: false,
      easierReadingMode: false,
    },
  },
  {
    name: 'grade-school / silly-quest / seaside',
    input: {
      kidName: 'Nova',
      ageBand: 'grade-school',
      ehriPhase: 'full-alphabetic',
      theme: 'silly-quest',
      occasion: 'gift',
      sidekickSettlerId: 'sidekick-3',
      supportingCast: [],
      localeBiome: 'seaside',
      targetSpreads: 16,
      dedicationText: '',
      dialogicPromptsEnabled: false,
      easierReadingMode: false,
    },
  },
];

describe.runIf(STORY_EVAL)('story quality eval — live Ollama (STORY_EVAL=1)', () => {
  const results: Array<{ name: string; total: number; fallback: boolean }> = [];

  for (const c of CASES) {
    it(
      `generates + scores: ${c.name}`,
      async () => {
        const svc = new StoryAuthorService();
        const tree = await svc.author(c.input, {
          chatOverride: ollamaChat,
          safetyOverride: PERMISSIVE_SAFETY,
        });

        // Structural validity always holds (fallback guarantees it).
        expect(tree.beats.length).toBe(7);
        const total = tree.beats.reduce(
          (s, b) => s + b.scenes.reduce((bs, sc) => bs + sc.spreads.length, 0),
          0,
        );
        expect(total).toBe(c.input.targetSpreads);

        const fallback = tree.meta?.template_fallback === true;
        const report = scoreSceneTree(tree, {
          ageBand: c.input.ageBand,
          theme: c.input.theme,
        });
        results.push({ name: c.name, total: report.total, fallback });

        // Operator-facing dump: full rubric breakdown + meta counters.
        // eslint-disable-next-line no-console
        console.log(
          `\n=== STORY_EVAL ${c.name} ===\n` +
            `title: ${tree.title}\n` +
            `fallback: ${fallback}  quality_regenerated: ${tree.meta?.quality_regenerated ?? false}\n` +
            `meta.quality_score: ${tree.meta?.quality_score}\n` +
            `rubric: ${JSON.stringify(report.metrics, null, 2)}\n` +
            `total: ${report.total}\n` +
            `feedback:\n${report.feedback.map((f) => `  - ${f}`).join('\n') || '  (none)'}\n`,
        );

        expect(tree.meta?.quality_score).toBeTypeOf('number');
        // Soft floor for live LLM output (post best-of-2). Template fallback
        // scores higher by construction, so only assert on real-LLM trees.
        if (!fallback) {
          expect(report.total).toBeGreaterThanOrEqual(40);
        }
      },
      PER_STORY_TIMEOUT_MS,
    );
  }

  it('at least 2 of 3 stories came from the live model (not template fallback)', () => {
    const live = results.filter((r) => !r.fallback).length;
    // eslint-disable-next-line no-console
    console.log(`STORY_EVAL summary: ${JSON.stringify(results, null, 2)}`);
    expect(live).toBeGreaterThanOrEqual(2);
  });
});

// Keep the file from being an empty suite when the gate is off.
describe.runIf(!STORY_EVAL)('story quality eval — gated off', () => {
  it('is skipped unless STORY_EVAL=1 (live Ollama harness)', () => {
    expect(STORY_EVAL).toBe(false);
  });
});
