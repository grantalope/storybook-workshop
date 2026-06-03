// src/test-stubs/$env/dynamic/private.ts
//
// Test-only stub for SvelteKit's `$env/dynamic/private` module. Vitest
// resolves this via the `$env` alias in vitest.config.ts. Tests can
// mutate `env` directly to simulate different deploy environments.
//
// Mirrors the real SvelteKit module shape: exports a single `env` object
// whose properties are env vars (strings or undefined).

export const env: Record<string, string | undefined> = {};
