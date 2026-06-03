// src/lib/env/production-config.ts
//
// Production deploy contract: a single boot-time gate that asserts the
// process environment is wired correctly before any security-sensitive
// endpoint will accept requests.
//
// Called from src/hooks.server.ts on every request via _ensureValidated().
// The latch only flips AFTER successful validation, so a misconfigured
// production deploy throws on EVERY request (not just the first) until the
// operator fixes the env and restarts the process. THROWS on configuration
// that would silently weaken production security; WARNS on optional
// configuration that degrades functionality but is not itself unsafe.
//
// Three classes of finding:
//   1. PROD-FATAL — combination would expose the app to attackers.
//      Examples:
//        * NODE_ENV=production AND STORYBOOK_DEV_BYPASS_AUTH set
//        * NODE_ENV=production AND missing STRIPE_SECRET_KEY
//        * NODE_ENV=production AND missing LULU_CLIENT_ID/LULU_CLIENT_SECRET
//        * NODE_ENV=production AND missing STRIPE_WEBHOOK_SECRET/LULU_WEBHOOK_SECRET
//      → throws ProductionConfigError (process aborts).
//
//   2. PROD-DEGRADED — optional integration missing; app functions but
//      with reduced capabilities (e.g. no transactional email).
//      Examples:
//        * NODE_ENV=production AND missing RESEND_API_KEY
//        * NODE_ENV variant like 'Production' / 'prod' (treated as non-prod
//          but warns loudly so misspellings are visible).
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
	| "missing_resend_api_key"
	| "node_env_looks_like_production";

export class ProductionConfigError extends Error {
	readonly findings: readonly ProductionConfigFinding[];
	constructor(findings: readonly ProductionConfigFinding[]) {
		const fatals = findings.filter((f) => f.level === "fatal");
		// Per implementation-notes.md (blocker #13): we keep the verbose
		// message because finding hints help operators recover. The error
		// is OK to log to aggregators — codes are stable and messages do
		// not contain attacker-controlled data (only env-variable NAMES).
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
 * Heuristic: does the NODE_ENV value LOOK like production but not match
 * exactly? Catches `Production`, `PROD`, `prod`, `production ` (trailing
 * space). Returns the normalized value when it matches the canonical
 * 'production' (after trim+lower) and null otherwise.
 */
export function _normalizeNodeEnv(raw: string | undefined): {
	canonical: "production" | null;
	looksLikeProd: boolean;
	raw: string | undefined;
} {
	if (typeof raw !== "string") return { canonical: null, looksLikeProd: false, raw };
	const trimmed = raw.trim();
	if (trimmed === "production") return { canonical: "production", looksLikeProd: false, raw };
	if (trimmed.toLowerCase() === "production" || /^prod/i.test(trimmed)) {
		return { canonical: null, looksLikeProd: true, raw };
	}
	return { canonical: null, looksLikeProd: false, raw };
}

/**
 * Truthy-string detector for the dev-bypass flag. We accept ANY non-empty
 * value that is not explicitly off ('0', 'false', 'no', 'off') as enabling
 * the bypass so operators who set `STORYBOOK_DEV_BYPASS_AUTH=true` (or any
 * variant) cannot accidentally smuggle the flag into production.
 */
export function _devBypassEnabled(raw: string | undefined): boolean {
	if (typeof raw !== "string") return false;
	const v = raw.trim();
	if (v.length === 0) return false;
	const off = new Set(["0", "false", "no", "off", "disable", "disabled"]);
	if (off.has(v.toLowerCase())) return false;
	return true;
}

/**
 * Validate the deploy contract. THROWS ProductionConfigError on any fatal
 * finding; WARNS via the injected sink on degraded findings. Returns the
 * list of findings (empty in the all-green case).
 *
 * Pure function — no IO, no module state. Safe to call repeatedly.
 */
export function ensureProductionConfig(
	env: ProductionConfigEnv,
	opts: EnsureProductionConfigOpts = {},
): readonly ProductionConfigFinding[] {
	const warn = opts.warn ?? ((m: string) => console.warn(m));
	const findings: ProductionConfigFinding[] = [];

	const nodeEnv = _normalizeNodeEnv(env.NODE_ENV);

	// Catch `Production`, `PROD`, `prod` — operators mis-spelling NODE_ENV
	// would silently bypass every gate otherwise. We treat these as non-prod
	// (so we don't accidentally throw in a dev env where the value happens to
	// start with 'prod') but emit a loud warn so the misspelling is visible
	// at boot.
	if (nodeEnv.looksLikeProd) {
		const f: ProductionConfigFinding = {
			level: "warn",
			code: "node_env_looks_like_production",
			message:
				`NODE_ENV is set to "${nodeEnv.raw}"; treating as non-production. ` +
				`Use exactly NODE_ENV=production to enable the deploy gate.`,
		};
		findings.push(f);
		warn(`[production-config] ${f.code}: ${f.message}`);
		return findings;
	}

	if (nodeEnv.canonical !== "production") {
		// dev / test / preview — skip all gates. Production-only validators are
		// no-ops outside production by design.
		return findings;
	}

	// ── PROD-FATAL gates ────────────────────────────────────────────────
	if (_devBypassEnabled(env.STORYBOOK_DEV_BYPASS_AUTH)) {
		findings.push({
			level: "fatal",
			code: "dev_bypass_in_production",
			message:
				"STORYBOOK_DEV_BYPASS_AUTH is set (any non-empty value) with NODE_ENV=production. " +
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

	// Promoted from warn → fatal (blocker #11 in adversarial review): the
	// in-process HMAC verifiers ARE the supported path. Missing webhook
	// secrets means every webhook is rejected, so orders stall forever in
	// pending_payment / submitted_to_lulu. That's a fulfillment outage, not
	// a 'degraded mode'. Operators terminating webhook verification at an
	// upstream relay (hypothetical) should override the gate per deploy.
	if (!nonEmpty(env.STRIPE_WEBHOOK_SECRET)) {
		findings.push({
			level: "fatal",
			code: "missing_stripe_webhook_secret",
			message:
				"STRIPE_WEBHOOK_SECRET is empty or unset. Incoming Stripe " +
				"webhooks will be REJECTED until set, stalling every order at " +
				"pending_payment. Add the whsec_... value from the Stripe dashboard.",
		});
	}
	if (!nonEmpty(env.LULU_WEBHOOK_SECRET)) {
		findings.push({
			level: "fatal",
			code: "missing_lulu_webhook_secret",
			message:
				"LULU_WEBHOOK_SECRET is empty or unset. Incoming Lulu webhooks " +
				"will fail HMAC verification and be REJECTED, stalling every " +
				"order at submitted_to_lulu. Add the secret from the Lulu Direct dashboard.",
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

	// ── Surface findings ────────────────────────────────────────────────
	// Emit warns BEFORE throwing so operators see all warn-level context
	// alongside any fatals in the boot log.
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

// ─── Validation latch (validate-then-latch) ───────────────────────────
//
// Per blocker #1 in the adversarial review: the gate MUST validate BEFORE
// latching. The previous `_markValidated()` design set the latch FIRST and
// the validator second — so a throw on the first misconfigured request
// flipped the latch as a side effect, skipping the gate for every
// subsequent request. Effectively: server returned 500 once then served
// insecure config silently.
//
// Fixed shape: `_ensureValidated` calls the validator and ONLY sets the
// latch if it returns cleanly. Throws on every misconfigured request until
// the env is fixed and the process restarted.

let _validatedOnce = false;

/**
 * Idempotent validation gate. Runs `ensureProductionConfig` once per
 * process when validation succeeds; re-runs (and re-throws) on every
 * subsequent request when validation has not yet succeeded. Safe to call
 * from a hot path like `hooks.server.ts.handle` — cached state path is
 * a single boolean check.
 */
export function _ensureValidated(
	env: ProductionConfigEnv,
	opts: EnsureProductionConfigOpts = {},
): void {
	if (_validatedOnce) return;
	ensureProductionConfig(env, opts);
	// Only latch on success — a throw above leaves _validatedOnce=false so
	// the NEXT request will re-validate and re-throw with the same findings.
	_validatedOnce = true;
}

/**
 * Test-only escape hatch — vitest test files reset between describe blocks.
 * Throws if invoked outside a test context to prevent production code paths
 * from accidentally re-firing the gate.
 *
 * Test-mode detection: NODE_ENV=test OR vitest globals present
 * (`process.env.VITEST` is set by vitest) OR `import.meta.env.MODE === 'test'`.
 *
 * Per blocker #9: an underscore-prefixed export does not enforce 'test-only'
 * at the type level. This runtime guard ensures the latch can only be
 * reset under a test runner.
 */
export function _resetValidationLatch(): void {
	// Test-mode detection: NODE_ENV=test OR VITEST env-var set (vitest exposes
	// this on every test process). We intentionally do NOT rely on
	// `import.meta.env.MODE` because vitest sets it permanently across the
	// whole module — there is no way for code WITHIN a vitest process to
	// signal 'not in test mode' for negative-guard testing, but production
	// code never sets either signal so the guard fires for them.
	const inTest =
		typeof process !== "undefined" &&
		(process.env?.NODE_ENV === "test" || process.env?.VITEST != null);
	if (!inTest) {
		throw new Error(
			"_resetValidationLatch called outside a test environment. " +
				"This API is reserved for vitest test isolation. " +
				"Production code must NOT call it — set NODE_ENV=test or run under vitest.",
		);
	}
	_validatedOnce = false;
}

/**
 * @deprecated Use _ensureValidated(env, opts) directly. The legacy
 * latch-first shape is a foot-gun (see blocker #1): on a thrown validation,
 * the latch was being set BEFORE the validator ran, so subsequent
 * misconfigured-prod requests skipped the gate entirely.
 *
 * Retained as a no-op gate (does NOT latch) so any leftover legacy caller
 * fails LOUD on the validator throw (because the next request also enters
 * the same path). New code MUST migrate to _ensureValidated.
 */
export function _markValidated(): boolean {
	return !_validatedOnce;
}
