# Goal: Storybook Workshop — Series Subscription + Grandparent Gift Flow + Birthday Cron

**Wave:** 2 (depends on fulfillment goal #8)
**Branch:** `feat/storybook-workshop-subscription-engine`
**Worktree:** `~/devbox/pachinko-app-sw-subscription-engine/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §6.4
**Executor preference:** claude

---

## Why

The flagship monetization. Grandparent + series model converts gift-buyers into recurring LTV. Cadence subs (monthly/bi-weekly/weekly/quarterly), one-time prepaid bundles, named themed series, gift purchase without recipient account, birthday-cron auto-marketing, autopilot lane with 7-day approve-or-default.

---

## Scope (files to create)

```
src/routes/dashboard/services/storybook-workshop/subscription/
├── SubscriptionService.ts                 # Stripe subscription create/cancel/skip + cadence scheduler
├── BundleService.ts                       # one-time prepaid 3/6/12-book bundles
├── GiftFlowService.ts                     # grandma's purchase flow + recipient onboarding
├── SeriesThemeRegistry.ts                 # 6 named themed series with 12 themes each
├── AutopilotDrafter.ts                    # auto-drafts books at cadence + 7-day approval window
├── BirthdayCronService.ts                 # 6-week-pre-birthday auto-fire email
├── ReferralAttribution.ts                 # shareable-link conversion tracking + $5 credit
├── types.ts                               # Subscription, Bundle, Gift, Series, Cadence
└── index.ts
src/routes/api/storybook-workshop/
├── subscribe/+server.ts                   # POST: create subscription
├── subscribe/[id]/+server.ts              # GET status, POST skip/cancel
├── bundle/+server.ts                      # POST: one-time bundle purchase
├── gift/+server.ts                        # grandma's gift flow endpoint
├── autopilot-approve/+server.ts           # parent approves auto-drafted book
└── birthday-cron/+server.ts               # cron-triggered, internal-only
src/routes/storybook-workshop/
├── gift/+page.svelte                      # grandma's gift purchase page (no parent account needed)
└── series/[seriesId]/+page.svelte         # series timeline view (per kid)
tests/storybook-workshop/subscription/
├── subscription-service.test.ts
├── bundle-service.test.ts
├── gift-flow-service.test.ts
├── series-theme-registry.test.ts
├── autopilot-drafter.test.ts
├── birthday-cron.test.ts
└── referral-attribution.test.ts
```

## Out of scope

- ❌ No per-book purchase — goal #8.
- ❌ No marketing emails beyond transactional + birthday — that's goal #11.
- ❌ No UI integration into workshop — recipient onboarding hooks into workshop via existing kid-profile pattern.

---

## Build sequence

### Phase 1 — Types + Cadence
1. Read spec §6.4 in full.
2. `types.ts`:
   - `Cadence = 'quarterly' | 'monthly' | 'biweekly' | 'weekly'`
   - `Subscription = { id, recipientParentEmail, kidId?, cadence, format, status: 'active'|'paused'|'cancelled', startedAt, nextBookAt, billingMode: 'recurring'|'prepaid_bundle', stripeSubscriptionId?, prepaidBundleId?, giverEmail?, autopilotEnabled, seriesThemeId? }`
   - `Bundle = { id, recipientParentEmail, format, cadence, bookCount: 3|6|12|24, prepaidCents, stripePaymentIntentId, status, giverEmail? }`
   - `Gift = { id, recipientParentEmail, recipientName, cadence, format, bundleLength: 3|6|12|24|null, startDate, cardFromGiver, giverName, giverEmail, stripeCheckoutId, redeemedAt? }`
   - `SeriesTheme = { id, name, themes: [12 ThemeId], description }`

### Phase 2 — Subscription service
3. `SubscriptionService.ts`:
   - `create({ recipientParentEmail, kidId, cadence, format, billingMode, autopilotEnabled, seriesThemeId })`.
   - For recurring: create Stripe subscription with pricing per spec §6.4 (monthly hardcover $29.99, etc.).
   - For prepaid: create via `BundleService` instead.
   - Skip-a-month: mark current scheduled book as skipped, move nextBookAt forward 1 cadence interval (no refund).
   - Cancel: mark cancelled, books-to-date stay with kid.

### Phase 3 — Bundle service
4. `BundleService.ts`:
   - Pricing per spec §6.4: 3-book $79.99, 6-book $149.99, 12-book $279.99 (~22% discount).
   - One-time Stripe charge.
   - On purchase: create Bundle + auto-create books on cadence interval (no auto-renew).

### Phase 4 — Gift flow
5. `GiftFlowService.ts`:
   - Grandma's purchase flow.
   - Stripe checkout for lump-sum (prepaid bundle) or recurring sub.
   - On success: create Gift entity + send recipient parent email "Grandma gifted Eli a 12-month series".
   - Parent redeems by setting up kid profile (links Gift to Subscription/Bundle).
   - Card from giver appears on every book's dedication page (additional dedication line).
6. `src/routes/storybook-workshop/gift/+page.svelte`:
   - Public landing (no parent account needed).
   - Multi-step: recipient details → cadence/format → length → start-date → card → pay.
   - "Recipient invites" — generates redeem code for the recipient parent.

### Phase 5 — Series themes
7. `SeriesThemeRegistry.ts`: 6 named series per spec §6.4:
   - "A Year of Adventures" (12 biomes)
   - "Big Feelings" (CASEL-aligned emotions)
   - "Family Tales" (mom/dad/sibling/etc.)
   - "First Times" (milestone book per month)
   - "Seasons & Holidays" (calendar-tied)
   - "Friend Of The Month" (settler-sidekick rotation)
   - Each entry: name, description, 12 ThemeId / occasion combos in order.

### Phase 6 — Autopilot
8. `AutopilotDrafter.ts`:
   - At cadence interval, system auto-drafts next book in series (calls `storyAuthorService.author` with theme from `SeriesTheme`).
   - Sends parent email: "Eli's June book is ready for your review" + redeem link.
   - 7-day approval window. After 7 days, default: do NOT ship (credit to next book).
   - For weekly cadence: batch-approve 4 books at once (auto-draft 4 in advance, 14-day window).
9. `autopilot-approve/+server.ts`:
   - `POST { subscriptionId, draftId, action: 'approve'|'redo'|'swap_theme' }` → resumes workshop flow at S6 (preview + consent gate).

### Phase 7 — Birthday cron
10. `BirthdayCronService.ts`:
    - Read kid profiles (with parent opt-in flag).
    - 6 weeks pre-birthday: send email to parent + any registered grandparent.
    - Subject: *"Eli's birthday is in 6 weeks — make this her best year."*
    - CTA: pre-filled `/gift` flow.
11. `birthday-cron/+server.ts`: triggered by external cron (system cron or cloud scheduler) once per day; idempotency via `(kidId, year)` key.

### Phase 8 — Referral
12. `ReferralAttribution.ts`:
    - Anonymous referral chain: shortcode → click → purchase attributed.
    - On grandparent purchase via referral link: $5 credit to originating parent's account.
    - Track only aggregate counts, no per-user PII linkage.

### Phase 9 — Tests
13. `subscription-service.test.ts`: create / skip / cancel flows; Stripe sub state mapping.
14. `bundle-service.test.ts`: 3 bundle sizes, one-time charge, scheduled book auto-creation.
15. `gift-flow-service.test.ts`: gift purchase → recipient redeem flow; card-from-giver on dedication page.
16. `series-theme-registry.test.ts`: 6 series shape; 12 themes each; no overlaps.
17. `autopilot-drafter.test.ts`: cadence-trigger drafts book; 7-day default-no-ship; weekly batch.
18. `birthday-cron.test.ts`: 6-week-pre fire; idempotency.
19. `referral-attribution.test.ts`: shortcode → purchase → credit award.
20. ≥45 new tests.

### Phase 10 — Verification
21. `pnpm check` clean.
22. Manual smoke: drive a Gift flow with Stripe test cards, verify email triggers, verify recipient onboarding link works.

---

## Done criteria
- ✅ All files created.
- ✅ ≥45 vitest tests green.
- ✅ Gift flow + recipient onboarding works end-to-end with Stripe test.
- ✅ Birthday cron triggers in test (idempotency verified).
- ✅ Autopilot 7-day default-no-ship implemented.
- ✅ implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 4 (gift flow — codex tries to game free books)
- `/codex:adversarial-review` after Phase 6 (autopilot — codex tries to race the 7-day window)
- `/codex:rescue` on > 20min stuck

## Implementation-notes.md must document
- Stripe subscription product/price catalog setup
- Cadence scheduler implementation (cron vs in-app idle loop)
- Skip-a-month policy details
- Card-from-giver dedication-page assembly hook
- Referral $5 credit accounting

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-subscription-engine -b feat/storybook-workshop-subscription-engine origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
