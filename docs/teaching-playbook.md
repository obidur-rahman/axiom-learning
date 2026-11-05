# Teaching Playbook

**Status:** Implemented for the teaching board (`teach-beat@1`).
**Date:** 2026-11-05

## Why the old lesson failed

The earlier lesson prompt asked for a 4–8 section slide deck in 35–90 words per
section. That produces scannable summaries. A summary names an idea; it does not
teach the reasoning, the worked step, or the shape of an exam answer.

The board fixes this by deciding the pedagogy in code and asking the model for
one small teaching beat at a time.

## The beat skeleton

| Beat | Job |
|---|---|
| `hook` | A concrete situation or question that makes the learner want the answer. |
| `intuition` | The idea in plain language, with one analogy or small example. |
| `worked` | One exam-style example, start to finish, with numbered steps. |
| `contrast` | The idea next to the thing students confuse it with. |
| `note_anchor` | The exact note wording, explained part by part. |
| `recall` | One short question answerable from the earlier beats. |
| `exam_shape` | What the marker looks for, the answer order, and the trap. |

A bridge recap keeps `hook`, `intuition`, `worked`, `recall`.

## Required content shape

- The title is a claim, not a label. Never the topic name.
- At most two short text blocks and one visual block per beat.
- A worked beat has a `steps` block. A recall beat has a `recall` block.
- Every factual claim cites a page. Missing evidence is said plainly.
- The check question must be answerable from the beat itself.

## Allowed visual blocks

`text`, `steps`, `compare`, `equation`, `code`, `callout`, `flow`, `recall`.

No images, no HTML, no new dependencies. The app renders each block with the
existing Catppuccin tokens.

## Small-model contract (assume 7B)

1. One beat per call.
2. One to three pages per beat, hard character cap.
3. Under 900 output tokens.
4. Temperature 0.3 for teaching, 0 for the critic.
5. Zod validation on every call.
6. Critic pass on `intuition`, `worked` and `exam_shape`; use the repaired beat
   when it validates.
7. On failure, keep the cited note excerpt and a Tutor link. Do not invent.
8. The old Markdown lesson remains the honest fallback for old data.

## Prompt versions

- `lesson-objective@1`
- `teach-beat@1`
- `teach-critic@1`
- `past-question-extract@1`
- `question-generate@1`

Bump the version whenever the system prompt changes, and record the result in
`docs/teaching-evals.md`.
