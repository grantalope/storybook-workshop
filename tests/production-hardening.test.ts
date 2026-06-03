// tests/production-hardening.test.ts
//
// ensureProductionConfig boot-asserts the production deploy contract.
//
// IMPORTANT — module-state singleton constraint: production-config.ts uses
// a module-scope `_validatedOnce` latch (see blocker #1 fix). Each test
// MUST call `_resetValidationLatch()` in beforeEach so prior tests don't
// leak state. Future test authors adding parallel files that import this
// module need the same beforeEach pattern.
//
// Verifies:
//   - non-production envs are silent passes (no throw, no warn)
//   - dev-bypass + production throws (every truthy variant: '1', 'true', 'yes', 'TRUE', 'on')
//   - missing stripe/lulu creds in production throws
//   - missing STRIPE_WEBHOOK_SECRET / LULU_WEBHOOK_SECRET in production throws (promoted from warn → fatal per blocker #11)
//   - missing RESEND_API_KEY warns (does NOT throw)
//   - NODE_ENV variants like 'Production' / 'PROD' / 'prod' emit a loud warn but skip gates
//   - clean production config passes silently
//   - findings carry stable error codes for ops dashboards
//   - warn-finding tests assert exact-shape findings (per blocker #12)
//   - _ensureValidated re-throws on every misconfigured request (blocker #1 regression test)
//
// Cross-ref: src/lib/env/production-config.ts, src/hooks.server.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	ensureProductionConfig,
	ProductionConfigError,
	_resetValidationLatch,
	_ensureValidated,
	_markValidated,
	_devBypassEnabled,
	_normalizeNodeEnv,
	type ProductionConfigEnv,
} from "$lib/env/production-config";

/** A valid, fully-configured production env. Tests start from this and break it. */
function fullyConfiguredProd(): ProductionConfigEnv {
	return {
		NODE_ENV: "production",
		STRIPE_SECRET_KEY: "sk_live_test_value",
		STRIPE_WEBHOOK_SECRET: "whsec_test_value",
		LULU_CLIENT_ID: "lulu_id_test",
		LULU_CLIENT_SECRET: "lulu_secret_test",
		LULU_WEBHOOK_SECRET: "lulu_webhook_test",
		RESEND_API_KEY: "re_test",
	};
}

/**
 * Helper for warn-finding ergonomics. Per minor concern in the review: the
 * mutate-by-cast pattern (`(env as { X?: string }).X = undefined`) is ugly
 * in tests; this helper lets a test express intent clearly:
 *   const env = partialProd({ RESEND_API_KEY: undefined });
 */
function partialProd(overrides: Partial<ProductionConfigEnv>): ProductionConfigEnv {
	return { ...fullyConfiguredProd(), ...overrides };
}

beforeEach(() => {
	// NODE_ENV=test is forced by vitest, so this is allowed.
	_resetValidationLatch();
});

describe("ensureProductionConfig — non-production environments", () => {
	it("returns no findings when NODE_ENV is undefined", () => {
		const warn = vi.fn();
		const findings = ensureProductionConfig({}, { warn });
		expect(findings).toHaveLength(0);
		expect(warn).not.toHaveBeenCalled();
	});

	it("returns no findings when NODE_ENV is development even with missing secrets", () => {
		const warn = vi.fn();
		const findings = ensureProductionConfig(
			{ NODE_ENV: "development" },
			{ warn },
		);
		expect(findings).toHaveLength(0);
		expect(warn).not.toHaveBeenCalled();
	});

	it("returns no findings when NODE_ENV is test even with bypass set", () => {
		const warn = vi.fn();
		const findings = ensureProductionConfig(
			{ NODE_ENV: "test", STORYBOOK_DEV_BYPASS_AUTH: "1" },
			{ warn },
		);
		expect(findings).toHaveLength(0);
		expect(warn).not.toHaveBeenCalled();
	});
});

describe("ensureProductionConfig — NODE_ENV misspell heuristic (blocker #5)", () => {
	it.each([
		["Production"],
		["PROD"],
		["prod"],
		["ProdServer"], // any /^prod/i match
	])("treats NODE_ENV=%j as non-production (with loud warn)", (raw) => {
		const warn = vi.fn();
		const findings = ensureProductionConfig({ NODE_ENV: raw }, { warn });
		expect(findings).toHaveLength(1);
		expect(findings[0]?.level).toBe("warn");
		expect(findings[0]?.code).toBe("node_env_looks_like_production");
		expect(warn).toHaveBeenCalledTimes(1);
		const warnedMsg = warn.mock.calls[0]?.[0] as string;
		expect(warnedMsg).toContain("node_env_looks_like_production");
		expect(warnedMsg).toContain(raw);
	});

	it("trims trailing/leading whitespace and treats 'production ' as canonical", () => {
		// Whitespace-only variants of canonical are accepted — the warn-on-
		// looksLikeProd path is for capital/abbreviated mismatches, not for
		// formatting whitespace. With creds present, this is a clean prod.
		const warn = vi.fn();
		const env: ProductionConfigEnv = {
			NODE_ENV: " production ",
			STRIPE_SECRET_KEY: "sk_live_x",
			STRIPE_WEBHOOK_SECRET: "whsec_x",
			LULU_CLIENT_ID: "id",
			LULU_CLIENT_SECRET: "secret",
			LULU_WEBHOOK_SECRET: "wh",
			RESEND_API_KEY: "re",
		};
		const findings = ensureProductionConfig(env, { warn });
		expect(findings).toHaveLength(0);
		expect(warn).not.toHaveBeenCalled();
	});
});

describe("_normalizeNodeEnv", () => {
	it("canonical match for exact 'production'", () => {
		const n = _normalizeNodeEnv("production");
		expect(n.canonical).toBe("production");
		expect(n.looksLikeProd).toBe(false);
	});

	it("canonical match after trim", () => {
		const n = _normalizeNodeEnv(" production ");
		expect(n.canonical).toBe("production");
	});

	it("flags PRODuction-y values as looksLikeProd", () => {
		for (const raw of ["Production", "PROD", "prod", "ProdLike"]) {
			const n = _normalizeNodeEnv(raw);
			expect(n.canonical).toBe(null);
			expect(n.looksLikeProd).toBe(true);
		}
	});

	it("returns nulls for development/test/empty", () => {
		for (const raw of ["development", "test", "preview", "", undefined]) {
			const n = _normalizeNodeEnv(raw);
			expect(n.canonical).toBe(null);
			expect(n.looksLikeProd).toBe(false);
		}
	});
});

describe("_devBypassEnabled", () => {
	it.each([
		["1", true],
		["true", true],
		["TRUE", true],
		["True", true],
		["yes", true],
		["YES", true],
		["on", true],
		["ON", true],
		["enabled", true],
		["anything-non-empty", true],
		["0", false],
		["false", false],
		["FALSE", false],
		["no", false],
		["off", false],
		["disable", false],
		["", false],
		[" ", false],
		[undefined, false],
	])("dev-bypass: %j → %j", (raw, expected) => {
		expect(_devBypassEnabled(raw as string | undefined)).toBe(expected);
	});
});

describe("ensureProductionConfig — fatal findings (production)", () => {
	it("throws when STORYBOOK_DEV_BYPASS_AUTH is set to any truthy value in production", () => {
		// Blocker #2: 'true', 'yes', 'TRUE', 'on' all must trip the gate.
		for (const flag of ["1", "true", "TRUE", "yes", "YES", "on", "enabled"]) {
			_resetValidationLatch();
			const env: ProductionConfigEnv = {
				...fullyConfiguredProd(),
				STORYBOOK_DEV_BYPASS_AUTH: flag,
			};
			expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
			try {
				ensureProductionConfig(env);
			} catch (e) {
				expect(e).toBeInstanceOf(ProductionConfigError);
				const err = e as ProductionConfigError;
				const codes = err.findings.filter((f) => f.level === "fatal").map((f) => f.code);
				expect(codes).toContain("dev_bypass_in_production");
			}
		}
	});

	it("does NOT trip dev-bypass gate for explicit-off values ('0', 'false', 'no', 'off')", () => {
		for (const flag of ["0", "false", "FALSE", "no", "off"]) {
			const env: ProductionConfigEnv = {
				...fullyConfiguredProd(),
				STORYBOOK_DEV_BYPASS_AUTH: flag,
			};
			// Should not throw — clean config except for an explicit-off bypass.
			expect(() => ensureProductionConfig(env)).not.toThrow();
		}
	});

	it("throws on missing STRIPE_SECRET_KEY in production", () => {
		const env = partialProd({ STRIPE_SECRET_KEY: undefined });
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
		try {
			ensureProductionConfig(env);
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err.findings.some((f) => f.code === "missing_stripe_secret" && f.level === "fatal")).toBe(true);
		}
	});

	it("throws on empty-string STRIPE_SECRET_KEY (treats whitespace as unset)", () => {
		const env = partialProd({ STRIPE_SECRET_KEY: "   " });
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
	});

	it("throws on missing LULU_CLIENT_ID in production", () => {
		const env = partialProd({ LULU_CLIENT_ID: undefined });
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
		try {
			ensureProductionConfig(env);
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err.findings.some((f) => f.code === "missing_lulu_client_id" && f.level === "fatal")).toBe(true);
		}
	});

	it("throws on missing LULU_CLIENT_SECRET in production", () => {
		const env = partialProd({ LULU_CLIENT_SECRET: undefined });
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
		try {
			ensureProductionConfig(env);
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err.findings.some((f) => f.code === "missing_lulu_client_secret" && f.level === "fatal")).toBe(true);
		}
	});

	it("throws on missing STRIPE_WEBHOOK_SECRET in production (promoted fatal per blocker #11)", () => {
		const env = partialProd({ STRIPE_WEBHOOK_SECRET: undefined });
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
		try {
			ensureProductionConfig(env);
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err.findings.some((f) => f.code === "missing_stripe_webhook_secret" && f.level === "fatal")).toBe(true);
		}
	});

	it("throws on missing LULU_WEBHOOK_SECRET in production (promoted fatal per blocker #11)", () => {
		const env = partialProd({ LULU_WEBHOOK_SECRET: undefined });
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
		try {
			ensureProductionConfig(env);
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err.findings.some((f) => f.code === "missing_lulu_webhook_secret" && f.level === "fatal")).toBe(true);
		}
	});

	it("aggregates multiple fatal findings into a single error", () => {
		const env: ProductionConfigEnv = {
			NODE_ENV: "production",
			STORYBOOK_DEV_BYPASS_AUTH: "1",
			// All creds missing.
		};
		try {
			ensureProductionConfig(env);
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err).toBeInstanceOf(ProductionConfigError);
			const fatalCodes = err.findings.filter((f) => f.level === "fatal").map((f) => f.code);
			expect(fatalCodes).toEqual(
				expect.arrayContaining([
					"dev_bypass_in_production",
					"missing_stripe_secret",
					"missing_lulu_client_id",
					"missing_lulu_client_secret",
					"missing_stripe_webhook_secret",
					"missing_lulu_webhook_secret",
				]),
			);
			expect(err.message).toContain("ProductionConfigError");
			expect(err.message).toContain("docs/production-deploy.md");
		}
	});
});

describe("ensureProductionConfig — warn-level findings (production)", () => {
	// Blocker #12: tight per-field assertions instead of `findings.some()` —
	// a `some()` check would silently pass if BOTH a warn AND a fatal exist.

	it("warns but does not throw on missing RESEND_API_KEY (exact-shape findings)", () => {
		const warn = vi.fn();
		const env = partialProd({ RESEND_API_KEY: undefined });
		const findings = ensureProductionConfig(env, { warn });
		// Exact-shape assertion: ONLY 1 warn finding, level=warn, code=missing_resend_api_key.
		expect(findings).toHaveLength(1);
		expect(findings[0]?.level).toBe("warn");
		expect(findings[0]?.code).toBe("missing_resend_api_key");
		// No fatal findings smuggled in.
		expect(findings.filter((f) => f.level === "fatal")).toHaveLength(0);
		expect(warn).toHaveBeenCalledTimes(1);
		const warnedMsg = warn.mock.calls[0]?.[0] as string;
		expect(warnedMsg).toContain("missing_resend_api_key");
	});

	it("mixed fatal+warn: emits warn BEFORE throw, throw is fatal-only", () => {
		// Confirms surface-then-throw ordering for ops dashboards.
		const warn = vi.fn();
		const env = partialProd({
			STRIPE_SECRET_KEY: undefined, // fatal
			RESEND_API_KEY: undefined, // warn
		});
		expect(() => ensureProductionConfig(env, { warn })).toThrow(ProductionConfigError);
		// Warn was called BEFORE the throw — sanity check that mixed warns surface.
		expect(warn).toHaveBeenCalledTimes(1);
		expect((warn.mock.calls[0]?.[0] as string)).toContain("missing_resend_api_key");
		try {
			ensureProductionConfig(env, { warn: vi.fn() });
		} catch (e) {
			const err = e as ProductionConfigError;
			const fatalCodes = err.findings.filter((f) => f.level === "fatal").map((f) => f.code);
			expect(fatalCodes).toContain("missing_stripe_secret");
		}
	});
});

describe("ensureProductionConfig — clean production config", () => {
	it("passes silently with no findings + no warns when fully configured", () => {
		const warn = vi.fn();
		const findings = ensureProductionConfig(fullyConfiguredProd(), { warn });
		expect(findings).toHaveLength(0);
		expect(warn).not.toHaveBeenCalled();
	});
});

// ─── Blocker #1 regression: validate-then-latch semantics ─────────────
describe("_ensureValidated — validate-then-latch (blocker #1 regression)", () => {
	it("throws ProductionConfigError on first misconfigured-prod call", () => {
		const env: ProductionConfigEnv = {
			NODE_ENV: "production",
			STORYBOOK_DEV_BYPASS_AUTH: "1",
		};
		expect(() => _ensureValidated(env)).toThrow(ProductionConfigError);
	});

	it("THROWS AGAIN on second misconfigured-prod call (regression test)", () => {
		// Before blocker #1 fix: first call throws, second call NO-OPs and
		// silently bypasses the gate. Post-fix: every call until validation
		// succeeds throws — operator MUST fix the env and restart.
		const env: ProductionConfigEnv = {
			NODE_ENV: "production",
			STORYBOOK_DEV_BYPASS_AUTH: "1",
		};
		expect(() => _ensureValidated(env)).toThrow(ProductionConfigError);
		expect(() => _ensureValidated(env)).toThrow(ProductionConfigError);
		expect(() => _ensureValidated(env)).toThrow(ProductionConfigError);
	});

	it("first call succeeds + second call no-ops on clean prod config", () => {
		const env = fullyConfiguredProd();
		// First call latches the success.
		_ensureValidated(env);
		// Second call is the no-op path — should not re-run the validator.
		// We can't easily spy on `ensureProductionConfig` because we re-export
		// it from the same module, but a 'doesn't throw with junk env after
		// success' check is the contract test.
		_ensureValidated({ NODE_ENV: "production" } as ProductionConfigEnv);
		// (Would throw if it actually re-ran — but no-op path skips it.)
	});

	it("first-throw then-fix scenario: throws → throws → operator-fix → succeeds", () => {
		const badEnv: ProductionConfigEnv = {
			NODE_ENV: "production",
			STORYBOOK_DEV_BYPASS_AUTH: "1",
		};
		expect(() => _ensureValidated(badEnv)).toThrow(ProductionConfigError);
		expect(() => _ensureValidated(badEnv)).toThrow(ProductionConfigError);
		// Operator restarts process with fixed env. In this test we simulate
		// restart by resetting the latch (in production: a real process bounce).
		_resetValidationLatch();
		const goodEnv = fullyConfiguredProd();
		expect(() => _ensureValidated(goodEnv)).not.toThrow();
		// And now-latched: misconfigured calls would no-op.
		_ensureValidated(badEnv); // does NOT throw — latched on prior success
	});
});

// ─── Blocker #9 regression: _resetValidationLatch test-env guard ──────
describe("_resetValidationLatch — production-environment guard", () => {
	it("permits reset under vitest (NODE_ENV=test OR VITEST set)", () => {
		// This call is the reset in the beforeEach above — if guard were
		// active in production code paths, our entire test suite would crash.
		// Demonstrate it works under vitest by calling it directly.
		expect(() => _resetValidationLatch()).not.toThrow();
	});

	it("throws when called outside a test environment (no NODE_ENV=test AND no VITEST)", () => {
		// Temporarily strip BOTH test-mode signals so the guard fires.
		const origNodeEnv = process.env.NODE_ENV;
		const origVitest = process.env.VITEST;
		try {
			(process.env as Record<string, string | undefined>).NODE_ENV = "production";
			delete (process.env as Record<string, string | undefined>).VITEST;
			expect(() => _resetValidationLatch()).toThrow(/test environment/);
		} finally {
			(process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
			if (origVitest != null) {
				(process.env as Record<string, string | undefined>).VITEST = origVitest;
			}
		}
	});

	it("permits reset when NODE_ENV=test but VITEST unset (Node test runner)", () => {
		const origVitest = process.env.VITEST;
		try {
			(process.env as Record<string, string | undefined>).NODE_ENV = "test";
			delete (process.env as Record<string, string | undefined>).VITEST;
			expect(() => _resetValidationLatch()).not.toThrow();
		} finally {
			if (origVitest != null) {
				(process.env as Record<string, string | undefined>).VITEST = origVitest;
			}
		}
	});
});

// ─── Legacy _markValidated shape ──────────────────────────────────────
describe("_markValidated — deprecated, non-latching (blocker #1)", () => {
	it("does NOT latch on its own (forces callers to migrate to _ensureValidated)", () => {
		// Pre-fix shape: latched and would skip the gate on subsequent calls.
		// Post-fix shape: returns 'should validate' true/false based on the
		// _ensureValidated-managed latch, but DOES NOT mutate state itself.
		_resetValidationLatch();
		expect(_markValidated()).toBe(true);
		// Without _ensureValidated firing, the latch stays open — so the
		// next call STILL returns true. This is the safety property: legacy
		// callers that ignore the return get re-checked.
		expect(_markValidated()).toBe(true);
		// After a successful _ensureValidated, the latch flips and
		// _markValidated reports the validated state.
		_ensureValidated(fullyConfiguredProd());
		expect(_markValidated()).toBe(false);
	});
});
