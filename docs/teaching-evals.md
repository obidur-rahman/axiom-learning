# Teaching Evals

**Status:** Harness defined; results are recorded manually against the
configured provider. Evals are not part of CI because they need a live model.

## How to run

1. Start the app with the provider you want to test.
2. Create a course from one fixture below and upload the note pages.
3. Generate the lesson in the Lessons tab.
4. Score each row Yes / No in the table.
5. Record prompt version and model name.

## Fixtures

### A. Definition-heavy topic

- Notes: two pages defining osmosis, diffusion, and tonicity.
- Expected: plain-language intuition, a contrast block between osmosis and
  diffusion, and an exam-shape beat that names the required definition wording.

### B. Numerical / derivation topic

- Notes: two pages on the first law of thermodynamics with one worked example.
- Expected: numbered steps, a substituted equation, and a check question that
  uses the same sign convention.

### C. Process / diagram topic

- Notes: two pages on the cardiac cycle.
- Expected: a flow or steps block in the right order, one recall question, and
  no invented pressure values.

## Rubric

| Check | Fixture A | Fixture B | Fixture C |
|---|---|---|---|
| Teaches rather than summarises | — | — | — |
| Has a concrete example or worked step | — | — | — |
| Cites the supporting page | — | — | — |
| Check question is answerable from the beat | — | — | — |
| No invented facts or numbers | — | — | — |
| No bullet-only slide | — | — | — |
| Fallback is honest when the model fails | — | — | — |

## Recorded runs

| Date | Model | Prompt versions | A | B | C | Notes |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | No run yet in this build. |
