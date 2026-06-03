// src/env-augment.d.ts
//
// Augment `$env/static/public` so the static TypeScript checker
// (`svelte-check`) knows which `PUBLIC_*` vars our code declares.
// SvelteKit auto-generates `.svelte-kit/ambient.d.ts` with an
// EMPTY `declare module '$env/static/public' {}` — only vars present
// in `.env` at sync time get exported there, so any unset (but
// referenced) var fails the type check.
//
// We declare `PUBLIC_STRIPE_PUBLISHABLE_KEY` as `string` here so the
// `StripeElementsLoader.readPublishableKey()` import resolves
// statically. At RUNTIME the value comes from either the SvelteKit
// build-time `$env/static/public` resolution OR (under vitest) the
// `src/test-stubs/$env/static/public.ts` alias.

declare module '$env/static/public' {
	export const PUBLIC_STRIPE_PUBLISHABLE_KEY: string;
}
