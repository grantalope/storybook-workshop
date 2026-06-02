// @graph-layer: join
// @rationale: join (privacy/federation/guardrail subsystem — sits on the layer boundary)

// services/privacy/scrubAgentPrompt.ts
//
// I-PRIV-01 — Gate 5 (agent_prompt) defense-in-depth scrub.
//
// CLAUDE.md §"PrivacyFilterService" documents 5 enforcement gates. The 5th —
// "agent prompt — final scrub before any LLM prompt assembled with ingredient
// context (defense in depth)" — was documented but never implemented in
// production code. The audit (`docs/prelaunch/section-02-privacy-gates.md`
// I-PRIV-01) confirmed: `LLMAuthorshipProvider.generate` and other LLM
// callers record the `agent_prompt` *purpose* but do not invoke
// `privacyFilterService.scrub` on the assembled prompt text.
//
// This helper is the single shared chokepoint that every LLM caller routes
// through right before the prompt leaves the app. It:
//
//   - Scrubs the assembled prompt via the canonical singleton.
//   - Records the scrub to PrivacyAuditService with source 'agent_prompt'
//     so /debug/privacy shows the volume.
//   - Returns the REDACTED text (defense-in-depth, never blocks the LLM
//     call). Upstream gates (claw_ingest, recipe_publish, free_text, voice)
//     are the blocking-on-HARD gates; Gate 5 is the last-line catch-all so
//     a HARD-PII leak from a missed upstream still doesn't make it into a
//     model prompt.
//
// Why not block on hard-fail? Gate 5 fires on every LLM call — including
// agent reasoning that never originated from raw user text. Blocking here
// would silently break agent behavior on PII-shaped false-positives from
// the stub backend (e.g. proper-noun token matches). The redacted text
// preserves the prompt structure while the audit log surfaces any HARD
// hit for operator triage.

import { privacyFilterService } from './PrivacyFilterService';

/**
 * Optional second arg to `scrubAgentPrompt`. Accepts either:
 *   - The bare `agentId` string (legacy / convenient call sites), OR
 *   - An options object with `{ source?: 'agent_prompt', agentId?, meta? }`.
 *
 * `source` is currently fixed to `'agent_prompt'` because that is the only
 * audit-source this helper records under; the field exists so call sites
 * can self-document and we have somewhere to extend if a sister-gate ever
 * needs the same wrapper.
 *
 * `meta` is opaque to the helper today (it isn't recorded into the audit
 * ring buffer — the ring buffer schema only keeps source + report). It's
 * accepted so callers can stash caller-id / region / hint info without the
 * call site looking weird; future audit-schema extension can promote it.
 */
export interface ScrubAgentPromptOptions {
    source?: 'agent_prompt';
    agentId?: string;
    meta?: Record<string, unknown>;
}

/**
 * Defense-in-depth scrub of an assembled LLM prompt. Returns the redacted
 * text (with `[REDACTED:category]` tokens in place of HARD / SOFT PII).
 * Records the scrub to the privacy audit ring buffer tagged
 * `source: 'agent_prompt'`.
 *
 * Hot-path safe: never throws to the caller. If the scrub backend crashes,
 * the original text is returned with a warning logged. (Gate 5 is
 * defense-in-depth — upstream gates are the blocking line of defense.)
 *
 * @param text   The fully-assembled prompt text (system + user concatenated
 *               is fine; the helper treats it as one blob).
 * @param optsOrAgentId Optional — either the bare `agentId` string, or an
 *                      options object `{ source: 'agent_prompt', agentId?,
 *                      meta? }`. Both shapes are equivalent in behavior;
 *                      the object form is preferred for new code.
 */
export async function scrubAgentPrompt(
    text: string,
    optsOrAgentId?: string | ScrubAgentPromptOptions,
): Promise<string> {
    if (typeof text !== 'string' || text.length === 0) return text ?? '';
    const agentId =
        typeof optsOrAgentId === 'string'
            ? optsOrAgentId
            : optsOrAgentId?.agentId;
    try {
        // Goal B (2026-05-22) — route through the canonical chokepoint. Gate 5
        // is defense-in-depth; on HARD detection we still return the redacted
        // text (rather than null/empty) so agent behavior isn't broken by stub
        // false-positives, but the cross-layer audit row records the rejection
        // so /debug/privacy operators see the HARD hit. The chokepoint marks
        // the destination as cross-world because the prompt is bound for an
        // external LLM (kernel inference port → WebGPU/Ollama).
        const { audit, scrubbed } = await privacyFilterService.publishToUniversal({
            payload: { kind: 'agent_prompt', agentId, length: text.length },
            text,
            purpose: 'agent_prompt',
            publishedTo: 'cross-world',
            callerName: 'scrub-agent-prompt',
        });
        // On allow: return scrubbed text (clean or SOFT-redacted).
        // On reject: scrubbed is null; re-derive the redacted text from a
        // direct scrub call so the LLM still gets a usable prompt. The reject
        // is logged in the cross-layer ring under audit.auditId.
        if (scrubbed !== null) return scrubbed;
        const report = await privacyFilterService.scrub(text, {
            purpose: 'agent_prompt',
            agentId,
        });
        return report.redactedText;
    } catch (err) {
        // Backend crash: fall back to the raw text rather than block the
        // LLM call. Upstream gates already enforced HARD-fail blocking.
        console.warn('[scrubAgentPrompt] scrub failed; returning original text:', err);
        return text;
    }
}
