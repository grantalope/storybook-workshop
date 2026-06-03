# Production Deploy Guide

> Authoritative reference for deploying Storybook Workshop to production.
> Read top-to-bottom on first deploy and any time you onboard a new env.

This document covers:

- The **boot-time deploy contract** enforced by `ensureProductionConfig()`
- The **environment variable reference** (required vs optional vs gated)
- The **deploy checklist** to run before flipping DNS
- **Recipes** for wiring real session auth (cookie JWT, Auth0, Clerk, Supabase)
- **Operational notes** (webhook secrets, OAuth2 token rotation, rate-limits)

---

## 1. Boot-time deploy contract

`src/lib/env/production-config.ts` exports `ensureProductionConfig(env)` plus a
latch helper `_ensureValidated(env)`, called from `src/hooks.server.ts` on
every request.

### Behavior

- `NODE_ENV !== "production"` (after trim) → no gates run; returns empty findings.
- NODE_ENV variants that LOOK like production (`Production`, `PROD`, `prod`,
  `/^prod/i`) → treated as non-production but emit a loud warn finding
  (`node_env_looks_like_production`) so misspellings are visible at boot.
- `NODE_ENV === "production"`:
  - **Fatal** findings throw `ProductionConfigError`. The latch only flips on
    a successful validation, so misconfigured deploys throw on **every
    request** until the operator fixes the env and restarts the process.
    There is no partial-failure mode where the server starts serving after
    the first throw.
  - **Warn** findings are logged via the injected sink (`console.warn` by
    default). Execution continues with degraded behavior.

### Fatal findings (server WILL NOT start)

| Code | Cause |
|---|---|
| `dev_bypass_in_production` | `STORYBOOK_DEV_BYPASS_AUTH` set to ANY truthy value (`1`, `true`, `yes`, `TRUE`, `on`, etc.) with `NODE_ENV=production`. This flag accepts attacker-controlled `parentEmail` from request bodies. NEVER set it in production. Only explicit-off values (`0`, `false`, `no`, `off`, `disable`) are treated as not-set. |
| `missing_stripe_secret` | `STRIPE_SECRET_KEY` is empty/unset. Payment creation is impossible. |
| `missing_stripe_webhook_secret` | `STRIPE_WEBHOOK_SECRET` is empty/unset. All incoming Stripe webhooks would be rejected, stalling every order at `pending_payment`. |
| `missing_lulu_client_id` | `LULU_CLIENT_ID` is empty/unset. Lulu OAuth2 token acquisition will fail. |
| `missing_lulu_client_secret` | `LULU_CLIENT_SECRET` is empty/unset. Same impact as above. |
| `missing_lulu_webhook_secret` | `LULU_WEBHOOK_SECRET` is empty/unset. All incoming Lulu webhooks would fail HMAC verification and be rejected, stalling every order at `submitted_to_lulu`. |

### Warn findings (server starts, functionality degrades)

| Code | Cause | Impact |
|---|---|---|
| `missing_resend_api_key` | `RESEND_API_KEY` empty/unset | Order/shipment emails not delivered; falls back to `LoggingEmailProvider` in-memory. |
| `node_env_looks_like_production` | `NODE_ENV=Production` / `PROD` / `prod` / etc. | Production-like NODE_ENV that does not exactly match `production` skips ALL gates. Misspelling caught by a loud warn so it's visible at boot. |

### Out of scope

The gate **does not** validate the session-auth integration's secrets
(`JWT_SIGNING_SECRET`, `AUTH0_*`, `CLERK_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`). The §3 deploy checklist below explicitly
includes per-recipe auth-secret verification. A follow-up goal will add an
`AUTH_PROVIDER` env var that lets the gate verify the chosen recipe's
required secrets automatically — until then it is the operator's
responsibility per Recipe A/B/C/D.

---

## 2. Environment variable reference

### Required in production (fatal if missing)

| Variable | Used by | Format | Notes |
|---|---|---|---|
| `NODE_ENV` | All | exactly `production` | Misspellings (`Production`, `PROD`, `prod`) emit a loud warn but skip gates — use exactly `production` to enable. |
| `STRIPE_SECRET_KEY` | `StripeCheckoutService` | `sk_live_...` | Use the **live** key — `sk_test_...` is fine for staging only. |
| `STRIPE_WEBHOOK_SECRET` | `/api/stripe-webhook` | `whsec_...` | Required to accept ANY Stripe webhook. Without it, every webhook is rejected. |
| `LULU_CLIENT_ID` | `LuluFulfillmentService` | OAuth2 client id | From Lulu Direct dashboard → API credentials. |
| `LULU_CLIENT_SECRET` | `LuluFulfillmentService` | OAuth2 client secret | Same source as above. Rotate every 90 days. |
| `LULU_WEBHOOK_SECRET` | `/api/lulu-webhook` | hex string | Required to accept ANY Lulu webhook. Without it, every webhook fails HMAC. |

### Strongly recommended (warns if missing)

| Variable | Used by | Format | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | `ResendEmailProvider` | `re_...` | Optional but parents won't get order confirmations without it. `POSTMARK_API_KEY` is an equivalent alternative. |

### Dev / test only — MUST NOT be set in production

| Variable | Effect |
|---|---|
| `STORYBOOK_DEV_BYPASS_AUTH` | Any truthy value (`1`, `true`, `yes`, `on`, etc.) accepts `parentEmail` from request bodies. Production gate refuses to start if both this AND `NODE_ENV=production` are set. Explicit-off (`0`, `false`, `no`, `off`) is treated as not-set. |

### Session-auth recipe secrets (gate does NOT validate; YOU must)

Each Recipe in §4 has its own required env vars. The boot gate does not
inspect these — the §3 checklist below has a per-recipe verification step.

| Recipe | Required env vars |
|---|---|
| Recipe A — Cookie JWT | `JWT_SIGNING_SECRET` (≥ 256 bits) |
| Recipe B — Auth0 | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` |
| Recipe C — Clerk | `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |
| Recipe D — Supabase | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

### Optional / runtime tunables

| Variable | Default | Effect |
|---|---|---|
| `LULU_API_BASE` | `https://api.sandbox.lulu.com/print-jobs` | Override only when pointing at Lulu staging vs production. |
| `CANCEL_WINDOW_MS` | `4500000` (75min) | Pre-production cancel window. Increase only with ops sign-off. |
| `DEFAULT_CURRENCY` | `USD` | ISO-4217 currency code applied to PaymentIntents and Lulu print jobs. |

---

## 3. Deploy checklist

Run this top-to-bottom before flipping DNS or accepting the first paying customer.

### Pre-deploy

- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] `pnpm test` is green (≥ 741 tests).
- [ ] `pnpm exec svelte-check` produces no new errors over baseline.
- [ ] `pnpm build` produces a clean `.svelte-kit/output/`.
- [ ] All **six** fatal env vars set: `NODE_ENV=production`,
      `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LULU_CLIENT_ID`,
      `LULU_CLIENT_SECRET`, `LULU_WEBHOOK_SECRET`.
- [ ] `STORYBOOK_DEV_BYPASS_AUTH` is **unset** OR explicitly set to a
      no-value (`0` / `false` / `no` / `off`).
- [ ] `NODE_ENV` is exactly `production` (lowercase, no whitespace). If
      you see a `node_env_looks_like_production` warn in logs, fix the
      value — gates are NOT enforcing yet.
- [ ] `RESEND_API_KEY` set OR explicit decision to ship without emails
      logged in the deploy ticket.
- [ ] Stripe dashboard webhook endpoint configured + `STRIPE_WEBHOOK_SECRET` matches.
- [ ] Lulu Direct dashboard webhook endpoint configured + `LULU_WEBHOOK_SECRET` matches.
- [ ] Session auth wired in `src/hooks.server.ts` (see Recipes below).
      `event.locals.user` populated on every authenticated request.
- [ ] **Per-recipe auth secret verification (gate doesn't catch this):**
  - [ ] Recipe A — `JWT_SIGNING_SECRET` set and ≥ 256 bits; verify with a
        smoke-test JWT round-trip.
  - [ ] Recipe B — all three Auth0 secrets set; verify by completing a
        login + checking `event.locals.user.email` is populated on `/api/order`.
  - [ ] Recipe C — Clerk publishable + secret keys set; verify the same way.
  - [ ] Recipe D — Supabase URL/anon-key/service-role-key set; verify the same way.

### Post-deploy smoke

- [ ] First `GET /` returns 200.
- [ ] Logs show NO `[production-config]` warn lines (or only ones you explicitly accepted).
- [ ] Logs show NO `[storybook-workshop] AUTH BYPASS` lines (these indicate the dev-bypass path fired).
- [ ] Test order flow end-to-end:
  - [ ] Create order via `/api/order` with a real authenticated session.
  - [ ] Verify Stripe PaymentIntent appears in dashboard.
  - [ ] Webhook fires + order advances to `paid`.
  - [ ] Lulu print job submits + order advances to `submitted_to_lulu`.
  - [ ] Cancel before 75min works; cancel after 75min refuses.
- [ ] Test webhook signature failure path returns 401, never 200.
- [ ] Test missing-session path on `/api/order` returns 401, never 200.

---

## 4. Session auth integration recipes

The shipped `src/hooks.server.ts` is a STUB. Pick the recipe matching your
chosen identity provider, replace the stub `handle`, and verify
`event.locals.user` is set before any `/api/order` or `/api/quality-claim`
hits the handler.

All recipes use SvelteKit's `$env/static/private` / `$env/static/public`
imports rather than raw `process.env` access — this makes the
PUBLIC_/private boundary visible at the import statement and gives you a
build-time error if a private secret accidentally appears in a public bundle.

### Recipe A — Cookie JWT (self-hosted)

For deploys that own their own user table and want a minimal-dependency setup.

```ts
// src/hooks.server.ts
import { verify } from "jsonwebtoken"; // add as a dep
import { JWT_SIGNING_SECRET } from "$env/static/private";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  // (production-config gate still runs — keep _ensureValidated)

  const token = event.cookies.get("session");
  event.locals.user = null;
  if (token) {
    try {
      const claims = verify(token, JWT_SIGNING_SECRET) as { email: string; sub: string };
      event.locals.user = { email: claims.email, parentId: claims.sub };
    } catch {
      // tampered / expired token → leave user=null and let endpoint reject
    }
  }
  return resolve(event);
};
```

Required env vars: `JWT_SIGNING_SECRET` (≥ 256 bits, rotated quarterly).

### Recipe B — Auth0

```ts
// src/hooks.server.ts
import { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE } from "$env/static/private";
import { auth0Client } from "$lib/auth0"; // wrapper around @auth0/auth0-spa-js or node-jsonwebtoken + jwks-rsa
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  const idToken = event.cookies.get("auth0_id_token");
  event.locals.user = null;
  if (idToken) {
    const verified = await auth0Client.verifyIdToken(idToken); // throws on invalid
    if (verified) {
      event.locals.user = {
        email: verified.email,
        parentId: verified.sub, // "auth0|abc123"
      };
    }
  }
  return resolve(event);
};
```

Required env vars: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`.
Recommend Auth0 Universal Login at `/login` + post-login redirect to `/`.

### Recipe C — Clerk

Clerk ships SvelteKit middleware via `@clerk/sveltekit`.

```ts
// src/hooks.server.ts
import { withClerkHandler } from "@clerk/sveltekit/server";
import { CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY } from "$env/static/private";
import type { Handle } from "@sveltejs/kit";

const clerk: Handle = withClerkHandler();

export const handle: Handle = async (input) => {
  // production-config gate runs INSIDE a wrapping Handle (compose with sequence)
  return clerk(input);
};

// Then in endpoints: `event.locals.auth.userId` is the Clerk id.
// Adapt to AuthUser shape:
// event.locals.user = { email: ..., parentId: event.locals.auth.userId }
```

Required env vars: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`. See
Clerk dashboard for webhook setup if you want sync events.

### Recipe D — Supabase auth

PUBLIC_ env vars are imported from `$env/static/public` so the public-ness
is visible at the import line (critical: the `PUBLIC_` prefix makes these
available to the BROWSER bundle, so server code that reads them needs the
explicit boundary marker). Private secrets come from `$env/static/private`.

```ts
// src/hooks.server.ts
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public";
import { SUPABASE_SERVICE_ROLE_KEY } from "$env/static/private";
import { createServerClient } from "@supabase/ssr";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => event.cookies.getAll(),
        setAll: (cookies) =>
          cookies.forEach(({ name, value, options }) =>
            event.cookies.set(name, value, { ...options, path: "/" })
          ),
      },
    }
  );

  const { data: { user } } = await event.locals.supabase.auth.getUser();
  event.locals.user = user?.email
    ? { email: user.email, parentId: user.id }
    : null;

  return resolve(event);
};
```

Required env vars: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
plus `SUPABASE_SERVICE_ROLE_KEY` (server-only) if you need to bypass RLS.

---

## 5. Operational notes

### Webhook secret rotation

When rotating `STRIPE_WEBHOOK_SECRET` or `LULU_WEBHOOK_SECRET`:

1. Add the new secret to the env (no app restart needed — the value is
   read on each verification call).
2. Configure the new secret in the provider dashboard.
3. Tail logs for `webhook_signature_invalid` errors during the rollover
   window (~5min).
4. Remove the old secret once no errors observed for ≥ 1hr.

### OAuth2 token cache

`LuluFulfillmentService` caches the OAuth2 access token in a module-scoped
variable, refreshing 60s before `expires_at`. The cache is per-process —
horizontal scaling will get a token per worker, well within Lulu's rate
limits.

If you see `lulu_oauth_failure` errors after a credential rotation: the
old token is cached for up to `tokenLifetime - 60s`. Either wait it out
or restart the process to invalidate the cache.

### Rate limits & backpressure

- Stripe: 100 req/s per account; we make 1 req per order at create time
  plus 1 per refund. Headroom is comfortable up to ~5000 orders/day.
- Lulu: rate-limited per OAuth2 token; we serialize submissions via the
  injected HTTP client and respect 429 retry-after.
- Resend: 10 req/s for new accounts; batch confirmation emails if you
  approach this volume.

### Supported runtimes

Validated on **Node 20+**. The boot gate reads env vars via
`$env/dynamic/private`, which works on:

- Node + adapter-node — primary supported target.
- Vercel / Netlify adapter — same Node runtime under the hood.
- Cloudflare Workers / Deno Deploy — `$env/dynamic/private` is supported
  by the SvelteKit adapter; runtime not yet validated by us. The previous
  raw-`process.env` shape silently degraded to empty env on these
  runtimes (skipping all gates); the `$env/dynamic/private` shape forces
  the adapter to surface env vars correctly.

### Logs to monitor

- `[production-config] *` — env misconfig warnings; should be zero in prod.
- `[storybook-workshop] AUTH BYPASS *` — dev-bypass path fired; should be zero in prod.
- `webhook_signature_invalid` — wrong secret or replay attack; investigate.
- `lulu_oauth_failure` — bad creds or rotated key; restart or rotate.
- `price_mismatch` from `/api/order` — client tampering attempt; rate-limit by IP.

---

## 6. Disaster recovery

| Scenario | Recovery |
|---|---|
| Server won't start, throws `ProductionConfigError` on every request | Read `err.findings` from logs; set the missing env vars; restart. The gate re-fires on every request until validation succeeds — there is no half-validated state. |
| Stripe webhook rejecting all events | Rotate `STRIPE_WEBHOOK_SECRET`; replay last 24h of events from Stripe dashboard. |
| Lulu print jobs never submit | Check `lulu_oauth_failure` in logs; rotate `LULU_CLIENT_SECRET` if creds compromised. |
| Order stuck in `pending_payment` for > 1hr | Stripe webhook never fired; check Stripe webhook delivery in dashboard + retry. |
| Email confirmations not arriving | `RESEND_API_KEY` unset or invalid; check `LoggingEmailProvider.messages` in-process for replay. |

---

## See also

- `src/lib/env/production-config.ts` — the validator implementation.
- `src/hooks.server.ts` — the caller.
- `SECURITY.md` — vulnerability disclosure contact + audit log.
- `docs/specs/2026-05-24-design.md` §5 (fulfillment) + §10 (deploy).
