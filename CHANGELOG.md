# Changelog

All notable changes to Axiom Learning are recorded here. The project follows a
loose [Keep a Changelog](https://keepachangelog.com) shape and uses
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Added
- **Hosted provider auto-setup** — pick Groq, OpenRouter, OpenAI, Google
  Gemini, Mistral, Cerebras or xAI and the base URL fills in; paste an API key
  and the chat, OCR and embedding models are read from the endpoint's live
  `/models` list. A custom OpenAI-compatible URL still gets name-based guesses.
- **Model names in progress** — reading, OCR, embedding and content-generation
  steps now name the model doing the work, in the activity rail and in the
  in-page progress cards.

## [0.1.0] - 2026-11-06 — Alpha

First usable build. Windows, local-first, no account.

### Added
- **Course library** — searchable cards with progress, material, page and topic
  counts and an exam date; course creation with level, language and exam date.
- **Dashboard** — real local counts, exam countdown, per-course progress and
  next topic, recent material, a deterministic three-item plan for today, and a
  first-run path when there are no courses.
- **Material intake** — PDF, image and pasted-text material with local OCR,
  chunking and optional embeddings; no per-file size cap beyond what the local
  reader can parse; low-confidence pages are flagged.
- **Exam-scoped roadmap** — deterministic pruning into Core / Bridge / Skipped /
  Known with a stated reason for every node, editable edges and warnings when a
  deletion breaks a prerequisite.
- **Teaching board** — lessons written beat by beat (hook, intuition, worked
  example, contrast, note anchor, recall, exam-answer shape) as structured
  blocks with page citations and a check question; Board, Slides and Read all
  views; Present mode with arrow-key navigation; PDF export.
- **Tutor** — grounded chat with page citations or an explicit "I could not
  find this in your material", plus a Guide-me mode.
- **Study tab** — per-course profiles (`past_first`, `notes_first`,
  `adaptive`), daily minutes, today's plan, coverage, repeated patterns and a
  review queue for extracted questions.
- **Question bank** — past-paper extraction into draft rows that a learner
  confirms by hand, and questions generated from notes that stay labelled as
  generated. The practice ladder runs easiest to hardest.
- **Mock exam** — assemble confirmed questions into a paper, answer, reveal
  model answers and self-mark; results are saved as attempts.
- **Settings** — nine anchored sections; every control is wired to a real
  effect (appearance, behaviour, profile, study, materials, AI provider, data
  export, account, about).
- **AI provider** — local or hosted OpenAI-compatible endpoint, probe and
  auto-detect of advertised models, keys held in the OS credential store, and
  requests sent through Tauri so local servers need no CORS.
- **Visual system** — Catppuccin Latte/Mocha with translucent surfaces, nine
  accent presets, sharp-corner and compact-density opt-outs, reduce-motion
  support, and a Bangla/English UI.

### Changed
- The older single Markdown lesson remains as a fallback: lessons saved before
  the teaching board still open in the deck or Read all view.

### Removed
- The lesson animation system. Model-written animation pages rendered as a
  blank frame, so the per-slide animation prompt, the `writeAnimation` job
  step, the manual "Animate this idea" request, the player component, the
  preference and the frame styles are all gone. Saved lesson JSON keeps any
  animation it already holds; nothing reads it.

### Known gaps
Documented as intentionally absent for alpha: cloud account and sync, premade
roadmap catalog, share links, tutorial video, hosted-API daily limits, the
diagnostic flow for bridge nodes, proctored or auto-marked mock exams, and
non-Windows bundles.

[0.1.0]: https://github.com/obidur-rahman/axiom-learning/releases/tag/v0.1.0
