// tests/production-hardening.test.ts
//
// ensureProductionConfig boot-asserts the production deploy contract.
// Verifies:
//   - non-production envs are silent passes (no throw, no warn)
//   - dev-bypass + production throws
//   - missing stripe/lulu creds in production throws
//   - missing RESEND_API_KEY warns (does NOT throw)
//   - clean production config passes silently
//   - findings carry stable error codes for ops dashboards
//
// Cross-ref: src/lib/env/production-config.ts, src/hooks.server.ts.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	ensureProductionConfig,
	ProductionConfigError,
	_resetValidationLatch,
	_markValidated,
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

beforeEach(() => {
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

describe("ensureProductionConfig — fatal findings (production)", () => {
	it("throws when STORYBOOK_DEV_BYPASS_AUTH is set in production", () => {
		const env: ProductionConfigEnv = {
			...fullyConfiguredProd(),
			STORYBOOK_DEV_BYPASS_AUTH: "1",
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
	});

	it("throws on missing STRIPE_SECRET_KEY in production", () => {
		const env = fullyConfiguredProd();
		(env as { STRIPE_SECRET_KEY?: string }).STRIPE_SECRET_KEY = undefined;
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
		try {
			ensureProductionConfig(env);
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err.findings.some((f) => f.code === "missing_stripe_secret" && f.level === "fatal")).toBe(true);
		}
	});

	it("throws on empty-string STRIPE_SECRET_KEY (treats whitespace as unset)", () => {
		const env = { ...fullyConfiguredProd(), STRIPE_SECRET_KEY: "   " };
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
	});

	it("throws on missing LULU_CLIENT_ID in production", () => {
		const env = fullyConfiguredProd();
		(env as { LULU_CLIENT_ID?: string }).LULU_CLIENT_ID = undefined;
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
		try {
			ensureProductionConfig(env);
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err.findings.some((f) => f.code === "missing_lulu_client_id" && f.level === "fatal")).toBe(true);
		}
	});

	it("throws on missing LULU_CLIENT_SECRET in production", () => {
		const env = fullyConfiguredProd();
		(env as { LULU_CLIENT_SECRET?: string }).LULU_CLIENT_SECRET = undefined;
		expect(() => ensureProductionConfig(env)).toThrow(ProductionConfigError);
		try {
			ensureProductionConfig(env);
		} catch (e) {
			const err = e as ProductionConfigError;
			expect(err.findings.some((f) => f.code === "missing_lulu_client_secret" && f.level === "fatal")).toBe(true);
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
				]),
			);
			expect(err.message).toContain("ProductionConfigError");
			expect(err.message).toContain("docs/production-deploy.md");
		}
	});
});

describe("ensureProductionConfig — warn-level findings (production)", () => {
	it("warns but does not throw on missing RESEND_API_KEY", () => {
		const warn = vi.fn();
		const env = fullyConfiguredProd();
		(env as { RESEND_API_KEY?: string }).RESEND_API_KEY = undefined;
		const findings = ensureProductionConfig(env, { warn });
		expect(findings.some((f) => f.code === "missing_resend_api_key" && f.level === "warn")).toBe(true);
		expect(warn).toHaveBeenCalled();
		const warnedMsg = warn.mock.calls[0]?.[0] as string;
		expect(warnedMsg).toContain("missing_resend_api_key");
	});

	it("warns on missing STRIPE_WEBHOOK_SECRET (proxy-relay deploys allowed)", () => {
		const warn = vi.fn();
		const env = fullyConfiguredProd();
		(env as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET = undefined;
		const findings = ensureProductionConfig(env, { warn });
		expect(findings.some((f) => f.code === "missing_stripe_webhook_secret" && f.level === "warn")).toBe(true);
		expect(warn).toHaveBeenCalled();
	});

	it("warns on missing LULU_WEBHOOK_SECRET", () => {
		const warn = vi.fn();
		const env = fullyConfiguredProd();
		(env as { LULU_WEBHOOK_SECRET?: string }).LULU_WEBHOOK_SECRET = undefined;
		const findings = ensureProductionConfig(env, { warn });
		expect(findings.some((f) => f.code === "missing_lulu_webhook_secret" && f.level === "warn")).toBe(true);
		expect(warn).toHaveBeenCalled();
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

describe("_markValidated latch", () => {
	it("returns true exactly once per process, false on subsequent calls", () => {
		_resetValidationLatch();
		expect(_markValidated()).toBe(true);
		expect(_markValidated()).toBe(false);
		expect(_markValidated()).toBe(false);
	});

	it("resets via _resetValidationLatch (test-only escape hatch)", () => {
		_resetValidationLatch();
		expect(_markValidated()).toBe(true);
		_resetValidationLatch();
		expect(_markValidated()).toBe(true);
	});
});
