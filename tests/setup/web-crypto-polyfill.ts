// vitest setup — polyfills + test-env config.
//
// 1. Node 18 vitest env lacks globalThis.crypto; polyfill via node:crypto.webcrypto.
//    (Production browser already has globalThis.crypto via Web Crypto API.)
import { webcrypto } from "node:crypto";
if (!(globalThis as { crypto?: unknown }).crypto) {
	(globalThis as { crypto?: unknown }).crypto = webcrypto as unknown;
}

// 2. Auth dev-bypass for the order endpoint security check.
//    Real production deployments wire SvelteKit handle hook → event.locals.user;
//    standalone repo tests run without that infrastructure. The dev-bypass flag
//    is GATED in resolveParentEmail to refuse if NODE_ENV=production (so a
//    misconfigured prod deploy fails closed).
//
//    Set explicitly per-test if you want to verify the auth-required path.
if (!process.env.STORYBOOK_DEV_BYPASS_AUTH) {
	process.env.STORYBOOK_DEV_BYPASS_AUTH = "1";
}
if (!process.env.NODE_ENV) {
	process.env.NODE_ENV = "test";
}
