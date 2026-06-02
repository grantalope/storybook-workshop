# Storybook Workshop

> Standalone repository for the personalized children's picture-book product, extracted from `grantalope/pachinko-app` on 2026-06-02 per ADR-0042.

## What this is

Personalized AI-generated children's picture-book product. Parent walks a Build-a-Bear-style ritual workshop, system generates a 24-page hardcover starring their child as protagonist, prints + ships via Lulu Direct. Free digital read-along with email gate. Optional grandparent series subscription.

## Three moats
1. **On-device privacy** — kid's photo, name, address never enter our content-generation pipeline. WASM CLIP vectorizes locally; only opaque pillar IDs cross any API boundary.
2. **Settler/pachinko provenance** — workshop draws on the existing dynamic settler roster (lead host + cameo attendants) via a public Skill marketplace API into upstream pachinko-app.
3. **Evidence-backed pedagogy** — every parent-facing design knob is tied to a peer-reviewed citation (Symons & Johnson 1997, Stein & Glenn 1979, Bus/van IJzendoorn/Pellegrini 1995, etc.).

## Layout

```
src/
├── routes/                    # SvelteKit routes
│   ├── +page.svelte           # workshop entry point
│   ├── advanced/              # advanced mode stations
│   ├── library/               # parent's book library
│   ├── gift/                  # grandparent gift flow
│   ├── series/                # series timeline view
│   └── api/                   # backend endpoints
│       ├── book/[shortcode]/   # email-gated read-along bundle
│       ├── vectorize/          # CSPRNG-safe fallback CLIP endpoint
│       ├── gift/               # gift purchase
│       ├── bundle/             # one-time prepaid bundles
│       ├── subscribe/          # recurring subscriptions
│       ├── autopilot-approve/  # autopilot consent
│       └── birthday-cron/      # cron-triggered 6-week-pre-birthday email
├── lib/
│   ├── components/            # Svelte building-block components
│   ├── services/              # core services
│   │   ├── PillarVectorizerService.ts
│   │   ├── PillarMatcherService.ts
│   │   ├── PillarManifestClient.ts
│   │   ├── assemble/          # BookAssembler + PDF/ePub/read-along
│   │   ├── author/            # StoryAuthor + Tier-2 vocab + Stein-Glenn validator
│   │   ├── render/            # BookSpreadSurfaceAdapter + emotional effects
│   │   └── subscription/      # series subs + gift + birthday cron
│   ├── workshop/              # workshop UI building blocks (orchestrator + stations + advanced inspectors)
│   ├── privacy/               # VENDORED: PrivacyFilterService + backends
│   ├── kids-content-safety/   # VENDORED: KidsContentSafetyService + backends
│   ├── pretext/               # VENDORED: PreText typography pipeline (PretextCompositor + EffectEngine + FlowEngine + AsciiTypes + CompositorTypes)
│   └── kernel-contracts/       # VENDORED: kernel inference + helpers + kids-content-safety contracts
│       ├── inference/         # llm-generate / embed-text / embed-image / privacy-scrub adapters
│       ├── helpers/           # llr-fallback + get-kernel + define-kernel-mirror + mirror-audit + port-cache
│       └── kids-content-safety/  # kernel-side contracts + manifests
docs/
├── adr/                       # 0042-as-product-branch, 0043-privacy-on-device-pillar
├── specs/                     # 2026-05-24 design + 2026-05-25 hd2d-renderer-pivot
└── goals/                     # original 12 implementation goals (historical reference)
tests/
├── setup/web-crypto-polyfill.ts  # Node 18 vitest globalThis.crypto polyfill
├── assemble/                   # BookAssembler suites
├── author/                     # StoryAuthor + planner + validator + calibrator + dialogic
├── render/                     # PreText surface adapter + effects + typography
├── subscription/               # subs + gift + bundle + birthday + referral
├── advanced/                   # advanced-mode override store + diff snapshots + telemetry + citations
├── pillar-vectorizer.test.ts
├── pillar-matcher.test.ts
├── pillar-manifest-client.test.ts
├── kids-content-safety-*.test.ts
└── vectorize-endpoint.test.ts
e2e/
├── advanced.spec.ts
└── pretext.spec.ts
```

## Extracted from
- `grantalope/pachinko-app` main HEAD at extraction time (see `EXTRACTED_FROM` file at repo root for the source SHA).
- ADRs 0042 (extraction trigger) and 0043 (on-device privacy posture) carry over.
- 9 of the original 12 fleet goals merged into pachinko-app before extraction:
    - ✅ pillar-vectorizer (#159)
    - ✅ kids-content-safety (#161)
    - ✅ story-author (#163)
    - ✅ pretext-book-adapter (#162)
    - ✅ book-assembler (#160)
    - ✅ advanced-mode (#172)
    - ✅ subscription-engine (#173)
    - ✅ HD-2D renderer pivot (#170)
    - ✅ spec landing (#158)
- Pending in pachinko-app at extraction time (will be ported across as follow-up PRs to this repo):
    - 🟡 ui-shell (workshop UI page + 7 stations + draft persistence)
    - 🟡 fulfillment (Lulu Direct + Stripe + webhooks)
    - 🟡 marketing-funnel (email gate + lifecycle + abandoned cart + referral)

## Upstream dependencies (still consumed remotely)

- **World Builder** (`localhost:3000` in dev) — for scene rendering. The HD-2D renderer pivot (spec §3.7) replaces this with the in-repo THREE r171 engine; that engine vendoring is a follow-up extraction once it lands on pachinko-app main.
- **Pachinko Skill marketplace** — settlers + lead settler discovery via public API. Default to mock roster in dev / standalone.
- **Lulu Direct + Stripe + CRM (Resend / Postmark)** — print + payment + email. Real creds via env; tests mock at the boundary.

## CSPRNG policy

`secureRandomInt` (in `src/lib/services/subscription/`) replaces `Math.random()` for redeem codes + referral shortcodes per the security review HIGH+MEDIUM findings. Web Crypto on browser + Node 19+, polyfilled in vitest setup file.

## Privacy contract (load-bearing — see ADR-0043)

- Kid photo: local IDB ephemeral; CLIP vectorize on device (WASM) then discarded.
- Kid name: lives in local Svelte store; composited LOCALLY at PDF-assembly time only.
- Kid embedding: local IDB; never crosses any API.
- Shipping address: crosses to Lulu Direct only at checkout (`book_fulfillment` purpose).
- Scene briefs + dedications: pass through `PrivacyFilterService` + `KidsContentSafetyService` before any external call.
- The fallback `/api/vectorize` endpoint is stateless, rate-limited, anonymous, photo-discarded-synchronously.

## Development

```bash
pnpm install
pnpm dev           # http://localhost:5173
pnpm test          # vitest run
pnpm test:e2e      # playwright
pnpm check         # svelte-check + svelte-kit sync
pnpm build         # production build
```

## Status

Pre-MVP at extraction. ~10 of 12 goals merged in upstream pachinko-app + extracted. Remaining 3 goals (ui-shell, fulfillment, marketing-funnel) port across as follow-up PRs as they land in pachinko-app.

## See also

- Original product-branch ADR: `docs/adr/0042-as-product-branch.md` (extraction trigger was originally specified as 10k books/mo OR $50k MRR; user accelerated to pre-MVP).
- Privacy posture ADR: `docs/adr/0043-privacy-on-device-pillar.md`.
- Master design spec: `docs/specs/2026-05-24-design.md`.
- HD-2D pivot: `docs/specs/2026-05-25-hd2d-renderer-pivot.md`.
