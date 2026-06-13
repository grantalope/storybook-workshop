# Decisions

* [No Ollama in Browser (Production Inference = In-App Only)](/decisions/no-ollama-in-browser.md) - Production inference runs in-browser via WebGPU->WASM->stub chain; Ollama is hard-blocked in shipped/browser builds.
* [Pure-JS Hashing and UUID for Non-Secure Contexts](/decisions/pure-js-hashing-and-uuid.md) - SHA-256 and UUID generation degrade gracefully when running in a plain-HTTP (non-secure) context where crypto.subtle is unavailable.
* [Svelte 5 Runes — All Rendered Mutable State Must Be $state()](/decisions/svelte5-runes-reactivity.md) - In a Svelte 5 runes component, plain `let` is NOT reactive; any mutable value that drives the DOM must be declared with $state().
* [Demo Auth Bypass via STORYBOOK_DEV_BYPASS_AUTH](/decisions/demo-auth-bypass.md) - The demo has no login UI; order APIs accept the request body email when the bypass env var is set, with a hard production guard.
* [Never Use git add -A — Stage Explicit Paths Only](/decisions/git-add-A-hazard.md) - git add -A captured working-tree deletions into a commit, silently deleting src/routes/demo/+page.svelte and 17 tests. Explicit path staging is now mandatory.
