// src/lib/env/production-config.ts
//
// Production deploy contract: a single boot-time gate that asserts the
// process environment is wired correctly before any security-sensitive
// endpoint will accept requests.
//
// Called once per process from src/hooks.server.ts on the first incoming
// request (idempotent — caches the validation result via `_validatedOnce`).
// THROWS on configuration that would silently weaken production security;
// WARNS on optional configuration that degrades functionality but is not
// itself unsafe.
//
// Three classes of finding:
//   1. PROD-FATAL — combination would expose the app to attackers.
//      Examples:
//        * NODE_ENV=production AND STORYBOOK_DEV_BYPASS_AUTH=1
//        * NODE_ENV=production AND missing STRIPE_SECRET_KEY
//        * NODE_ENV=production AND missing LULU_CLIENT_ID/LULU_CLIENT_SECRET
//      → throws ProductionConfigError (process aborts).
//
//   2. PROD-DEGRADED — optional integration missing; app functions but
//      with reduced capabilities (e.g. no transactional email).
//      Examples:
//        * NODE_ENV=production AND missing RESEND_API_KEY
//      → console.warn loudly, do not throw.
//
//   3. PROD-OK — value present (or env != production); silent.
//
// Spec: docs/specs/2026-05-24-design.md §5 (fulfillment) + §10 (deploy)
// Cross-ref: src/hooks.server.ts (caller), docs/production-deploy.md.

export interface ProductionConfigEnv {
	readonly NODE_ENV?: string;
	readonly STORYBOOK_DEV_BYPASS_AUTH?: string;
	readonly STRIPE_SECRET_KEY?: string;
	readonly STRIPE_WEBHOOK_SECRET?: string;
	readonly LULU_CLIENT_ID?: string;
	readonly LULU_CLIENT_SECRET?: string;
	readonly LULU_WEBHOOK_SECRET?: string;
	readonly RESEND_API_KEY?: string;
}

export interface ProductionConfigFinding {
	readonly level: "fatal" | "warn";
	readonly code: ProductionConfigErrorCode;
	readonly message: string;
}

export type ProductionConfigErrorCode =
	| "dev_bypass_in_production"
	| "missing_stripe_secret"
	| "missing_stripe_webhook_secret"
	| "missing_lulu_client_id"
	| "missing_lulu_client_secret"
	| "missing_lulu_webhook_secret"
	| "missing_resend_api_key";

export class ProductionConfigError extends Error {
	readonly findings: readonly ProductionConfigFinding[];
	constructor(findings: readonly ProductionConfigFinding[]) {
		const fatals = findings.filter((f) => f.level === "fatal");
		const summary = fatals.map((f) => `${f.code}: ${f.message}`).join("; ");
		super(
			`ProductionConfigError — refusing to start with insecure config. ` +
				`Fatal findings: [${summary}]. See docs/production-deploy.md for a deploy checklist.`,
		);
		this.name = "ProductionConfigError";
		this.findings = findings;
	}
}

export interface EnsureProductionConfigOpts {
	/**
	 * Logger sink for warn-level findings. Default: console.warn.
	 * Tests inject a capturing sink so they can assert on output.
	 */
	readonly warn?: (msg: string) => void;
}

/**
 * Validate the deploy contract. THROWS ProductionConfigError on any fatal
 * finding; WARNS via the injected sink on degraded findings. Returns the
 * list of findings (empty in the all-green case).
 *
 * Idempotent in the sense that it does no IO and is safe to call repeatedly,
 * but in practice callers should cache the result (see hooks.server.ts).
 */
export function ensureProductionConfig(
	env: ProductionConfigEnv,
	opts: EnsureProductionConfigOpts = {},
): readonly ProductionConfigFinding[] {
	const warn = opts.warn ?? ((m: string) => console.warn(m));
	const findings: ProductionConfigFinding[] = [];

	const inProd = env.NODE_ENV === "production";

	if (!inProd) {
		// dev / test / preview — skip all gates. Production-only validators are
		// no-ops outside production by design.
		return findings;
	}

	// ── PROD-FATAL gates ────────────────────────────────────────────────
	if (env.STORYBOOK_DEV_BYPASS_AUTH === "1") {
		findings.push({
			level: "fatal",
			code: "dev_bypass_in_production",
			message:
				"STORYBOOK_DEV_BYPASS_AUTH=1 is set with NODE_ENV=production. " +
				"This flag accepts attacker-controlled parentEmail from request " +
				"bodies and MUST never be set in a production deploy. Unset it " +
				"and wire real session auth via src/hooks.server.ts.",
		});
	}

	if (!nonEmpty(env.STRIPE_SECRET_KEY)) {
		findings.push({
			level: "fatal",
			code: "missing_stripe_secret",
			message:
				"STRIPE_SECRET_KEY is empty or unset. Payment creation via " +
				"StripeCheckoutService cannot function. Set the live key " +
				"(sk_live_...) in the deploy environment.",
		});
	}

	if (!nonEmpty(env.LULU_CLIENT_ID)) {
		findings.push({
			level: "fatal",
			code: "missing_lulu_client_id",
			message:
				"LULU_CLIENT_ID is empty or unset. Lulu Direct OAuth2 token " +
				"acquisition will fail and no print jobs can submit. Set the " +
				"production client id.",
		});
	}

	if (!nonEmpty(env.LULU_CLIENT_SECRET)) {
		findings.push({
			level: "fatal",
			code: "missing_lulu_client_secret",
			message:
				"LULU_CLIENT_SECRET is empty or unset. Lulu Direct OAuth2 token " +
				"acquisition will fail and no print jobs can submit. Set the " +
				"production client secret.",
		});
	}

	// ── PROD-DEGRADED gates (warn, do not throw) ────────────────────────
	if (!nonEmpty(env.RESEND_API_KEY)) {
		findings.push({
			level: "warn",
			code: "missing_resend_api_key",
			message:
				"RESEND_API_KEY is empty or unset. Transactional email will fall " +
				"back to LoggingEmailProvider (in-process only). Order " +
				"confirmation + shipment-notification emails will NOT be sent " +
				"to parents. Set RESEND_API_KEY (or POSTMARK equivalent) to " +
				"enable real delivery.",
		});
	}

	// Optional but recommended webhook secrets. We warn rather than throw
	// because some deploys terminate webhook verification at an upstream
	// reverse proxy or webhook relay.
	if (!nonEmpty(env.STRIPE_WEBHOOK_SECRET)) {
		findings.push({
			level: "warn",
			code: "missing_stripe_webhook_secret",
			message:
				"STRIPE_WEBHOOK_SECRET is empty or unset. Incoming Stripe " +
				"webhooks will be REJECTED until set. Add the whsec_... value " +
				"from the Stripe dashboard.",
		});
	}
	if (!nonEmpty(env.LULU_WEBHOOK_SECRET)) {
		findings.push({
			level: "warn",
			code: "missing_lulu_webhook_secret",
			message:
				"LULU_WEBHOOK_SECRET is empty or unset. Incoming Lulu webhooks " +
				"will fail HMAC verification and be REJECTED. Add the secret " +
				"from the Lulu Direct dashboard.",
		});
	}

	// ── Surface findings ────────────────────────────────────────────────
	for (const f of findings) {
		if (f.level === "warn") {
			warn(`[production-config] ${f.code}: ${f.message}`);
		}
	}

	const fatals = findings.filter((f) => f.level === "fatal");
	if (fatals.length > 0) {
		throw new ProductionConfigError(findings);
	}

	return findings;
}

function nonEmpty(v: string | undefined): boolean {
	return typeof v === "string" && v.trim().length > 0;
}

/**
 * Module-level latch — hooks.server.ts uses this to run the gate exactly
 * once per process. Returns true the first time, false thereafter.
 */
let _validatedOnce = false;
export function _markValidated(): boolean {
	if (_validatedOnce) return false;
	_validatedOnce = true;
	return true;
}
export function _resetValidationLatch(): void {
	// Test-only escape hatch — vitest test files reset between describe blocks.
	_validatedOnce = false;
}
