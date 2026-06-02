// @graph-layer: private
// @rationale: private (per-user / per-settler state — never leaves device by default)

/**
 * EmotionalEffectMap.ts — Per-beat default emotional-typography effect.
 *
 * Defaults from spec §7.5:
 *   Setup       → flow          (calm)
 *   Catalyst    → bounce-in     (something arrives)
 *   Debate      → wave          (uncertainty)
 *   Midpoint    → magnetic      (world pulls together)
 *   Trial       → glitch        (conflict)
 *   Climax      → dragon        (peak — alt: vortex)
 *   Resolution  → rise          (release)
 *
 * The Catalyst beat is described as "bounce" in the spec; the
 * `PretextEffectEngine` literal is `'bounce-in'`. We use the engine literal.
 *
 * Advanced Mode (spec §7.6) lets the parent override per-beat effects. The
 * override mechanism is `overrideEffect()` — pass a partial map of explicit
 * choices and get a per-beat resolved array back.
 */

import type { BeatId, EmotionalEffect } from './types';
import { BEAT_IDS } from './types';

/** Spec §7.5 default mapping. */
export const DEFAULT_EFFECT_MAP: Readonly<Record<BeatId, EmotionalEffect>> = Object.freeze({
  setup: 'flow',
  catalyst: 'bounce-in',
  debate: 'wave',
  midpoint: 'magnetic',
  trial: 'glitch',
  climax: 'dragon',
  resolution: 'rise',
});

/** Alternative climax effect documented in spec §7.5. */
export const CLIMAX_ALT: EmotionalEffect = 'vortex';

/**
 * Return the spec-default emotional effect for `beatId`. Throws if `beatId`
 * isn't a recognized Pixar beat — refuse to silently fall through to an
 * arbitrary default because that masks story-authoring bugs.
 */
export function getDefaultEffect(beatId: BeatId): EmotionalEffect {
  const effect = DEFAULT_EFFECT_MAP[beatId];
  if (!effect) {
    throw new Error(`EmotionalEffectMap: unknown beatId "${beatId as string}"`);
  }
  return effect;
}

/**
 * Resolve the full 7-beat effect array given an optional override map.
 * Missing keys in `override` fall back to spec defaults.
 *
 * Returned array is ordered to match `BEAT_IDS`.
 */
export function overrideEffect(
  override: Partial<Record<BeatId, EmotionalEffect>> = {},
): EmotionalEffect[] {
  return BEAT_IDS.map(id => override[id] ?? DEFAULT_EFFECT_MAP[id]);
}

/**
 * Same as `overrideEffect` but returns a `Record<BeatId, EmotionalEffect>` —
 * caller-friendly when you want by-key lookup, not positional.
 */
export function resolveEffectMap(
  override: Partial<Record<BeatId, EmotionalEffect>> = {},
): Record<BeatId, EmotionalEffect> {
  const out = {} as Record<BeatId, EmotionalEffect>;
  for (const id of BEAT_IDS) {
    out[id] = override[id] ?? DEFAULT_EFFECT_MAP[id];
  }
  return out;
}
