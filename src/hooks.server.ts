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

import type { Handle } from "@sveltejs/kit";

export interface AuthUser {
	readonly email: string;
	readonly parentId: string;
}

declare module "@sveltejs/kit" {
	interface Locals {
		user: AuthUser | null;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
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

export function resolveParentEmail(
	sessionUser: AuthUser | null,
	bodyEmail: string | undefined,
	env: { NODE_ENV?: string; STORYBOOK_DEV_BYPASS_AUTH?: string },
): ResolvedParent | AuthError {
	if (sessionUser?.email) {
		return { email: sessionUser.email, source: "session" };
	}
	const inProd = env.NODE_ENV === "production";
	const bypassAllowed = env.STORYBOOK_DEV_BYPASS_AUTH === "1";
	if (inProd && bypassAllowed) {
		return {
			error: "auth_bypass_misconfigured",
			hint: "STORYBOOK_DEV_BYPASS_AUTH=1 must NOT be set in production. Wire real session auth before deploy.",
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
	// eslint-disable-next-line no-console
	console.warn(
		`[storybook-workshop] AUTH BYPASS: accepting parentEmail="${bodyEmail}" from request body. ` +
			`This is unsafe in production. Wire real session auth.`,
	);
	return { email: bodyEmail, source: "dev_bypass_body" };
}
