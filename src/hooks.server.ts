// src/hooks.server.ts
//
// SvelteKit server-side hook chain. Currently scoped to documenting the
// auth contract for security-sensitive endpoints — full session/cookie
// auth lands in a follow-up (marketing-funnel or a dedicated auth goal).
//
// SECURITY: per the 2026-06-03 security review HIGH finding ("Missing
// Authentication / Unauthenticated Order Creation with Attacker-Controlled
// Email"), security-sensitive endpoints (/api/order, /api/quality-claim)
// MUST derive parent identity from a server-side session — never trust
// `parentEmail` from the request body alone.
//
// MVP STANDALONE bypass:
//   Set `STORYBOOK_DEV_BYPASS_AUTH=1` to let the order endpoint accept
//   `parentEmail` from the request body. The endpoint logs loudly and
//   refuses to start in production (NODE_ENV=production) without a real
//   auth integration.
//
// Production wiring (v2 goal): replace this with a real session check
// (cookie-based JWT verify, or upstream Auth0/Clerk/Supabase session).
// Populate `event.locals.user = { email, parentId, ... }`. Endpoints then
// read `event.locals.user.email` and ignore client-supplied identity.
//
// CRM-Resend wiring (2026-06-03): boot-warn when `RESEND_API_KEY` is unset
// outside the test/vitest env, so a forgotten env var surfaces before a
// real customer order silently no-ops. See `assertResendKeyOrBootWarn`.
//
// PRODUCTION DEPLOY CONTRACT: `_ensureValidated()` runs on every request
// to validate the env. Misconfigured production deploys throw a loud
// `ProductionConfigError` on EVERY request (not just the first) until the
// operator fixes the env and restarts the process. The latch only flips
// after a successful validation, so the documented 'server refuses to
// serve traffic until reconfigured' guarantee holds.
// See `src/lib/env/production-config.ts` + `docs/production-deploy.md`.
//
// Env access uses SvelteKit's `$env/dynamic/private` which honors the
// PUBLIC_/private boundary and works across Node/Edge runtimes. Direct
// `process.env` access is avoided so this hook works on Cloudflare Workers
// / Deno Deploy / other non-Node runtimes (with appropriate adapter).

import type { Handle } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import {
	_ensureValidated,
	type ProductionConfigEnv,
} from "$lib/env/production-config";

export interface AuthUser {
	readonly email: string;
	readonly parentId: string;
}

declare module "@sveltejs/kit" {
	interface Locals {
		user: AuthUser | null;
	}
}

// One-shot boot warning: emit at module init so it lands in the server log
// before any request, NOT inside `handle` (which runs per request).
assertResendKeyOrBootWarn(globalThis.process?.env ?? {});

/**
 * Read the relevant env vars via SvelteKit's `$env/dynamic/private`. This
 * gives us proper PUBLIC_/private boundary enforcement and lets the gate
 * work in non-Node runtimes (Cloudflare Workers, Deno Deploy).
 *
 * Pulled into a helper so tests can stub the env without needing the full
 * `$env/dynamic/private` module mock.
 */
function readEnv(): ProductionConfigEnv {
	// `$env/dynamic/private` returns a plain object — narrow to our subset.
	const e = privateEnv as Record<string, string | undefined>;
	return {
		NODE_ENV: e.NODE_ENV,
		STORYBOOK_DEV_BYPASS_AUTH: e.STORYBOOK_DEV_BYPASS_AUTH,
		STRIPE_SECRET_KEY: e.STRIPE_SECRET_KEY,
		STRIPE_WEBHOOK_SECRET: e.STRIPE_WEBHOOK_SECRET,
		LULU_CLIENT_ID: e.LULU_CLIENT_ID,
		LULU_CLIENT_SECRET: e.LULU_CLIENT_SECRET,
		LULU_WEBHOOK_SECRET: e.LULU_WEBHOOK_SECRET,
		OPS_API_TOKEN: e.OPS_API_TOKEN,
		RESEND_API_KEY: e.RESEND_API_KEY,
	};
}

export const handle: Handle = async ({ event, resolve }) => {
	// Validate production config on every request. The latch inside
	// `_ensureValidated` makes the post-success path O(1) (a single boolean
	// check) and re-fires the validator on every request until validation
	// succeeds. Throws ProductionConfigError on fatal misconfiguration.
	_ensureValidated(readEnv());

	// STUB: no session lookup yet. event.locals.user stays null unless
	// dev-bypass env flag is set (the endpoint handles that fallback).
	event.locals.user = null;
	return resolve(event);
};

/**
 * Helper used by security-sensitive endpoints to resolve the acting parent's
 * email. Prefers session-derived identity; falls back to body in DEV bypass.
 * Returns a string on success, or an error object the endpoint should JSON-back.
 */
export interface ResolvedParent {
	readonly email: string;
	readonly source: "session" | "dev_bypass_body";
}

export interface AuthError {
	readonly error: "auth_required" | "auth_bypass_misconfigured";
	readonly hint?: string;
}

/**
 * Truthy-string detector for the dev-bypass flag — mirrors
 * `_devBypassEnabled` from production-config.ts so both gates accept the
 * same operator-friendly variants (`true`, `yes`, `on`, etc.) and reject
 * the same explicit-off values (`false`, `0`, `no`).
 */
function bypassEnabled(raw: string | undefined): boolean {
	if (typeof raw !== "string") return false;
	const v = raw.trim();
	if (v.length === 0) return false;
	const off = new Set(["0", "false", "no", "off", "disable", "disabled"]);
	if (off.has(v.toLowerCase())) return false;
	return true;
}

export function resolveParentEmail(
	sessionUser: AuthUser | null,
	bodyEmail: string | undefined,
	env: { NODE_ENV?: string; STORYBOOK_DEV_BYPASS_AUTH?: string },
): ResolvedParent | AuthError {
	if (sessionUser?.email) {
		return { email: sessionUser.email, source: "session" };
	}
	const inProd = env.NODE_ENV === "production";
	const bypassAllowed = bypassEnabled(env.STORYBOOK_DEV_BYPASS_AUTH);
	if (inProd && bypassAllowed) {
		return {
			error: "auth_bypass_misconfigured",
			hint: "STORYBOOK_DEV_BYPASS_AUTH must NOT be set in production. Wire real session auth before deploy.",
		};
	}
	if (!bypassAllowed) {
		return {
			error: "auth_required",
			hint: "No session detected and STORYBOOK_DEV_BYPASS_AUTH not set. Wire src/hooks.server.ts handle to populate event.locals.user OR set the dev-bypass env var for local testing.",
		};
	}
	// Dev bypass: accept body email but require it to be present + look like an email.
	if (!bodyEmail || typeof bodyEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bodyEmail)) {
		return { error: "auth_required", hint: "Dev bypass requires a valid parentEmail in the request body." };
	}
	// Structured log line (per minor concern): JSON-prefixed payload so
	// downstream log aggregators can parse it without regex gymnastics.
	// eslint-disable-next-line no-console
	console.warn(
		`[storybook-workshop] AUTH BYPASS: accepting parentEmail="${bodyEmail}" from request body. ` +
			`This is unsafe in production. Wire real session auth. ` +
			`structured=${JSON.stringify({ event: "auth_bypass", email: bodyEmail, source: "dev_bypass_body" })}`,
	);
	return { email: bodyEmail, source: "dev_bypass_body" };
}

// ---------------------------------------------------------------------------
// CRM-Resend boot warning
// ---------------------------------------------------------------------------

/** Env vars consulted by the boot warning. Exposed for tests. */
export interface ResendBootEnv {
	readonly RESEND_API_KEY?: string;
	readonly NODE_ENV?: string;
	readonly VITEST?: string;
	readonly STORYBOOK_SKIP_RESEND_BOOT_CHECK?: string;
}

/** Result returned to tests so the boot path can be exercised without side effects. */
export type ResendBootCheck =
	| { readonly outcome: "ok"; readonly reason: "key_present" }
	| { readonly outcome: "skipped"; readonly reason: "test_env" | "explicit_skip" }
	| { readonly outcome: "warn"; readonly reason: "missing_in_dev"; readonly hint: string }
	| { readonly outcome: "warn"; readonly reason: "missing_in_prod"; readonly hint: string };

/**
 * Emit a one-shot warning when `RESEND_API_KEY` is missing outside the
 * test/vitest environment. Production gets a louder message; dev gets a hint.
 * Returns the decision so unit tests can assert without snooping on the
 * console (the function still console.warns for the real boot path).
 */
export function assertResendKeyOrBootWarn(
	env: ResendBootEnv,
	logger: (msg: string) => void = (m) => console.warn(m),
): ResendBootCheck {
	if (env.STORYBOOK_SKIP_RESEND_BOOT_CHECK === "1") {
		return { outcome: "skipped", reason: "explicit_skip" };
	}
	if (env.VITEST === "true" || env.NODE_ENV === "test") {
		return { outcome: "skipped", reason: "test_env" };
	}
	const hasKey = typeof env.RESEND_API_KEY === "string" && env.RESEND_API_KEY.length > 0;
	if (hasKey) {
		return { outcome: "ok", reason: "key_present" };
	}
	const isProd = env.NODE_ENV === "production";
	if (isProd) {
		const hint =
			"[storybook-workshop] RESEND_API_KEY is UNSET in production. " +
			"Transactional emails (paid/printed/shipped/delivered/failed) will silently no-op via NoopEmailProvider. " +
			"Set RESEND_API_KEY before any real customer order, or set STORYBOOK_SKIP_RESEND_BOOT_CHECK=1 to acknowledge.";
		logger(hint);
		return { outcome: "warn", reason: "missing_in_prod", hint };
	}
	const hint =
		"[storybook-workshop] RESEND_API_KEY is unset (dev). Order lifecycle emails will not actually send. " +
		"Wire RESEND_API_KEY (or STORYBOOK_SKIP_RESEND_BOOT_CHECK=1) before testing the email path.";
	logger(hint);
	return { outcome: "warn", reason: "missing_in_dev", hint };
}
