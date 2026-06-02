// @graph-layer: infrastructure
// @rationale: infrastructure (kernel — layer-agnostic primitive: supervisor/ports/WAL/effects)

// src/kernel/purpose/PurposeTypes.ts
/**
 * Purpose-based policy types. Inspired by Palantir's "purpose-based policies"
 * — an action's allowed scope depends on WHY it's happening, not just who's
 * making it.
 */

export type Purpose =
  | 'tip_drafting'
  | 'recipe_matching'
  | 'agent_prediction'
  | 'fact_extraction'
  | 'banter_generation'
  | 'observer_question'
  | 'prior_update'
  | 'claw_ingest'
  | 'tournament_judging'
  | 'skill_match'
  | 'recipe_publish'
  | 'asset_recipe_publish'
  | 'brick_recipe_publish'
  | 'ascii_video_publish'
  | 'tip_publish'
  | 'tip_consume'
  | 'free_text_input'
  | 'voice_answer'
  | 'confession_submit'
  | 'agent_prompt'
  | 'memory_compact'
  | 'memory_consolidate'
  | 'image_embed'
  | 'text_embed'
  | 'world_item_mint'
  | 'cross_world_hop'
  | 'knowledge_publish'
  | 'reaction_reward'
  | 'unspecified';

export type DataCategory =
  | 'pii.name'
  | 'pii.address'
  | 'pii.email'
  | 'pii.phone'
  | 'pii.account'
  | 'pii.secret'
  | 'pii.url'
  | 'pii.date'
  | 'agent.priors'
  | 'agent.memory.private'
  | 'agent.memory.shared'
  | 'recipe.draft'
  | 'recipe.published'
  | 'tournament.judging'
  | 'commune.banter';

export interface PurposeScope {
  purpose: Purpose;
  /** Categories the call is allowed to TOUCH (read or write). */
  allowedDataCategories: DataCategory[];
  /** Hard cap on bytes returned. Undefined = no cap. */
  maxOutputBytes?: number;
  /** When true, every output passes PrivacyFilter before leaving. */
  requiresPrivacyGate: boolean;
  /** Lifetime of a granted scope in ms. Undefined = single use. */
  ttlMs?: number;
  /** Human-readable description for /debug/purpose. */
  description: string;
}

export interface PolicyDecision {
  allowed: boolean;
  purpose: Purpose;
  capability: string;
  /** Categories that triggered an allow/deny. */
  matchedCategories: DataCategory[];
  reason: string;
  /** When allowed, the scope to apply (e.g., privacy-gate caller, byte cap). */
  scope?: PurposeScope;
}

export interface PolicyCheckInput {
  purpose: Purpose;
  capability: string;
  agentId?: string;
  dataCategories: DataCategory[];
  estimatedOutputBytes?: number;
}
