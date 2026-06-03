# Production Deploy Checklist — Storybook Workshop

> Read this BEFORE flipping the marketing funnel live. Several of these
> env vars cause `fail-closed` behavior (HTTP 401 / 503) when unset; that
> is a deliberate security posture, not a bug.

## Required environment variables

| Var | Purpose | Failure when missing |
|---|---|---|
| `STORYBOOK_EMAIL_GATE_SECRET` | HMAC key for gate cookie + unsubscribe token. Minimum 8 chars; recommend 32+ random bytes hex. | Marketing-funnel endpoints throw at first use. App boots but the gate/unsub API returns 503 on every call. |
| `CRON_SECRET` | Bearer-token auth for `/api/marketing/lifecycle-tick` and `/api/marketing/abandoned-cart-tick`. | All cron-tick calls return 401 (`reason: cron_secret_unconfigured`). No lifecycle emails fire. |
| `RESEND_API_KEY` OR `POSTMARK_SERVER_TOKEN` | Outbound email provider. | App falls back to MockCrmClient — no real emails go out, but the app keeps running. |
| `RESEND_FROM` / `POSTMARK_FROM` | From-address for outbound mail. | Defaults to `noreply@storybook.example` (invalid). Set to a sender you control. |
| `NODE_ENV=production` | Activates the production fail-closed paths. | Code paths that gate on `isProduction()` will believe they are in dev. |

## Pre-deploy steps

1. Generate `STORYBOOK_EMAIL_GATE_SECRET`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Generate `CRON_SECRET` the same way.
3. Provision `RESEND_API_KEY` from the Resend dashboard.
4. Set up DNS for the `RESEND_FROM` sender domain (SPF + DKIM).
5. Configure the platform cron to POST to:
   - `https://<host>/api/marketing/lifecycle-tick` — recommended hourly
   - `https://<host>/api/marketing/abandoned-cart-tick` — recommended every 15 min
   - both with header `Authorization: Bearer <CRON_SECRET>`
6. Verify the deploy serves HTTPS — the gate + referral cookies only set
   the `Secure` flag when the request URL protocol is `https:`.

## Post-deploy smoke

```bash
# 1. Lifecycle-tick rejects unauthenticated calls
curl -i -X POST https://<host>/api/marketing/lifecycle-tick
# Expect: HTTP/2 401 + body {"error":"unauthorized","reason":"missing_authorization"}

# 2. Lifecycle-tick accepts the configured secret
curl -i -X POST https://<host>/api/marketing/lifecycle-tick \
  -H "Authorization: Bearer <CRON_SECRET>"
# Expect: HTTP/2 200 + body {"ok":true,"report":{...}}

# 3. Unsubscribe rejects token-less hits
curl -i "https://<host>/api/marketing/unsubscribe?email=x@example.com&type=marketing"
# Expect: HTTP/2 401 + body {"error":"missing_token"}
```

## Known v1 gaps (track and address in future deploys)

- **Persistence**: `EmailGateService._contacts`, `_cookies`, `_firstTimeRedeemed`,
  `AbandonedCartService._carts`, `ReferralLinkService._shortcodes` etc. live
  in-memory. App restart wipes them. Acceptable for the single-instance v1
  deploy; multi-instance / cross-restart durability is tracked in a future
  goal (planned: Postgres + per-key TTLs).
- **`gateRateLimit` is per-instance**. Behind a load balancer the per-IP
  budget multiplies by the instance count. Move to a Redis-backed limiter
  before scaling beyond a single instance.
