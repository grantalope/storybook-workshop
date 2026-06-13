---
type: Reference
title: Open Knowledge Format (OKF) v0.1 — Specification
description: What this bundle is — Google's Open Knowledge Format for interlinked markdown concept files that form a machine-readable and human-readable digital brain.
tags: [okf, spec, bundle, knowledge-graph, metadata]
timestamp: 2026-06-12T00:00:00Z
---

# What Is OKF?

Open Knowledge Format (OKF) v0.1 is a minimal convention for organizing knowledge as a **graph of markdown files** — a "digital brain" that is simultaneously human-readable, agent-resumable, and machine-parseable.

Canonical spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

# Structure

## Concept Files

Every non-reserved `.md` file in the bundle is a **concept file**. A concept file MUST have:

```yaml
---
type: <non-empty short string>   # REQUIRED
title: ...                       # recommended
description: ...                 # recommended — one sentence
tags: [...]                      # recommended
timestamp: YYYY-MM-DDTHH:MM:SSZ # recommended
---
```

Followed by a **markdown body** with whatever structure is appropriate for the concept (headings, lists, tables, fenced code blocks).

### Type Vocabulary (this bundle)

| Type | Used for |
|---|---|
| `Decision` | Architectural or operational decision — what was decided, why, what was rejected |
| `Concept` | A domain concept, methodology, or pattern that needs explanation |
| `Reference` | External standard, research, or spec that the product depends on |
| `Service` | A running software service or module |
| `Pipeline` | A multi-step data or processing flow |
| `Runbook` | Operational procedure — how to do something |
| `Route` | An HTTP or SvelteKit route |

## Links

Links between concept files use **bundle-relative absolute paths** from the bundle root (the `knowledge/` directory):

```markdown
[Fulfillment Order](/architecture/fulfillment-order.md)
```

Links are **untyped edges** — the relationship type is expressed in the surrounding prose, not in the link syntax. This keeps the format simple while still forming a traversable graph.

Broken links are tolerated — they serve as placeholders for concepts not yet authored.

## Reserved Files

Two filenames are reserved and must not be authored as concept files:

- `index.md` — auto-generated bundle index (all concept files, their types, and titles)
- `log.md` — auto-generated change log

# Conformance

A bundle **conforms to OKF v0.1** when:

1. Every `.md` file that is not `index.md` or `log.md` has a YAML frontmatter block with a non-empty `type` key.
2. Links use bundle-relative absolute paths (starting with `/`, resolved from the bundle root).
3. No concept file duplicates another's path.

# Why This Format?

- **Agent-resumable**: a future agent dropped into the bundle can read any concept file and follow links to understand the full context without re-deriving it from source code.
- **Human-readable**: plain markdown, no proprietary tooling required.
- **Diff-friendly**: each concept is an independent file; changes to one concept don't pollute the diff of another.
- **Graph-native**: the link structure forms a knowledge graph that tools can traverse, index, and query.

# This Bundle

This bundle documents the pachinko-app / LilAIputia / storybook product. Concepts are organized under:

```
knowledge/
  decisions/     — architectural and operational decisions
  architecture/  — system components and data flows
  lfd/           — Loss-Function Development methodology
  references/    — external standards and research
```
