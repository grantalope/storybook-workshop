// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

import { defineContract, type CapabilityContract } from '$lib/kernel-contracts/types/capability';

/**
 * Inference capability contracts. These wrap the existing LLR runtime
 * (`src/lib/llr/`) and PrivacyFilterService. Adapters in
 * `src/kernel/inference/adapters/` bridge kernel calls to LLR methods.
 *
 * The kernel layer adds: typed-RPC permission scoping, shim telemetry,
 * effect dedup for outbound inference. LLR continues to own queue scheduling,
 * VRAM budgeting, and engine selection.
 */

const PRIVACY_SCRUB_CALLERS = [
  'recipe-evidence-gate',
  'tip-publish-gate',
  /^claws\..+$/,
  'free-text-input',
  'voice-answer',
  'confession-submit',
  'agent-prompt-builder',
  // IRL Quest Engine (Phase 2):
  'irl-quest-text-verifier',
  'irl-quest-settler-author',
];

export const INFERENCE_CONTRACTS: CapabilityContract[] = [
  defineContract({
    name: 'inference.generate',
    requirableBy: [
      /^agent-.+$/,
      'tournament-llm-service',
      'llm-question-factory',
      'agent-prediction-generator',
      'agent-reasoning-engine',
      'llm-fact-extractor',        // Stage 10b: first migrated service
      'voxel-sketch-planner',      // text -> BuildMetadata (AI sketch planner, in-browser LLM)
      // IRL Quest Engine (Phase 2):
      'irl-quest-text-verifier',
      'irl-quest-settler-author',
      // Stage 10g batch 1
      'action-bridge-service',
      'llm-prior-service',
      'headless-lodden-service',
      'surprise-journal-service',
      'auto-reason-loop',
      // Stage 10g batch 2
      'spark-decision-engine',
      'agent-behaviour-service',
      'dead-reckoning-service',
      // Stage 10h batch 3
      'answer-decomposition-service',
      'story-bit-generation-service',
      'idle-mining-service',
      'ontology-generator-service',
      'retirement-service',
      // Stage 10h batch 4
      'signal-ingester',
      'user-info-service',
      'user-estimation-service',
      'viral-question-formats-service',
      'sovereigns-council-service',
      // Stage 10h batch 5
      'simulation-report-service',
      'forensic-interview-service',
      'intent-service',
      'choice-question-service',
      'content-ingestion-service',
      // Stage 10i batch 6
      'generative-element-service',
      're-ranking-service',
      'insight-narrator-service',
      'agent-downtime-analyzer',
      'tribal-council-v2',
      // Stage 10i batch 7
      'var-agent-service',
      'insight-minting-service',
      'simulation-service',
      'bayesian-inference-service',
      'llm-question-factory',
      // Stage 10i batch 8
      'auto-play-service',
      'insight-engine-service',
      'corpus-ingestion-service',
      'dynamic-question-generation-service',
      'cognitive-worker-service',
      // Stage 10j batch 9
      'person-extractor',
      // Stage 10j batch 10
      'tag-vectorization-service',
      // Stage 10j batch 11
      'prediction-bid-service',
      // Stage 10j batch 12
      'ollama-banter',
      // Banter grounded engine (BanterService.generateForContext) — fires
      // observer-banter LLM polish for at most 2 lines per beat. Templated
      // path is the default; LLM is opt-in per beat.
      'banter-service',
      'pillar-prediction-bridge',
      'pillar-service',
      'priors-service',
      // Stage 10j batch 13
      'insight-forge-service',
      'tournament-llm-service',
      'agent-prediction-generator',
      // Stage 11 — streaming consumers + remaining services + Svelte components
      'agent-content-generator',
      'glyph-factory',
      'background-analysis-service',
      'interaction-service',
      /^component-.+$/,          // all Svelte component callers via component-* prefix
      // Stage 13 (Phase 1C) — Tier 3 deferred services
      'feed-orchestrator-service',
      // Stage 17 — load-bearing boot-order regression test caller
      'load-bearing-test',
      // Task 2 — SleepConsolidator contradict+summarize LLM calls
      'sleep-consolidator',
      // Memory v2 LLM callers (Task 4 kernel migration)
      'amem-linker',
      'compactor',
      // finish-all wave (batch A) — antipattern refactor + RLM backend + recipe polish
      'rlm-backend',
      'recipe-llm-polish',
      // Workstream C (engagement-priors-overhaul, 2026-05-04)
      'follow-up-chain-service',
      // Canonical-path consolidation (2026-05-04) — PriorElicitationEngine LLM-guided question selection
      'prior-elicitation-engine',
      // Historical Character authoring pipeline — voice-card + corpus generation.
      // In browser: routes through kernel → WebLLM/WebGPU. In Node CLI (the
      // batch script), the kernel isn't booted so CharacterAuthor falls back
      // to direct Ollama (the dev failsafe per CLAUDE.md).
      'character-author',
      // Priors overhaul (2026-05-10) — abstract synthesis layer that bridges
      // disparate observations (answers, reactions, engagement, lexicon) into
      // 1-3 propositions per IDLE-window run, each with multi-axis trait
      // deltas + Layer-1 fact candidates. One LLM call per run.
      'abstract-synthesis',
      // Priors overhaul (2026-05-10) — per-answer extractor in
      // FeedOrchestrator that turns user answers into multi-axis trait
      // deltas, fact candidates, and abstraction seeds. One gated LLM call
      // per answer (regex/length/denylist gate skips trivial cases).
      'feed-extractor',
      // Abstract priors (2026-05-16) — per-answer Layer-2 abstraction
      // extractor (breed/type/lifestyle/etc inferences grounded on
      // Layer-1 facts). Sibling to llm-fact-extractor at the answer tier,
      // writes to GeneralPriorStore. One gated LLM call per answer.
      'abstract-prior-extractor',
      // Abstract priors (2026-05-16) — direct probe generator. When an
      // L1 fact has no related L2 abstractions, generates a 3-option
      // multiple-choice probe (e.g. "what breed is your dog?") so the
      // user's choice resolves the abstraction with high confidence.
      // 24h per-fact cooldown.
      'abstraction-probe',
      // Settler Inner Life (2026-05-12) — the per-settler idle-priority loop
      // that powers diaries, dreams, hobby progress, philosophy drift, etc.
      // Spec: docs/superpowers/specs/2026-05-12-settler-inner-life-design.md.
      'inner-life-loop',
      // Feed Addiction Pillar A3 (2026-05-16) — settler-driven skill pitches.
      // Composes a 1-sentence in-character pitch when a settler's posterior
      // theta matches a SkillMarketplace entry with score >0.7. Capped
      // 1/day/settler.
      'settler-skill-pitch-producer',
      // Feed Addiction Pillar E (2026-05-16) — user-pitched quest composer
      // → QuestSpec → settler bidding. Decomposes a free-text quest pitch
      // into structured QuestBeats via one gated LLM call.
      'quest-pitch-composer',
      // Feed Addiction Pillar G (2026-05-16) — local settler DMs. Composes
      // in-character replies to user messages. Capped 1/day/settler +
      // 5/day total.
      'settler-dm-service',
      // Feed-fun round 3 Ship 1 (2026-05-17) — turns AgentReaction stance
      // (disagree/concede) into its own threaded feed card addressed to
      // the prior reactor. 1.2s LLM timeout, deterministic template
      // fallback, idempotent id `disagree-${parentCardId}-${reactorId}`.
      'disagreement-card-emitter',
    ],
    methods: [
      {
        name: 'chat',
        transferMode: 'clone',
        assertions: {
          precondition: (args) => {
            const [req] = args as [{ messages?: unknown }];
            if (!req || typeof req !== 'object') return 'req must be object';
            if (!Array.isArray(req.messages) || req.messages.length === 0)
              return 'req.messages must be non-empty array';
            return true;
          },
          postcondition: (result) => {
            const r = result as { content?: unknown };
            if (!r || typeof r.content !== 'string') return 'result.content must be string';
            return true;
          },
        },
      },
      {
        name: 'chatStream',
        transferMode: 'clone',
        isStream: true,
        assertions: {
          // Same precondition as chat. No postcondition: stream return; per-chunk
          // validation belongs in iter*-stream layer, not here.
          precondition: (args) => {
            const [req] = args as [{ messages?: unknown }];
            if (!req || typeof req !== 'object') return 'req must be object';
            if (!Array.isArray(req.messages) || req.messages.length === 0)
              return 'req.messages must be non-empty array';
            return true;
          },
        },
      },
    ],
    rationale: 'Text generation. Delegates to LLR llm.chat/chatStream. LLR owns priority queue + VRAM budget.',
  }),
  defineContract({
    name: 'inference.embed',
    requirableBy: [
      /^agent-.+$/,
      'recipe-vector-search',
      'memory-store',
      'taste-pipeline',
      'local-embedding-store',
      // Stage 10i embedding batch 1
      'voice-response-scorer',
      'refinement-service',
      'question-nft-service',
      // Stage 10j batch 9
      'local-data-registry',
      'wave-function-composer',
      'story-elements-service',
      'telemetry-collection-service',
      // Stage 10j batch 10
      'tag-vectorization-service',
      'semantic-answer-memory-service',
      'real-time-conversation-engine',
      'persona-synthesis-service',
      'retrieval-augmented-prediction',
      // Stage 10j batch 11
      'semantic-analysis-service',
      'qa-embedding-store',
      'lodden-answer-to-vector',
      'pillar-embedding-service',
      'prediction-bid-service',
      // Stage 10j batch 12
      'pillar-prediction-bridge',
      'pillar-calibration-service',
      'pillar-service',
      'priors-service',
      // Stage 10j batch 13
      'insight-forge-service',
      'agent-prediction-generator',
      'lodden-bounty-core',
      // Stage 11 — additional embedding callers
      'agent-content-generator',
      /^component-.+$/,          // Svelte components via component-* prefix
      // Stage 13 (Phase 1C) — Tier 3 deferred services
      'feed-orchestrator-service',
      // finish-all wave (batch A) — chat-only callers extended to embed
      'downtime-adventure-service',
      'choice-question-service',
      'content-ingestion-service',
      'corpus-ingestion-service',
      'cognitive-worker-service',
      'insight-engine-service',
      'answer-decomposition-service',
      'bayesian-inference-service',
      'user-info-service',
      'generative-element-service',
      // Workstream C (engagement-priors-overhaul, 2026-05-04) — embed origin
      // card text for cosine-similarity boost on next-question scoring.
      'question-selection-orchestrator',
      // Quest Recipes Library — story-recipe completion matchers (photo-similarity
      // criterion embeds targetDescription on demand for cosine compare).
      'criterion-extensions',
      // Settler Inner Life (2026-05-12) — CuriosityRabbithole activity embeds
      // the current topic to multi-hop query the LightRAG memory graph.
      'inner-life-loop',
      // 2026-05-20 (feat/strengthen-openquestion-affinity) — bidAdjustment's
      // openQuestionAffinity component cosine-matches the framing text
      // against the settler's open-question bodies via this route.
      'inner-life-economy-adapter',
      // Storybook Workshop (2026-05-24, goal #3 story-author) — single LLM
      // call per book in StoryAuthorService.author(); generates a Pixar 7-beat
      // scene tree under Stein-Glenn + Brown + Beck-McKeown + Ehri constraints
      // baked into the system prompt. Sibling callers reserved for future
      // sub-pipelines: -vocab (any future vocab-only LLM pass) and -prompts
      // (LLM-generated dialogic prompts if split out of the main author call).
      'storybook-workshop-author',
      'storybook-workshop-vocab',
      'storybook-workshop-prompts',
      // 2026-05-21 wire-amem-linker (FUP-1) — AmemLinker.embedFn for Zettelkasten
      // KNN linking. Already in inference.generate for ollamaKeywordsFn; embed
      // route is needed for linkNow() to compute the note embedding before KNN.
      'amem-linker',
      // 2026-05-21 cw-phase-d-semantic-fingerprints — Cross-world content-addressed
      // bucket signature derived from a pillar-embedding via LSH random-projection.
      // The fingerprint is a coarse 32-bit LSH bucket id; raw embedding never
      // crosses the wire. See SemanticFingerprint.ts.
      'semantic-fingerprint-service',
      // 2026-05-21 fix-asset-recipe-embed-shape — AssetRecipeRegistryService.
      // resolveQueryEmbedding routes semanticSearch query text through the
      // kernel; pre-allowlist the connect() rejected and the path always
      // returned [] (caught by codex on the loop-10 wiring).
      'asset-recipe-registry',
    ],
    methods: [
      {
        name: 'embed',
        transferMode: 'clone',
        assertions: {
          precondition: (args) => {
            const [req] = args as [{ input?: unknown }];
            if (!req || typeof req.input !== 'string' || req.input.length === 0)
              return 'embed.input must be non-empty string';
            return true;
          },
          postcondition: (result) => {
            const vector = result instanceof Float32Array || Array.isArray(result)
              ? result
              : (result as { vector?: { length?: number } })?.vector;
            if (!vector || typeof vector.length !== 'number')
              return 'result must be an array-like vector or { vector }';
            if (vector.length === 0) return 'result.vector is empty';
            // Don't assert exact dim; LLR may switch models. Asserting >0 catches the silent-failure case.
            return true;
          },
        },
      },
    ],
    rationale: 'Text embedding. Delegates to LLR embedding.embed. Returns Float32Array; clone is cheap for single vectors.',
  }),
  defineContract({
    name: 'inference.embed-image',
    requirableBy: [
      /^agent-.+$/,
      'recipe-vector-search',
      'image-tagger',
      // Action-triggered photo capture claw (PhotoCaptureClaw.capture()).
      'photo-capture-claw',
      // IRL Quest Engine (Phase 2):
      'irl-quest-publish',
      'irl-quest-photo-verifier',
      'irl-quest-constraint-verifier',
    ],
    methods: [
      {
        name: 'embedImage',
        transferMode: 'clone',
        assertions: {
          precondition: (args) => {
            const [req] = args as [{ image?: unknown }];
            if (!req || !req.image) return 'embedImage.image must be present';
            return true;
          },
          postcondition: (result) => {
            const vector = result instanceof Float32Array || Array.isArray(result)
              ? result
              : (result as { vector?: { length?: number } })?.vector;
            if (!vector || typeof vector.length !== 'number')
              return 'result must be an array-like vector or { vector }';
            if (vector.length === 0) return 'result.vector is empty';
            return true;
          },
        },
      },
    ],
    rationale: 'Image embedding. Delegates to LLR embedding.embedImage.',
  }),
  defineContract({
    name: 'inference.embed-audio',
    requirableBy: [
      /^agent-.+$/,
      // IRL Quest Engine (Phase 2):
      'irl-quest-publish',
      'irl-quest-sound-verifier',
    ],
    methods: [
      {
        name: 'embedAudio',
        transferMode: 'clone',
        assertions: {
          precondition: (args) => {
            const [req] = args as [{ audio?: unknown }];
            if (!req || !req.audio) return 'embedAudio.audio must be present';
            return true;
          },
          postcondition: (result) => {
            const vector = result instanceof Float32Array || Array.isArray(result)
              ? result
              : (result as { vector?: { length?: number } })?.vector;
            if (!vector || typeof vector.length !== 'number')
              return 'result must be an array-like vector or { vector }';
            if (vector.length === 0) return 'result.vector is empty';
            return true;
          },
        },
      },
    ],
    rationale: 'Audio embedding (CLAP-style). Distinct model + resource budget from inference.embed-image. Used by IRL Quest sound verifier.',
  }),
  defineContract({
    name: 'inference.privacy-scrub',
    requirableBy: PRIVACY_SCRUB_CALLERS,
    methods: [
      {
        name: 'scrub',
        transferMode: 'clone',
        assertions: {
          precondition: (args) => {
            const [text] = args as [unknown];
            if (typeof text !== 'string') return 'scrub.text must be string';
            return true;
          },
          postcondition: (result) => {
            const r = result as { scrubbed?: unknown; report?: unknown };
            if (!r || typeof r.scrubbed !== 'string') return 'result.scrubbed must be string';
            if (!r.report) return 'result.report must be present';
            return true;
          },
        },
      },
    ],
    rationale: 'PII scrubbing. Delegates to PrivacyFilterService.scrub. Hard gate at 5 enforcement points (recipe-native engagement spec §6).',
  }),
];
