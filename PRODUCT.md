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
