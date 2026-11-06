# Axiom Learning

A local-first desktop study app for exam season. It reads the material you
already have — PDFs, photos of notes, past papers, pasted text — and turns it
into an exam-scoped study plan, a cited teaching board, a grounded tutor,
written-answer practice, a question bank and mock exams.

Everything runs on your machine. There is no account, no upload and no server:
courses, material, lessons and progress live in one local SQLite database.

> **Status: alpha (v0.1.0).** The core loop works end to end, but expect rough
> edges, missing features and schema changes between builds. See
> [Alpha notes](#alpha-notes).

## What it does

- **Courses** — create a course with level, language (English / Bangla / mixed)
  and exam date; the Dashboard shows real counts, a countdown and today's plan.
- **Material intake** — add PDFs, images or pasted text. Pages are read locally
  (pdf.js, tesseract OCR), chunked and embedded; low-confidence pages are
  flagged rather than trusted.
- **Exam-scoped roadmap** — topics are pruned deterministically into Core,
  Bridge, Skipped and Known, and every node states its reason
  (`NEEDED_BY`, `EXCLUDED`, `LOW_WEIGHT`) plus the core topics that need it.
  Pruning never happens in a model.
- **Teaching board** — lessons are built beat by beat (hook, intuition, worked
  example, contrast, note anchor, recall, exam-answer shape) with structured
  blocks, page citations and a check question. Board, Slides and Read all views
  are always available; Present goes full screen with keyboard navigation.
- **Tutor** — chat grounded in your material. Answers cite pages (`[p.3]`) or
  say plainly that the material does not cover the question. Guide-me mode asks
  a short question first.
- **Practice and question bank** — past papers are extracted into draft rows you
  confirm yourself; topics without past papers get questions labelled
  "Generated from notes - not a past paper". The ladder runs easiest to
  hardest and never mixes the two statistics.
- **Study tab** — per-course profiles (`past_first`, `notes_first`,
  `adaptive`), daily study minutes, today's plan, coverage and a review queue
  for extracted questions.
- **Mock exam** — assemble confirmed questions into a paper, write answers,
  reveal model answers and self-mark; results feed the next plan.
- **Progress** — attempts, weak topics and per-course progress, all computed
  locally.
- **Presentation** — Catppuccin light/dark theme, nine accent presets,
  translucent or solid surfaces, compact density, reduce-motion support, and a
  UI that works in both English and Bangla.

## AI provider

Axiom talks to any OpenAI-compatible chat + embeddings endpoint:

- **Local** — LM Studio, Ollama, vLLM, llama.cpp server. Desktop requests go
  through Tauri's HTTP client, so local servers need no CORS configuration.
- **Hosted** — any OpenAI-compatible API. The key is stored in the OS
  credential store (Windows Credential Manager), never in browser storage.

Configure it in **Settings → AI provider**: base URL, chat and embedding model
IDs, **Probe** or auto-detect from the endpoint's advertised models, and a
capability summary. Features expand or shrink with what your provider can do —
embeddings off, for example, falls back to keyword retrieval.

Material text is always data, never instructions: the pipeline keeps model
output behind Zod schemas and renders lesson content as structured blocks, not
arbitrary HTML.

## Requirements

- Windows 10 or 11 (the alpha ships an NSIS installer for Windows)
- [Node.js](https://nodejs.org) 22 LTS or newer, with npm
- [Rust](https://rustup.rs) stable (1.77+) with the MSVC toolchain, for the
  Tauri shell
- An OpenAI-compatible endpoint — a local server is enough to start

## Getting started

```bash
git clone https://github.com/obidur-rahman/axiom-learning.git
cd axiom-learning
npm install
npm run tauri dev -w apps/desktop
```

The first launch creates the database at
`%APPDATA%\com.northaxis.axiomlearning\axiom.db` (Windows). Add a course, drop
in some material, configure the provider in Settings, then generate a roadmap
and a lesson.

## Commands

| Command | What it does |
| --- | --- |
| `npm run tauri dev -w apps/desktop` | Run the desktop app in dev mode (Next dev server + Tauri) |
| `npm run dev:desktop` | Web UI only, against `http://localhost:3000` |
| `npm run typecheck` | TypeScript across every workspace |
| `npm test` | Unit tests (vitest) across every workspace |
| `npm run build` | Static export of the UI into `apps/desktop/out` |
| `npm run tauri build -w apps/desktop` | Production build + Windows NSIS installer |

## Repository layout

```
apps/desktop           Next.js UI (static export) + Tauri 2 shell
  src/app              routes, global tokens and styles
  src/components       app shell, panels, course workspace, settings
  src/lib              job worker, speech, export, provider bridge
  src-tauri            Rust shell: SQLite, HTTP, dialogs, Windows keyring
packages/data          schema, migrations, row mapping, repositories
packages/engine        deterministic roadmap pruning and study planner
packages/pipeline      job steps: read, chunk, embed, roadmap, lesson, tutor
packages/ai            provider-agnostic model client and prompt schemas
docs                   PRD, TRD, schema, design brief, flow, plans
```

`packages/engine` is code, never a model: pruning, ordering and planning are
reproducible and unit-tested.

## Documentation

| File | Contents |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | What ships in this build, and what is deliberately absent |
| [DESIGN.md](DESIGN.md) | Visual system, tokens, states, accessibility floor |
| [docs/axiom-learning-prd.md](docs/axiom-learning-prd.md) | Product requirements |
| [docs/axiom-learning-trd.md](docs/axiom-learning-trd.md) | Technical design |
| [docs/axiom-learning-backend-schema.md](docs/axiom-learning-backend-schema.md) | Database schema |
| [docs/axiom-learning-app-flow.md](docs/axiom-learning-app-flow.md) | Screen-by-screen flow |
| [docs/adaptive-study-and-teaching-plan.md](docs/adaptive-study-and-teaching-plan.md) | Study profiles and teaching board plan |
| [docs/teaching-playbook.md](docs/teaching-playbook.md) | Lesson quality rules |

## Alpha notes

Alpha means "usable by one person on one machine, not yet hardened".

- **Windows only.** No macOS or Linux bundles are built yet.
- **Local-first by design.** No cloud account, sync or premade roadmap
  catalog. "Account" in Settings explains this and marks cloud as unavailable.
- **Your data is yours, and fragile.** Everything lives in the local SQLite
  database; **Settings → Data** exports the whole workspace as JSON. Take an
  export before each build if you care about the contents.
- **Provider-dependent.** Lesson quality, extraction quality and available
  features follow from the model you point it at.
- **Known gaps** (documented, not yet implemented): optional cloud account and
  sync, premade roadmap catalog, share links, tutorial video, hosted-API daily
  limits, the diagnostic flow for bridge nodes, proctored or auto-marked mock
  exams.

Found a problem? Reproduce it on a fresh course where you can, then note the
course topic, the provider and model, and what you expected instead.
