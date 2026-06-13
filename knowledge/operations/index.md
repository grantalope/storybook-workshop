# Operations

* [Run the Demo Server](/operations/run-the-demo.md) - Build and restart the live demo at http://100.104.9.90:8790 from the storybook-workshop worktree.
* [Acceptance Gates](/operations/acceptance-gates.md) - 11-gate CI suite run via node scripts/gates/run-all.mjs; must pass before any demo deploy.
* [Playwright MCP Gotchas](/operations/playwright-gotchas.md) - Known flakiness patterns and workarounds for driving the storybook demo via Playwright MCP.
* [Plain HTTP Constraints (Non-Secure Context)](/operations/plain-http-constraints.md) - Tailscale demo runs plain HTTP — crypto.randomUUID and crypto.subtle are undefined; only getRandomValues available.
