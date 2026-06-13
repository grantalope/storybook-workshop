---
type: Service
title: Fulfillment & Order Flow
description: Station7TakeHome.svelte multi-phase checkout: shipping quote -> order creation -> Stripe payment -> confirmation.
tags: [checkout, stripe, shipping, order, api, auth]
timestamp: 2026-06-13T00:00:00Z
status: production
---

# Fulfillment Order Flow

Handles physical book checkout inside `Station7TakeHome.svelte`. Six sequential phases drive the UI state machine.

## Phase State Machine

```
choose -> address -> quote -> pay -> paying -> success
```

| Phase | What happens |
|---|---|
| `choose` | User picks print format + page count |
| `address` | Shipping address form |
| `quote` | POST /api/shipping-quote -> display carrier options |
| `pay` | Stripe Elements mount (or mock card UI) |
| `paying` | POST /api/order -> confirmCardPayment in flight |
| `success` | Order ID shown, confirmation email sent |

## Server Routes (SSR)

### POST /api/shipping-quote

Request body:
```json
{
  "shippingAddress": { "..." : "..." },
  "format": "hardcover | softcover | ...",
  "pages": 32
}
```

Response:
```json
{
  "options": [
    {
      "name": "Standard",
      "shipSpeed": "economy",
      "costCents": 499,
      "currency": "usd",
      "etaDays": 7,
      "luluShippingLevel": "MAIL"
    }
  ]
}
```

### POST /api/order

Creates Stripe PaymentIntent + Lulu order record.

Request body:
```json
{
  "kidId": "...",
  "bookId": "...",
  "parentEmail": "...",
  "format": "...",
  "pages": 32,
  "pdfHash": "sha256:...",
  "shippingAddress": { "..." : "..." },
  "shippingOption": { "luluShippingLevel": "MAIL", "costCents": 499 },
  "consentLog": { "..." : "..." }
}
```

Response:
```json
{
  "orderId": "...",
  "clientSecret": "pi_test_..._secret_...",
  "paymentIntentId": "pi_test_...",
  "amountCents": 1999,
  "currency": "usd"
}
```

### GET /api/order/[id]

Returns current order status. Polling target after payment.

### POST /api/order/[id]

Body `{ "action": "confirm" }` — manual confirmation gate (used in test/demo flows).

## Auth: resolveParentEmail

Defined in `src/hooks.server.ts`. Guards all order routes.

| Condition | Result |
|---|---|
| Valid session user present | Resolves email from session |
| `STORYBOOK_DEV_BYPASS_AUTH=1` + not production | Bypasses auth, uses dev email |
| `STORYBOOK_DEV_BYPASS_AUTH=1` + `NODE_ENV=production` | **500 `auth_bypass_misconfigured`** (guardrail prevents prod bypass) |
| No session, no bypass | **401 `auth_required`** |

## Pricing

`priceForBook` is the **authoritative price function**. Always use it — never hardcode amounts. Feeds `amountCents` in order creation.

## Stripe Integration

Decision point: `decideStripePath()`

```
PUBLIC_STRIPE_PUBLISHABLE_KEY set?
  yes -> useRealStripe=true  -> mount real Stripe Elements
  no  -> useRealStripe=false -> mock Stripe UI
```

**Mock mode** (key absent):
- Shows test card `4242 4242 4242 4242`
- `POST /api/order` returns deterministic `clientSecret: "pi_test_*"`
- No real charge

**Real mode** (key present):
- Stripe Elements mounts with publishable key
- `confirmCardPayment` called with `clientSecret` from order API
- Real charge in Stripe

## Related

- [Demo auth bypass decision](/decisions/demo-auth-bypass.md) — rationale for `STORYBOOK_DEV_BYPASS_AUTH` guardrail
- [Create flow architecture](/architecture/create-flow.md) — upstream book creation before checkout
- [Routes map](/architecture/routes.md) — where Station7 lives in the route tree
