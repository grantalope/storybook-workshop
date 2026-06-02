# Goal: Storybook Workshop — Marketing Funnel + Email-Gated Preview + Lifecycle Automation

**Wave:** 3 (parallel with pillar-library-assets + wb-upstream; depends on book-assembler + fulfillment)
**Branch:** `feat/storybook-workshop-marketing-funnel`
**Worktree:** `~/devbox/pachinko-app-sw-marketing-funnel/`
**Spec:** [docs/superpowers/specs/2026-05-24-storybook-workshop-design.md](../specs/2026-05-24-storybook-workshop-design.md) §8
**Executor preference:** claude

---

## Why

Email-gated digital preview is the conversion mechanic — first 4 spreads free, email to unlock the rest. Email becomes the marketing engine: T+0 confirmation, T+1h "did you share?", T+24h "$5 off print", T+72h "Grandma series pitch", T+7d educational drip with citations, T+14d expiry warning, T+30d save-or-lose. Abandoned-cart flow. Grandparent-referral viral loop. Birthday cron. **All FTC-safe, COPPA-K compliant, GDPR-clean unsubscribe.**

---

## Scope (files to create)

```
src/routes/dashboard/services/storybook-workshop/marketing/
├── EmailGateService.ts                       # email-gate cookie + CRM record
├── LifecycleEmailService.ts                  # T+0 ... T+30 schedule + per-event triggers
├── AbandonedCartService.ts                   # checkout-incomplete tracking + recovery emails
├── ReferralLinkService.ts                    # shareable shortcode + conversion attribution
├── EducationalDripService.ts                 # weekly research-cited emails (opt-in)
├── EmailRenderer.ts                          # per-template HTML + plain-text generation
├── CrmClient.ts                              # Resend or Postmark abstraction
├── PromoCodeService.ts                       # first-time, abandoned-cart, birthday codes
├── types.ts                                  # EmailTemplate, LifecycleStage, Promo, Referral
└── index.ts
src/routes/api/storybook-workshop/
├── email-gate/+server.ts                     # POST { email, shortcode } → set session cookie + CRM record
├── lifecycle-tick/+server.ts                 # cron-triggered, advances lifecycle per email
├── abandoned-cart-tick/+server.ts            # cron-triggered
├── referral/[shortcode]/+server.ts           # tracks click + sets attribution
├── unsubscribe/+server.ts                    # GDPR-clean unsub link
└── promo/[code]/+server.ts                   # validate + apply promo at checkout
src/routes/(marketing)/                       # marketing site (Phase B may extract to standalone)
├── +page.svelte                              # landing: 3 moats + CTA "Make First Book (Free)"
├── research/+page.svelte                     # 10 evidence-knob citation cards
├── privacy/+page.svelte                      # network-tab proof + on-device explainer
├── gift/+page.svelte                         # grandma's gift entry (shares with goal #9)
└── r/[shortcode]/+page.svelte                # public read-along, email-gated past page 4
tests/storybook-workshop/marketing/
├── email-gate-service.test.ts
├── lifecycle-email-service.test.ts
├── abandoned-cart-service.test.ts
├── referral-link-service.test.ts
├── educational-drip-service.test.ts
├── promo-code-service.test.ts
└── email-rendering.test.ts                   # template HTML schema, unsub link present, plain-text fallback
e2e/storybook-workshop-marketing-funnel.spec.ts # Playwright: anonymous build → email gate → read full → buy
```

## Out of scope

- ❌ No transactional emails (paid, printed, shipped, delivered) — those live in goal #8 fulfillment.
- ❌ No subscription-gift emails — those live in goal #9 subscription-engine.
- ❌ No advisory-council recruitment surface — Phase B.
- ❌ No paid-ads attribution / pixels — that's a Phase B post-launch addition.

---

## Build sequence

### Phase 1 — Types + CRM abstraction
1. Read spec §8 in full.
2. `types.ts`:
   - `EmailTemplate = 'gate_unlock' | 'lifecycle_T0' | 'lifecycle_T1h' | 'lifecycle_T24h' | 'lifecycle_T72h' | 'lifecycle_T7d' | 'lifecycle_T14d' | 'lifecycle_T30d' | 'abandoned_cart_T1h' | 'abandoned_cart_T24h' | 'abandoned_cart_T72h' | 'birthday_6w' | 'edu_drip_weekly'`
   - `LifecycleStage = 'gate_unlocked' | 'paid_print' | 'series_subscribed' | 'unsubscribed'`
   - `Referral = { shortcode, originatingParentEmail, clicks: number, conversions: number, lastConversionAt? }`
   - `PromoCode = { code, type: 'first_time' | 'abandoned_cart' | 'birthday' | 'series_discount', amountOff: number, expiresAt, usageCount, maxUsage? }`
3. `CrmClient.ts`: abstracts Resend OR Postmark behind a single `send({template, to, vars, tags})` interface. Document choice in implementation-notes. Provider-agnostic for swap if needed.

### Phase 2 — Email gate
4. `EmailGateService.ts`:
   - `record({email, shortcode, kidAgeBand, themePicked, lengthTier})` → CRM contact (tagged) + signed session cookie unlocks read-along past page 4.
   - Cookie: `swEmailGate=<HMAC(email, shortcode)>`; verified server-side.
   - Idempotency: re-submitting same email returns same cookie.
5. `email-gate/+server.ts`: `POST { email, shortcode }` → invoke service → set cookie → return JSON `{unlocked: true}`. No email content stored beyond the CRM contact.

### Phase 3 — Lifecycle email scheduler
6. `LifecycleEmailService.ts`:
   - On gate-unlock: schedule lifecycle emails per spec §8.2 timing (T+0 immediate, T+1h, T+24h, T+72h, T+7d, T+14d, T+30d).
   - `tick()` method called by cron `/api/storybook-workshop/lifecycle-tick` daily. Iterates CRM contacts at each lifecycle stage → fires next-due email.
   - Each email rendered via `EmailRenderer` + sent via `CrmClient`.
   - Lifecycle terminates on `paid_print` or `series_subscribed` or `unsubscribed`.
7. Template content per spec §8.2 with citation-friendly tone.

### Phase 4 — Abandoned cart
8. `AbandonedCartService.ts`:
   - Tracks parents who reach Station 7 but don't pay (via consent-log + draft state from fulfillment + email gate).
   - Fires at T+1h, T+24h, T+72h with escalating promo (5% → 10% → 15%).
   - `abandoned-cart-tick/+server.ts` cron entry.

### Phase 5 — Referral attribution
9. `ReferralLinkService.ts`:
   - Each generated book shortcode = referral source.
   - On grandparent purchase via referral link: $5 credit to originating parent (writes to credit balance ledger — coordinate with goal #9 subscription credit infrastructure).
   - Anonymous chain: no per-user behavioral profiling, only aggregate counts.
10. `referral/[shortcode]/+server.ts`: tracks click → 302 to `/dashboard/storybook-workshop?ref=shortcode`. Attribution set in session.

### Phase 6 — Educational drip
11. `EducationalDripService.ts`:
    - Weekly email to opt-in subscribers.
    - Templated entries: 1 research finding + 1 citation + 1 product tie.
    - Catalog ~24 entries covering all 10 evidence knobs (from spec §7.1). Rotate weekly.
    - Examples:
      - *"Why naming your child in the story actually helps memory (Symons & Johnson 1997)"* → product tie to "personalized hero" knob
      - *"The 6 parts of a story your child's brain expects (Stein & Glenn 1979)"* → product tie to "story grammar"
      - *"The bedtime read-aloud is the single strongest predictor of later reading (Bus, van IJzendoorn, Pellegrini 1995)"* → product tie to "bedtime length presets"

### Phase 7 — Unsubscribe + GDPR
12. `unsubscribe/+server.ts`: per-template unsubscribe (transactional/marketing/educational). Per-spec §8 footer includes link with `?email=<email>&type=marketing`. Marks CRM contact tags appropriately.
13. Unsub from marketing still receives transactional (order confirmations, shipping updates) — clearly disclosed.
14. Full account delete cascades to CRM contact delete (called from `/library` per-kid delete button).

### Phase 8 — Promo codes
15. `PromoCodeService.ts`:
    - `firstTime` auto-applied via cookie on first visit (`BEDTIME10` = 10% off, $5 cap).
    - `abandoned-cart` 1-time per parent per abandoned draft.
    - `birthday` 15% off auto-fired 6 weeks pre-kid-birthday (coordinated with goal #9 birthday cron).
    - Single-promo-per-order enforcement.
16. `promo/[code]/+server.ts`: validate + apply at checkout endpoint (used by goal #8 fulfillment `order/+server.ts` via `validatePromo()` cross-call).

### Phase 9 — Marketing pages
17. `(marketing)/+page.svelte`: hero, 3 moats, "Make Your First Book (Free)" CTA.
18. `(marketing)/research/+page.svelte`: 10 evidence-knob cards each with citation hyperlinked.
19. `(marketing)/privacy/+page.svelte`: network-tab proof + on-device architecture explainer.
20. `(marketing)/r/[shortcode]/+page.svelte`: public read-along host. Reads bundle via `/api/storybook-workshop/book/[shortcode]/+server.ts` (goal #5). Email-gates past page 4.

### Phase 10 — Tests
21. `email-gate-service.test.ts`: cookie sign/verify, idempotent re-submit, CRM record correctness.
22. `lifecycle-email-service.test.ts`: 7-stage schedule fires at correct deltas; terminates on conversion; idempotent on re-tick.
23. `abandoned-cart-service.test.ts`: escalating promos, no spam after paid.
24. `referral-link-service.test.ts`: click tracking, $5 credit on conversion attribution.
25. `educational-drip-service.test.ts`: weekly rotation through catalog, opt-out respected.
26. `promo-code-service.test.ts`: first-time vs abandoned-cart vs birthday, single-promo-per-order.
27. `email-rendering.test.ts`: HTML schema, unsub link present, plain-text fallback.
28. Playwright `e2e/storybook-workshop-marketing-funnel.spec.ts`: anonymous build → preview shows first 4 spreads → email gate appears at spread 5 → submit email → full book unlocks → buy CTA → Stripe test → confirmation.

### Phase 11 — Verification
29. `pnpm check` clean.
30. ≥50 vitest tests + Playwright e2e green.
31. Manual smoke: walk through the full funnel using a test email box, verify email arrives in CRM provider test inbox, lifecycle emails fire on cron tick.

---

## Done criteria
- ✅ All files created.
- ✅ ≥50 vitest tests + e2e green.
- ✅ CRM provider integration verified (test mode).
- ✅ All emails GDPR-compliant footer + unsub link.
- ✅ Promo code validation works at checkout.
- ✅ Referral attribution $5 credit works end-to-end (test mode).
- ✅ implementation-notes.md per Rule 14.
- ✅ PR + king-review + merged.

## Codex review hooks
- `/codex:review` after every commit
- `/codex:adversarial-review` after Phase 3 (codex finds lifecycle-email race / spam paths)
- `/codex:adversarial-review` after Phase 7 (codex audits unsub + GDPR compliance)
- `/codex:rescue` on > 20min stuck

## Implementation-notes.md must document
- CRM provider choice (Resend vs Postmark) + reasoning
- Lifecycle scheduler implementation (cron vs in-app idle vs CRM-side timing)
- Cookie signing scheme (HMAC + which secret)
- Promo code accounting (Stripe coupons vs custom)
- Educational drip rotation logic (how we avoid sending the same entry to same parent twice)

## Branch setup
```bash
git worktree add ~/devbox/pachinko-app-sw-marketing-funnel -b feat/storybook-workshop-marketing-funnel origin/feat/storybook-workshop-product-branch
```

## Merge-back per CLAUDE.md §6b → main.
