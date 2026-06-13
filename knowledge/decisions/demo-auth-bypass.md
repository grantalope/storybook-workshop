---
type: Decision
title: Demo Auth Bypass via STORYBOOK_DEV_BYPASS_AUTH
description: The demo has no login UI; order APIs accept the request body email when the bypass env var is set, with a hard production guard.
tags: [auth, demo, env, security, api]
timestamp: 2026-06-12T00:00:00Z
status: enforced
path: src/routes/api/
---

# Decision

The demo experience has **no login screen**. Rather than blocking the order API on authentication, a dev-only bypass is provided:

```
STORYBOOK_DEV_BYPASS_AUTH=1
```

When this env var is set, `resolveParentEmail` accepts the email supplied in the **request body** instead of reading it from a session cookie or JWT.

# Why

- The demo URL is shared with prospective users who have no accounts. Requiring login would block the entire demo flow.
- The alternative (hardcoding a demo user) is fragile and leaks a real email into logs.
- A request-body email makes the demo self-contained: the landing page collects the user's email and passes it through the order flow without any server-side session.

# Production Guard

A guardrail in `resolveParentEmail` (or its calling route handler) returns **HTTP 500** if both conditions are true:

```ts
if (process.env.STORYBOOK_DEV_BYPASS_AUTH === '1' && process.env.NODE_ENV === 'production') {
  throw new Error('Dev auth bypass must not be set in production');
}
```

This ensures the bypass **cannot leak to a real production deployment** even if a misconfigured environment accidentally sets the var.

# Implementation Notes

- The env var is checked at **request time**, not at build time, so a misconfigured prod server fails loudly on the first request rather than silently accepting bogus auth.
- The bypass is only active in the order API path. All other authenticated endpoints remain protected.
- For CI/test environments, `STORYBOOK_DEV_BYPASS_AUTH=1` is set alongside `NODE_ENV=test` (not `production`), so the guard does not fire.

# Related

- [Fulfillment Order Architecture](/architecture/fulfillment-order.md)
- The demo landing page email collection form feeds directly into this bypass path.

# Alternative Rejected

**Mock auth middleware**: a fake session provider that returns a fixed demo user. Rejected because it requires maintaining a separate auth code path and makes it harder to audit whether real auth is active in a given environment. The env-var approach is a single well-documented toggle.

**Magic link sent to demo email**: requires a working email delivery service in demo environments. Adds infra complexity for a flow that should have zero friction.
