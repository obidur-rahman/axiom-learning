# PRODUCT.md — Axiom Learning

## What this is
A desktop app (Tauri + Next.js static export) that helps a Learner study only what
an exam needs, from their own material. From PDFs, photos, and pasted text of
syllabus, notes, and past questions, it builds a pruned Roadmap (Core / Bridge /
Skipped / Known nodes with reasons), lessons with citations, a Tutor chat grounded
in the material, written-answer practice scoring, and progress tracking.

## Who it is for
- University student with an exam soon (primary; often limited time).
- School student; general learner via Premade Roadmaps.
- First market: Bangladesh. Bangla and English mix freely; both have first-class UI.

## Core mode
**Operate.** Every screen has one main action, shows the reason for each state,
and keeps the next step obvious. Trust matters: every AI answer shows sources or
says plainly "not from your material".

## Product rules (from AXL-PRD-001)
- No account needed for own material; account is optional (premade/share only).
- Features expand or shrink by AI provider capability (probe at config time).
- Material text is data, never instructions. Model names live in one config.
- Daily limits only in hosted-API mode; advisory in local mode.
- Roadmap pruning is deterministic code (packages/engine), never a model.

## Success for a session
The Learner adds a course, adds material, sees topics + exam scope, gets a
readable pruned roadmap, opens a lesson grounded in their notes, and can ask a
cited Tutor question — without needing our help or a login.

## Desktop build status (2026-11-04)
Shipped in this build:
- App shell: a labeled sidebar (Dashboard, Courses, Settings) with AI provider
  status, the local profile and a theme switch; collapses to a top bar in a
  narrow window.
- Dashboard: real counts from the local database (courses, topics finished,
  readable pages), next exam countdown, per-course progress and next topic,
  recent material, and a first-run path when there are no courses.
- Course library: searchable cards with progress, material/page/topic counts and
  exam date; create a course with level, language and exam date.
- Settings: nine anchored sections. Appearance (Light / Dark / System, nine
  accent presets, translucent surfaces, sharp corners, compact density, reduce
  motion), Behaviour (default
  course tab, percentages, exam countdown, citation pages, skipped topics,
  confirm-delete, build toasts), Profile, Study (lesson depth, bridge depth,
  tutor Guide-me default, auto-mark strong practice), Materials (auto rebuild
  roadmap, store embeddings, flag low-confidence pages), AI provider (local or
  hosted, probe, auto-detect from the endpoint's advertised models, desktop
  requests sent by Tauri so local servers need no CORS), Data export, Account
  and About. Every switch is wired to a real effect.
- Visual system: Catppuccin Latte/Mocha with translucent surfaces over an
  ambient canvas, soft rounded corners, nine selectable pastel accents
  (default mauve), micro-animations, indeterminate progress for running jobs
  and toast notifications. Built with shadcn/ui on Base UI primitives (Switch,
  Select, Progress, Tabs, Tooltip, Slider).
- Course workspace: Material, Topics & scope, Roadmap, Lessons, Tutor, Practice
  and Progress in one place. Lessons are a keyboard-navigable slide deck: a
  side slide list, a stage with a layout chosen from the content (concept,
  process, comparison, equation, code), a pulled-out key-idea footer, a final
  check-yourself slide and a Read all view. GFM tables/lists and KaTeX
  formulas render throughout. Tutor answers and practice questions use the
  same Markdown/math.
- Material reading: local files have no fixed per-file size cap. A PDF is only
  rejected when the local reader cannot parse it.
- Background pipeline runs app-wide (not only while a course is open); the
  Windows keyring commands now match the TypeScript bridge.
- Adaptive study (schema v2): per-course study settings with three profiles
  (`past_first`, `notes_first`, `adaptive`), daily study minutes, and a
  deterministic planner in `packages/engine`. The new Study tab shows today’s
  plan, the question ladder, coverage, repeated patterns and a human review
  queue for extracted questions.
- Past-paper question bank: past papers are extracted into draft question rows
  with year, marks, type, difficulty, topic links and citation pages. Nothing
  is auto-confirmed; the learner edits and confirms in Question review. Topic
  weights use confirmed past-question counts when they exist.
- Generated questions from notes for topics with no past papers, always
  labelled “Generated from notes - not a past paper” and never given invented
  past-paper statistics.
- Teaching board: lessons are built one beat at a time (hook, intuition,
  worked example, contrast, note anchor, recall, exam-answer shape) with
  structured blocks, page citations and a check question. Old Markdown lessons
  still open as slides, and the lesson format is a global preference.
- Dashboard today plan: the next three deterministic study items for the
  course closest to its exam, with a deep link into the Study tab.
- Mock exam: assemble up to ten confirmed questions into a deterministic
  paper, write answers, reveal the model answers and self-mark each question.
  The result is saved as attempts so weak topics feed the next plan.

Not in this build (documented, intentionally absent): optional cloud account and
Supabase sync, premade roadmap catalog, share links, tutorial video, daily
limits for hosted APIs, the diagnostic flow for bridge nodes, and proctored or
auto-marked mock exams.
