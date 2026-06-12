// tests/production-hardening-hooks.test.ts
//
// Integration test for the hooks.server.ts -> production-config wiring.
// Blocker #6 in the adversarial review: the unit-level tests against
// `ensureProductionConfig` and `_markValidated` in isolation would not
// catch the bug at blocker #1 (latch-set-before-validate). This file
// drives the actual `handle` function with a stubbed RequestEvent and
// asserts that:
//
//   (i) Misconfigured-prod env → first `handle` call rejects with ProductionConfigError.
//   (ii) Misconfigured-prod env → SECOND `handle` call also rejects (regression for blocker #1).
//   (iii) Clean-prod env → `handle` resolves and event.locals.user === null.
//
// We import `$env/dynamic/private` from the test stub (mapped via the
// `$env` alias in vitest.config.ts) and mutate it between cases.

import { describe, it, expect, beforeEach } from "vitest";
import { handle } from "../src/hooks.server";
import {
	_resetValidationLatch,
	ProductionConfigError,
} from "$lib/env/production-config";
import { env as privateEnv } from "$env/dynamic/private";

/** Minimal RequestEvent stub — only the fields hooks.server.ts touches. */
function stubEvent(): {
	locals: { user: { email: string; parentId: string } | null };
	request: Request;
	url: URL;
} {
	return {
		locals: { user: null },
		request: new Request("http://localhost/"),
		url: new URL("http://localhost/"),
	};
}

function resolveStub(event: ReturnType<typeof stubEvent>): Response {
	return new Response("ok", { status: 200, headers: { "x-test": "1" } });
}

function setEnv(overrides: Record<string, string | undefined>): void {
	// Mutate the shared `env` object (test stub) — clearing prior keys first.
	for (const k of Object.keys(privateEnv)) {
		delete (privateEnv as Record<string, string | undefined>)[k];
	}
	Object.assign(privateEnv, overrides);
}

const FULLY_CONFIGURED_PROD: Record<string, string> = {
	NODE_ENV: "production",
	STRIPE_SECRET_KEY: "sk_live_test_value",
	STRIPE_WEBHOOK_SECRET: "whsec_test_value",
	LULU_CLIENT_ID: "lulu_id_test",
	LULU_CLIENT_SECRET: "lulu_secret_test",
	LULU_WEBHOOK_SECRET: "lulu_webhook_test",
	OPS_API_TOKEN: "ops_test_value",
	RESEND_API_KEY: "re_test",
};

beforeEach(() => {
	_resetValidationLatch();
	setEnv({}); // start each test with empty env
});

describe("hooks.server.ts handle — production-config wiring", () => {
	it("throws ProductionConfigError on first request with misconfigured prod env", async () => {
		setEnv({ NODE_ENV: "production", STORYBOOK_DEV_BYPASS_AUTH: "1" });
		const event = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		await expect(
			handle({ event, resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"] }),
		).rejects.toThrow(ProductionConfigError);
	});

	it("THROWS AGAIN on second request with misconfigured prod env (blocker #1 regression)", async () => {
		setEnv({ NODE_ENV: "production", STORYBOOK_DEV_BYPASS_AUTH: "1" });
		const event1 = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		const event2 = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		// First request throws.
		await expect(
			handle({ event: event1, resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"] }),
		).rejects.toThrow(ProductionConfigError);
		// Second request MUST also throw — operator hasn't fixed env yet.
		// Pre-fix shape (blocker #1): the latch flipped on first throw, so
		// the second call would skip the gate and resolve normally.
		await expect(
			handle({ event: event2, resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"] }),
		).rejects.toThrow(ProductionConfigError);
	});

	it("resolves cleanly with event.locals.user === null on clean prod env", async () => {
		setEnv(FULLY_CONFIGURED_PROD);
		const event = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		const resp = await handle({
			event,
			resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"],
		});
		expect(resp.status).toBe(200);
		// Cast back to inspect the stub's locals.
		expect((event as unknown as ReturnType<typeof stubEvent>).locals.user).toBeNull();
	});

	it("after first clean-prod success, subsequent requests no-op the gate (success-path latch)", async () => {
		setEnv(FULLY_CONFIGURED_PROD);
		const event1 = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		await handle({
			event: event1,
			resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"],
		});
		// Now break the env — the latch should make subsequent calls no-op
		// the gate (validate-once-on-success semantic). This mirrors the
		// real production deploy: once validated, the gate skips.
		setEnv({ NODE_ENV: "production" }); // junk env
		const event2 = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		const resp = await handle({
			event: event2,
			resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"],
		});
		expect(resp.status).toBe(200);
	});

	it("resolves cleanly when NODE_ENV is unset (dev / test default)", async () => {
		setEnv({}); // no NODE_ENV
		const event = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		const resp = await handle({
			event,
			resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"],
		});
		expect(resp.status).toBe(200);
	});

	it("throws on missing STRIPE_WEBHOOK_SECRET in prod (blocker #11 promotion)", async () => {
		const env: Record<string, string | undefined> = { ...FULLY_CONFIGURED_PROD };
		env.STRIPE_WEBHOOK_SECRET = undefined;
		setEnv(env);
		const event = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		await expect(
			handle({
				event,
				resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"],
			}),
		).rejects.toThrow(ProductionConfigError);
	});

	it("throws on 'STORYBOOK_DEV_BYPASS_AUTH=true' in prod (blocker #2 truthy-string)", async () => {
		setEnv({ ...FULLY_CONFIGURED_PROD, STORYBOOK_DEV_BYPASS_AUTH: "true" });
		const event = stubEvent() as unknown as Parameters<typeof handle>[0]["event"];
		await expect(
			handle({
				event,
				resolve: resolveStub as unknown as Parameters<typeof handle>[0]["resolve"],
			}),
		).rejects.toThrow(ProductionConfigError);
	});
});
