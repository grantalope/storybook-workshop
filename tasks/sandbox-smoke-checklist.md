# Sandbox Smoke Checklist — Stripe Test Mode + Lulu Sandbox

Step-by-step operator runbook for manual e2e smoke in test/sandbox environments.
Run before every production deploy; run after any fulfillment or webhook changes.

---

## Prerequisites

### 1. Required environment variables

Set in `.env.local` (never commit):

```
# Stripe test mode
STRIPE_SECRET_KEY=sk_test_<your_key>
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_<key>
STRIPE_WEBHOOK_SECRET=whsec_<secret>          # set after step 3 below

# Lulu sandbox
LULU_CLIENT_ID=<sandbox_client_id>
LULU_CLIENT_SECRET=<sandbox_client_secret>
LULU_WEBHOOK_SECRET=<shared_secret>
LULU_API_BASE=https://api.sandbox.lulu.com

# Ops token
OPS_API_TOKEN=smoke-test-ops-token-local

# Auth bypass for local smoke (never in production)
STORYBOOK_DEV_BYPASS_AUTH=1
```

### 2. Start local server + Stripe CLI webhook forwarder (two terminals)

**Terminal A — app:**
```
cd ~/devbox/storybook-workshop
pnpm dev
# Expected: "Local: http://localhost:5173"
```

**Terminal B — Stripe CLI forward:**
```
stripe listen --forward-to http://localhost:5173/api/stripe-webhook
# Note the webhook secret printed: "whsec_..." -> paste into STRIPE_WEBHOOK_SECRET above
# Restart app with updated env after pasting.
```

---

## Stripe Test-Mode Flow

### 3. Create order + Stripe PaymentIntent

```
curl -s -X POST http://localhost:5173/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "kidId": "kid_smoke",
    "bookId": "book_smoke",
    "parentEmail": "smoke@test.local",
    "format": "standard_landscape",
    "pages": 26,
    "pdfHash": "aabbcc112233",
    "shippingAddress": {
      "name": "Smoke Test",
      "line1": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "postalCode": "78701",
      "country": "US"
    },
    "shippingOption": {
      "id": "usps_ground",
      "carrier": "USPS",
      "service": "Ground",
      "deliveryDays": 7,
      "priceCents": 499,
      "currency": "USD"
    },
    "bookCostCents": 2999,
    "consentLog": [
      {"checked": "cannot_return", "at": 0},
      {"checked": "reviewed_spreads", "at": 0}
    ]
  }'
```

**Expected response:**
```
{ "orderId": "ord_<8chars>", "clientSecret": "pi_..._secret_...", "paymentIntentId": "pi_..." }
```

Save `orderId` and `paymentIntentId` for subsequent steps.

### 4. Simulate payment_intent.succeeded via Stripe CLI

```
stripe trigger payment_intent.succeeded
```

Or confirm the exact PaymentIntent from step 3:
```
stripe payment_intents confirm pi_<id> --payment-method pm_card_visa
```

**Expected Stripe CLI output:** `payment_intent.succeeded` forwarded to `/api/stripe-webhook`

**Expected webhook response:**
```
{"ok":true,"received":true,"outcome":"applied","transitioned":"paid"}
```

**Verify order state:**
```
curl -s http://localhost:5173/api/order/<orderId>
# Expected: "state": "paid"
```

### 5. Verify dedup (same event replayed)

Send the same webhook event again (Stripe CLI replay or dashboard resend):

**Expected:**
```
{"ok":true,"received":true,"outcome":"duplicate","deduped":true}
```

Confirms `applyStripeWebhookEventOnce` idempotency-key dedup works.

### 6. Simulate payment_intent.payment_failed

```
stripe trigger payment_intent.payment_failed
```

**Expected webhook response:**
```
{"ok":true,"received":true,"outcome":"applied","transitioned":"failed_validation"}
```

---

## Lulu Sandbox Flow

### 7. Verify Lulu OAuth (sandbox)

```
curl -s -X POST https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=$LULU_CLIENT_ID&client_secret=$LULU_CLIENT_SECRET"
```

**Expected:** `{"access_token":"...","expires_in":3600,...}`

### 8. Submit order to Lulu

After state is `paid`, lifecycle handler submits automatically. Trigger via lifecycle-tick if needed:
```
curl -s -X POST http://localhost:5173/api/marketing/lifecycle-tick \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** order transitions to `submitted_to_lulu`; Lulu returns `{"id":"lj_...","status":{"name":"CREATED"}}`

### 9. Simulate Lulu webhook state transitions

Generate HMAC-SHA256 signature for each payload:

```
SECRET=$LULU_WEBHOOK_SECRET
PAYLOAD='{"topic":"PRINT_JOB_STATUS_CHANGED","data":{"printJobId":"lj_smoke","status":"IN_PRODUCTION"}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -s -X POST http://localhost:5173/api/lulu-webhook \
  -H "Content-Type: application/json" \
  -H "Lulu-Signature: $SIG" \
  -d "$PAYLOAD"
```

Repeat for each status:

| Lulu `status` | Expected `OrderState` | Expected response |
|---|---|---|
| `IN_PRODUCTION` | `in_production` | `{"ok":true,"transitioned":"in_production"}` |
| `SHIPPED` | `shipped` | `{"ok":true,"transitioned":"shipped"}` |
| `DELIVERED` | `delivered` | `{"ok":true,"transitioned":"delivered"}` |
| `REJECTED` | `lulu_error_terminal` | `{"ok":true,"transitioned":"lulu_error_terminal"}` |
| `CANCELLED` | `cancelled_pre_production` | `{"ok":true,"transitioned":"cancelled_pre_production"}` |

**Dedup check (replay same event):**
```
# Second POST with identical payload+signature
# Expected: {"ok":true,"ignored":"no_state_change"} or 409
```

**Unknown Lulu job:**
```
# Send webhook with printJobId not in DB
# Expected: {"ok":true,"ignored":"unknown_lulu_job"}
```

---

## Refund Decision Route

### 10. File a quality claim

```
curl -s -X POST http://localhost:5173/api/quality-claim \
  -H "Content-Type: application/json" \
  -d '{"orderId":"<orderId>","claimType":"print_quality","description":"Pages blurry"}'
```

**Expected:** `{"claimId":"claim_...","status":"open"}`

Save `claimId`.

### 11. Ops approves refund

```
curl -s -X POST http://localhost:5173/api/quality-claim/<claimId>/decision \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer smoke-test-ops-token-local" \
  -d '{"decision":"approved_refund","amountCents":2999,"refundKind":"quality_claim"}'
```

**Expected:**
```
{"ok":true,"alreadyExecuted":false,"refund":{...},"orderState":"..."}
```

Stripe test mode returns `status: "succeeded"` immediately for test keys.

### 12. Verify refund idempotency (duplicate call)

```
# Repeat step 11 with identical body
# Expected: {"ok":true,"alreadyExecuted":true,"refund":{...}}
```

Confirms `beginRefundOnce` idempotencyKey blocks double-charge.

### 13. Unauthorized ops decision

```
curl -s -X POST http://localhost:5173/api/quality-claim/<claimId>/decision \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved_refund","amountCents":100}'
# Expected: 401 {"error":"unauthorized"}
```

### 14. Invalid decision body

```
curl -s -X POST http://localhost:5173/api/quality-claim/<claimId>/decision \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer smoke-test-ops-token-local" \
  -d '{"decision":"rejected"}'
# Expected: 400 {"error":"invalid_decision","decision":"rejected"}
```

---

## charge.refunded Audit Log Test

### 15. Stripe charge.refunded (audit only — no state change)

```
stripe trigger charge.refunded
# Expected: {"ok":true,"received":true,"outcome":"applied","audited":"refund"}
# Order state UNCHANGED — charge.refunded is audit-only per spec section 5.5
```

---

## Pass/Fail Criteria

| Check | Pass condition |
|---|---|
| Stripe PI creation | `clientSecret` present in response |
| `payment_intent.succeeded` | `{"outcome":"applied","transitioned":"paid"}` |
| Stripe dedup | `{"outcome":"duplicate","deduped":true}` on replay |
| `payment_intent.payment_failed` | `{"outcome":"applied","transitioned":"failed_validation"}` |
| Lulu OAuth | `access_token` present, no 401 |
| Lulu webhook `IN_PRODUCTION` | `{"transitioned":"in_production"}` |
| Lulu webhook `SHIPPED` | `{"transitioned":"shipped"}` |
| Lulu webhook unknown job | `{"ignored":"unknown_lulu_job"}` |
| Lulu webhook dedup | `{"ignored":"no_state_change"}` on replay |
| Quality claim filed | `claimId` present |
| Ops refund approved | `{"ok":true,"alreadyExecuted":false}` |
| Ops refund idempotent | `{"ok":true,"alreadyExecuted":true}` on replay |
| Unauthorized ops | 401 |
| `charge.refunded` | `{"audited":"refund"}`, order state unchanged |
