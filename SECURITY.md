# Security Policy

## Reporting a Vulnerability

Email security@storybook.example with a description of the issue and steps
to reproduce. We will acknowledge within 48 hours.

## Marketing-funnel Hardening Checklist (Production)

The marketing-funnel subsystem (email gate, lifecycle drip, abandoned-cart
recovery, referral attribution, promo codes) has the following invariants
that MUST hold in production:

1. **`STORYBOOK_EMAIL_GATE_SECRET`** must be set to a >= 8 char secret.
   The HMAC keyed by this secret authenticates both the email-gate cookie
   AND the per-recipient unsubscribe token. If unset, the server throws on
   first use (fail-closed).
2. **`CRON_SECRET`** must be set to a >= 8 char secret. The lifecycle-tick
   and abandoned-cart-tick endpoints reject any caller that does not present
   `Authorization: Bearer <CRON_SECRET>`. In production, the endpoints
   fail-closed when CRON_SECRET is unset.
3. **`RESEND_API_KEY`** OR **`POSTMARK_SERVER_TOKEN`** must be set. Without
   one of these the funnel falls back to the in-memory `MockCrmClient` and
   no real emails are sent.
4. Cookies set by the gate (`swEmailGate_<shortcode>`) and referral
   (`swReferral`) endpoints carry the `Secure` flag when the request URL is
   `https:`. Production deploys MUST terminate TLS upstream of SvelteKit.
5. The unsubscribe endpoint (`/api/marketing/unsubscribe`) requires a
   per-recipient HMAC token in the `?token=` query parameter (or POST body).
   The footer link emitted by every marketing/educational email carries
   this token. Direct hits without the token are 401 — prevents victim
   unsubscription via email-only enumeration.
6. Per-IP rate limits guard `/api/marketing/email-gate` (10/hour),
   `/api/marketing/promo/[code]` (30/hour), `/api/marketing/referral/...`
   (60/hour), and `/api/marketing/cart-abandoned` (10/hour).
7. Promo-code validation when called with a `shortcode` body field
   AND a `swEmailGate_<shortcode>` cookie verifies the cookie's email
   matches the body's `parentEmail`. Rejects attacker-with-victim-cookie.

See `docs/production-deploy.md` for the deploy checklist.
