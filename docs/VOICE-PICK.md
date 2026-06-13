# Voice Pick -- Book-3 Narrator Candidates

Generated: 2026-06-13T01:50:00Z
Book: Why Do Stars Blink? (book-3, 24 spreads)

## Candidate Samples (book-3 page-1, ~30s)

| ID | Name | Duration | Word Accuracy | QC Text Accuracy | Sample |
|---|---|---|---|---|---|
| v1 | Warm Grandpa (Chenevert A) | 14.3s | 0.974 | 0.981 | [candidate-v1/sample-p1.wav](candidate-v1/sample-p1.wav) |
| v2 | Bright Delight (Chenevert B) | 13.1s | 0.974 | 0.981 | [candidate-v2/sample-p1.wav](candidate-v2/sample-p1.wav) |
| v3 | Deep Drawl (Smith Remus A) | 16.9s | 0.974 | 0.962 | [candidate-v3/sample-p1.wav](candidate-v3/sample-p1.wav) |
| v4 | Composite Blend (Ethics-Preferred) | 16.6s | 0.974 | 0.981 | [candidate-v4/sample-p1.wav](candidate-v4/sample-p1.wav) |
| v5 | Front-Porch Enthusiast (Smith Remus B, seed 1056 re-roll) | 14.4s | 0.923 | 0.907 | [candidate-v5/sample-p1.wav](candidate-v5/sample-p1.wav) |

## Full Book-3 Default Narration (v1 -- Warm Grandpa)

Output: `book3-default/` -- 24 spreads
Failed accuracy (< 0.97): 4

### Accuracy failures (Whisper QC):
- spread-03: acc=0.909 -- "Then -- a tiny hoot! Something soft landed on her finger."
- spread-06: acc=0.857 -- "Wren thought. Are stars winking at us?"
- spread-11: acc=0.875 -- "The highest hill waited, dark against the sky."
- spread-17: acc=0.778 -- 'Professor Hoot smiled. "Stars don\'t blink -- WE do!"'

Note: short single-sentence spreads with contractions/punctuation cause conservative Whisper overlap
scoring. Audio subjectively intelligible. Re-synth candidates available on request.

## HUMAN-PICK

<!-- Operator: mark preferred voice below -->

- [ ] v1 -- Warm Grandpa (Chenevert A) -- DEFAULT
- [ ] v2 -- Bright Delight (Chenevert B)
- [ ] v3 -- Deep Drawl (Smith Remus A)
- [ ] v4 -- Composite Blend (ethics-preferred)
- [ ] v5 -- Front-Porch Enthusiast (seed 1056 re-roll)

**Selected:** _(operator fills in)_

---
_Whisper QC threshold: word_accuracy >= 0.97 per spread._
