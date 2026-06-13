---
type: Runbook
title: Run the Demo Server
description: Build and restart the live demo at http://100.104.9.90:8790 from the storybook-workshop worktree.
tags: [demo, deploy, node, adapter-node]
timestamp: 2026-06-13T00:00:00Z
path: ~/devbox/storybook-workshop-probe-regression
branch: feat/demo-site
port: 8790
---

# Run the Demo

Live demo: `http://100.104.9.90:8790`  
Worktree: `~/devbox/storybook-workshop-probe-regression` (branch `feat/demo-site`)  
Runtime: Node 22 via nvm (`/home/grantalope/.nvm/versions/node/v22.22.3/bin/node`)  
Adapter: `adapter-node` (SvelteKit)

## Build

```bash
cd ~/devbox/storybook-workshop-probe-regression
PUBLIC_STRIPE_PUBLISHABLE_KEY= pnpm build
```

Stripe key intentionally blank for demo.

## Restart

```bash
# Kill whatever holds 8790
fuser -k 8790/tcp
sleep 1

# Start with auth bypass
setsid env PORT=8790 HOST=0.0.0.0 STORYBOOK_DEV_BYPASS_AUTH=1 \
  /home/grantalope/.nvm/versions/node/v22.22.3/bin/node build \
  >/tmp/storybook-demo-server.log 2>&1 </dev/null &

# Verify alive
sleep 3
curl -sf http://100.104.9.90:8790/ | head -5
```

`STORYBOOK_DEV_BYPASS_AUTH=1` is mandatory — omitting it blocks all routes. See [auth bypass decision](/decisions/demo-auth-bypass.md).

## CRITICAL: Rebuild -> must restart

If `build/` changes while server runs: lazily-loaded route modules mismatch loaded manifest -> HTTP 500 on any non-root route. **Always restart after rebuild.** Sequence is always: build -> kill -> start -> verify.

## Verify

```bash
curl -sf http://100.104.9.90:8790/
# Expect: HTML with <title> from app

tail -20 /tmp/storybook-demo-server.log
# Expect: Listening on 0.0.0.0:8790
```

## Acceptance gates

Before demo: run [acceptance gates](/operations/acceptance-gates.md). All 11 must pass (or gate-specific WARN threshold met).

## Related

- [Acceptance Gates](/operations/acceptance-gates.md)
- [Demo Auth Bypass Decision](/decisions/demo-auth-bypass.md)
- [Plain HTTP Constraints](/operations/plain-http-constraints.md)
- [Playwright Gotchas](/operations/playwright-gotchas.md)
