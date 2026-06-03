# Security Policy

> Vulnerability reporting + audit log for Storybook Workshop.

---

## Reporting a vulnerability

If you believe you have found a security issue affecting Storybook Workshop,
please email **security@sharksnip.com** rather than opening a public GitHub
issue. We will acknowledge receipt within 48 hours and aim to provide a
status update within 5 business days.

Please include:

- A description of the vulnerability and its potential impact.
- Reproduction steps or a proof-of-concept (minimal, please — do not
  attempt to exploit production traffic or real customer data).
- The version / commit SHA of the codebase you tested against.
- Your contact information for follow-up questions.

We do **not** currently offer a bug bounty. We do credit reporters in the
audit log below unless they prefer to remain anonymous.

### Out of scope

- Theoretical attacks without a working PoC.
- Findings against forks, mirrors, or unrelated GitHub repos.
- Vulnerabilities in upstream dependencies that are already fixed in a
  newer published version (please open an issue or PR to bump instead).
- Denial-of-service attacks against the production deploy.

### Disclosure policy

We follow coordinated disclosure. Please give us a reasonable window
(typically 90 days) to ship a fix before publishing details. We will
work with you on a public-disclosure timeline that protects users.

---

## Audit log

A reverse-chronological list of resolved security findings. Each entry
links to the fix commit / PR.

### 2026-06-03 — Missing authentication on order creation (HIGH) — RESOLVED

**Finding.** `/api/order` accepted `parentEmail` from the request body
without verifying the caller's session. An attacker could create orders
attributed to arbitrary email addresses, breaking the parent-identity
contract that downstream services (quality claims, reissues, refunds,
shipment notifications) rely on.

**Resolution.** Introduced server-side `resolveParentEmail()` in
`src/hooks.server.ts`. The order endpoint now prefers
`event.locals.user.email` from the SvelteKit session and only falls back
to body-supplied email when `STORYBOOK_DEV_BYPASS_AUTH` is set to a
truthy value (dev only). Production deploys with the bypass flag set hit
the `auth_bypass_misconfigured` 500 — see also the
`dev_bypass_in_production` boot gate in
`src/lib/env/production-config.ts`.

Tests: `tests/fulfillment/security-fixes.test.ts`,
`tests/production-hardening.test.ts`,
`tests/production-hardening-hooks.test.ts`.

### 2026-06-03 — Server-side price tampering (CRITICAL) — RESOLVED

**Finding.** `/api/order` trusted client-supplied `bookCostCents`. An
attacker could craft a request with `bookCostCents: 1` and Stripe would
charge them one cent for a $29.99 hardcover; the fulfillment service
would then submit a full print job to Lulu, leaving us with the loss.

**Resolution.** Server now computes the authoritative price via
`priceForBook(format, pages)` in `src/lib/services/fulfillment/pricing.ts`.
Client-supplied `bookCostCents` is accepted only as a sanity-check value
and must match — mismatches return HTTP 400 `price_mismatch` and the
attempt is logged. The PaymentIntent is created with the server-computed
amount, never the client value.

Tests: `tests/fulfillment/security-fixes.test.ts`,
`tests/fulfillment/pricing.test.ts`.

### 2026-06-02 — `Math.random()` for security tokens (HIGH/MEDIUM) — RESOLVED

**Finding.** Several token generators used `Math.random()`: redeem codes
for gift subscriptions, referral shortcodes, and order id prefixes.
`Math.random()` is not a CSPRNG; the V8 implementation in particular is
deterministic given enough samples and could allow predicting valid
tokens.

**Resolution.** Introduced `secureRandomInt` /
`secureRandomString` in `src/lib/services/subscription/secureRandom`
backed by Web Crypto `getRandomValues` (browser + Node 19+, polyfilled
in vitest setup). All security-sensitive RNG call sites enumerated in
the audit (redeem codes, referral shortcodes, **order id `idGen` at
`src/routes/api/order/+server.ts`**) are migrated to the CSPRNG. Order
ids are an 8-char alphanumeric token over `secureRandomString` (~41-bit
entropy, well above the threshold for opportunistic enumeration).

A grep gate enumerates `Math.random()` use across `src/` and fails any
new introductions in security-adjacent code paths.

Tests: `tests/subscription/secure-random.test.ts`,
`tests/subscription/redeem-code-generator.test.ts`,
`tests/fulfillment/api-order-endpoint.test.ts` (order-id shape).

---

## Production deploy guarantees

The shipping production app enforces a boot-time deploy contract — see
`docs/production-deploy.md`. The server **refuses to start** under
`NODE_ENV=production` if any of the following hold:

- `STORYBOOK_DEV_BYPASS_AUTH` is set to any non-empty truthy value (`1`,
  `true`, `yes`, `on`, etc.) — auth bypass in production.
- `STRIPE_SECRET_KEY` is empty (payment integrity gate).
- `STRIPE_WEBHOOK_SECRET` is empty (Stripe webhooks would be rejected,
  every order stalls at `pending_payment`).
- `LULU_CLIENT_ID` is empty (fulfillment integrity gate).
- `LULU_CLIENT_SECRET` is empty (fulfillment integrity gate).
- `LULU_WEBHOOK_SECRET` is empty (Lulu webhooks would fail HMAC, every
  order stalls at `submitted_to_lulu`).

Misconfigured production deploys throw `ProductionConfigError` on
**every request** (not just the first) until the operator fixes the env
and restarts the process. The latch only flips after the first
successful validation — there is no partial-failure mode where the
server starts serving after the first throw.

This catches the three resolved findings above before they can re-emerge
in a misconfigured deploy.

### Out of scope for the boot gate

The gate **does not** validate session-auth integration secrets
(`JWT_SIGNING_SECRET`, `AUTH0_*`, `CLERK_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`). Each deploy chooses a recipe in
`docs/production-deploy.md` §4 and is responsible for verifying the
recipe's required secrets are set. A follow-up goal will add an
`AUTH_PROVIDER` env var that lets the gate verify the chosen recipe's
required secrets — until then, the §3 deploy checklist explicitly
includes the auth-secret verification step per recipe.

---

## See also

- `docs/production-deploy.md` — deploy checklist + env reference.
- `src/lib/env/production-config.ts` — the boot-time deploy contract.
- `CLAUDE.md` — repo conventions including the deploy contract section.
