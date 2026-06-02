# ADR-0042 — Storybook Workshop as a Product Branch within Pachinko-App

**Date:** 2026-05-24
**Status:** Accepted

## Situation
We want to build a personalized AI-generated children's-book product (Storybook Workshop) that reuses pachinko-app infra (kernel, PretextCompositor, World Builder, PrivacyFilter, Skill marketplace, settler roster) but stands as its own product with separate branding, marketing surface, eventual extraction.

## Decision
Build Storybook Workshop as a **product branch** inside the pachinko-app monorepo: self-contained under `src/routes/dashboard/storybook-workshop/`, `services/storybook-workshop/`, `tests/storybook-workshop/`. Own kernel manifest (`KidsContentSafetyService`). Own backend routes namespace `/api/storybook-workshop/*`. No deep coupling to fishbowl. Marketing site, landing page, gift flow, email lifecycle = workshop-only surfaces.

## Why
Monorepo for v1 lets us iterate fast on shared kernel/render/privacy primitives without npm-package boundary friction. Self-contained module layout makes future extraction trivial (copy subtree + extract shared infra as npm packages). Spec §11 codifies the extraction trigger: 10k books/mo OR $50k MRR.

## Consequences
- Pachinko-app gains a `/dashboard/storybook-workshop` route that doesn't relate to fishbowl gameplay.
- Workshop benefits from existing kernel, PretextCompositor, World Builder, PrivacyFilter, advisory-council mechanics without code duplication.
- Future repo extraction will require extracting shared infra to npm packages — work scoped now so module boundaries are clean (no cross-imports of fishbowl-specific services).
- Reviewers must enforce the no-cross-imports rule: workshop code must NOT import from fishbowl, spotlight, or claws subtrees. Workshop reads settlers via `SkillMarketplaceService` + `AgentRegistryService` public APIs only.

## See also
- Spec: `docs/superpowers/specs/2026-05-24-storybook-workshop-design.md`
- ADR-0043 — privacy posture (on-device CLIP + pillar match)
