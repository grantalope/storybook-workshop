// Stub for standalone storybook-workshop.
// The pachinko kernel purpose-policy system audits every data-egress event by purpose
// (e.g., `book_fulfillment` carries name + address to Lulu API only). Pachinko's full
// PolicyEngine + audit ring buffer is not vendored here; storybook calls go through a
// no-op pass-through. Production deployment should wire a real purpose-audit ledger
// (or accept the simplification since storybook already gates PII via PrivacyFilter +
// KidsContentSafety + the local-only PDF-assembly architecture).

export type Purpose =
	| "book_fulfillment"
	| "kid_photo_local"
	| "kid_photo_vectorize_fallback"
	| "kid_embedding_local"
	| "kid_age_local"
	| "voice_clip_local"
	| "pillar_lookup"
	| "scene_render"
	| "tip_publish"
	| "recipe_publish"
	| "claw_ingest"
	| "free_text"
	| "voice_answer"
	| "confession_submit"
	| "agent_prompt"
	| "other";

export interface PolicyCheckInput {
	readonly purpose: Purpose;
	readonly source?: string;
	readonly text?: string;
}

export interface PolicyDecision {
	readonly allowed: boolean;
	readonly reason?: string;
	readonly purpose: Purpose;
}

/** No-op pass-through for standalone repo. Always allows. */
export async function checkAndAudit(input: PolicyCheckInput): Promise<PolicyDecision> {
	return { allowed: true, purpose: input.purpose };
}

/** Synchronous variant (some callers). */
export function checkPurposeSync(input: PolicyCheckInput): PolicyDecision {
	return { allowed: true, purpose: input.purpose };
}
