# Copy to .env.local and fill in real values before running dev server or smoke tests.
# See tasks/sandbox-smoke-checklist.md for setup instructions.

# REQUIRED for dev server to boot (StripeElementsLoader imports this at module level).
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE

# Required for Stripe test-mode smoke
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET

# Required for Lulu sandbox smoke
LULU_CLIENT_ID=YOUR_LULU_CLIENT_ID
LULU_CLIENT_SECRET=YOUR_LULU_CLIENT_SECRET
LULU_WEBHOOK_SECRET=YOUR_LULU_WEBHOOK_SECRET
LULU_API_BASE=https://api.sandbox.lulu.com

# Required for ops refund route smoke
OPS_API_TOKEN=smoke-test-ops-token-local

# Set for local dev smoke only (never in production)
STORYBOOK_DEV_BYPASS_AUTH=1
