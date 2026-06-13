---
type: Reference
title: Science of Reading — Pedagogy Baked Into the Product
description: The evidence-based reading science that informs the product's instructional design: orthographic mapping, systematic synthetic phonics, dialogic reading, Scarborough's Reading Rope, and Ehri's phases.
tags: [reading, pedagogy, phonics, research, science-of-reading]
timestamp: 2026-06-12T00:00:00Z
path: docs/research/
---

# Core Frameworks

## Orthographic Mapping (Ehri)

Words are permanently stored in long-term memory when the reader forms a **grapheme-phoneme connection** — they hear the word, see the letters, and map the sound to the spelling simultaneously. This is why words **light up as they are read aloud** in the product: the visual highlight synchronized with audio activates the mapping process.

- Source: `docs/research/01-orthographic-mapping.md`
- Product surface: word-by-word highlight in the read-aloud player.

## Systematic Synthetic Phonics

Children learn to decode by blending **phonemes** (individual sounds) from the smallest units up, rather than by memorizing whole words or using picture cues.

- **Synthetic** = building words from phonemes (b-a-t → "bat"), not analytic ("bat" → "b" is the first sound).
- **Systematic** = phoneme-grapheme correspondences are taught in a deliberate sequence, not incidentally.
- Product surface: **tap any word** to hear it sounded out phoneme by phoneme. The phoneme sequence respects the standard synthetic phonics progression.
- Source: `docs/research/02-synthetic-phonics.md`

## Dialogic Reading (Whitehurst et al.)

Shared reading is most effective when it is **interactive** — the adult (or in this case, the AI) asks open-ended questions, expands on the child's responses, and prompts prediction and connection.

- **PEER sequence**: Prompt, Evaluate, Expand, Repeat.
- **CROWD prompts**: Completion, Recall, Open-ended, Wh-questions, Distancing.
- Product surface: the **talk-about-it prompt** shown after each page spread. The prompt type cycles through CROWD categories.
- Source: `docs/research/03-dialogic-reading.md`; original citation: Whitehurst, G. J. et al. (1988). *Accelerating language development through picture book reading.* Developmental Psychology, 24(4), 552–559.

## Scarborough's Reading Rope

Fluent reading is the **interweaving** of two strands:

1. **Word recognition** (phonological awareness, decoding, sight recognition) — lower strand.
2. **Language comprehension** (background knowledge, vocabulary, language structures, verbal reasoning, literacy knowledge) — upper strand.

Weak readers typically have a breakdown in one or both strands. The product addresses both:
- Word recognition → phonics tap, word highlight, sight-word repetition across books.
- Language comprehension → topic-linked background knowledge in book descriptions, vocabulary callouts, dialogic prompts.

## Ehri's Phases of Word Reading

Ehri identified four phases readers move through:

| Phase | Description | Product mapping |
|---|---|---|
| **Pre-alphabetic** | Reads by visual cues, no letter-sound knowledge | N/A (product assumes pre-K minimum) |
| **Partial alphabetic** | Uses first/last letters; guesses the rest | Station 1 (emergent reader level) |
| **Full alphabetic** | Maps all graphemes to phonemes; can decode unfamiliar words | Station 2–3 |
| **Consolidated alphabetic** | Reads chunks/morphemes; sight recognition fast | Station 4–5 |

The **Station-1 reading-level selector** on the [create flow](/architecture/create-flow.md) maps to Ehri's phases: selecting Station 1 produces books with shorter sentences, higher-frequency vocabulary, and more repetition — appropriate for partial-alphabetic readers.

# Research Sources

- `docs/research/01-orthographic-mapping.md`
- `docs/research/02-synthetic-phonics.md`
- `docs/research/03-dialogic-reading.md`
- Surfaced publicly at `/approach` route in the product.

# Related

- [Create Flow Architecture](/architecture/create-flow.md) — where reading-level selection (Ehri phases) is implemented.
- The word-highlight timing is driven by the TTS word-boundary events; see the read-aloud player component.
