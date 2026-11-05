# Axiom Learning — Adaptive Study Plan and Teaching Engine

**Status:** Implemented (Milestones 0–3 plus a basic Milestone 4 mock exam)
**Date:** 2026-11-05
**Purpose:** Implementation and handoff plan for any coding agent continuing this work.
**Scope:** Study profiles, question bank, adaptive study queue, teaching lessons, small-model orchestration, mock exams.

---

## 1. Read this first

Before changing code, read:

1. `PRODUCT.md` — product rules and current build status.
2. `DESIGN.md` — visual language and component conventions.
3. `docs/axiom-learning-app-flow.md` — screens and flows.
4. `packages/data/src/ddl.ts` — current local SQLite schema.
5. `packages/engine/src/build.ts` — deterministic roadmap engine.
6. `packages/pipeline/src/prompts.ts` — current model prompts.
7. `packages/pipeline/src/lessons.ts` and `packages/pipeline/src/steps.ts` — current lesson/weight pipeline.
8. `apps/desktop/src/lib/worker.ts` — in-process job runner.
9. `apps/desktop/src/components/lessons-panel.tsx` and `lesson-deck.tsx` — current lesson UI.

The app is local-first, Tauri + Next.js static export, with SQLite through `DbDriver`.
No account, no server. Model calls go through the configured local/hosted provider.

---

## 2. The problem

The app currently organises studying **by topic**. Most students organise by **exam questions or by notes**, and those are different workflows.

Current gaps:

- Past papers are only a `materials.kind`. The app counts topic-title mentions in past-paper text to estimate weight. There is no question bank.
- Lessons are one model call that returns 4–8 Markdown sections of 35–90 words. The prompt asks for scannable summaries, so the output is a summary with bullets.
- Practice is one MCQ + one written question per topic. There is no cross-topic session, no question ladder, no mock exam.
- There is no way to choose a study style. The roadmap order is the only plan.
- The current slide UI infers layouts from Markdown after generation. Content quality cannot be fixed by styling alone.

Product decision: do not build separate apps per study style. Build **one deterministic study queue** that different profiles order differently.

---

## 3. Locked product decisions

1. **Profiles are per course, with app-wide defaults.**
   A student may study a past-paper course and a new notes-only course at the same time.

2. **Three initial profiles:**
   - `past_first` — past questions easiest → hardest, with notes support.
   - `notes_first` — concepts easiest → hardest, with generated questions.
   - `adaptive` — short diagnostic, then weak areas, then mixed review.
   Default: `adaptive`.

3. **Time is a modifier, not a fourth profile.**
   Store `daily_minutes`; use it to cut the queue, not to change pedagogy.

4. **Real and generated questions are visually distinct.**
   Never show “asked N times” for generated questions. Never invent past-paper statistics.

5. **Past questions are first-class rows, not just a PDF.**
   Extraction is a model job, but confirmation is a human action.

6. **The app plans; the model transforms; code validates.**
   The study order, beat sequence, and visual grammar are deterministic. The model fills small content units.

7. **Replace the primary lesson deck with a teaching board.**
   Keep a Present mode and a Read-all fallback. The default should feel like a tutor at a whiteboard, not slides of summaries.

8. **No new npm dependencies without a clear reason.**
   Reuse React, Markdown, KaTeX, existing shadcn/Base UI, SVG/CSS. No diagram or animation library by default.

---

## 4. Target model

### 4.1 Study profile

```ts
export type StudyProfile = 'past_first' | 'notes_first' | 'adaptive';

export interface CourseStudySettings {
  courseId: string;
  profile: StudyProfile;
  dailyMinutes: number;        // 15–240, default 45
  hasPastPapers: boolean;      // learner answer, not inferred
  planVersion: number;         // bumped when the learner regenerates the plan
  updatedAt: string;
}
```

Course setup should ask only:

1. Do you have past papers for this course?
2. Learn questions first, notes first, or mix?
3. Exam date and daily study time.

Do not expose pedagogy jargon. Explain choices in one sentence each.

### 4.2 Study item

```ts
export type StudyItemKind =
  | 'question'      // past or generated
  | 'lesson'        // teaching board for a topic
  | 'recall'        // short active-recall card
  | 'mock';         // mock paper section

export interface StudyItem {
  id: string;                 // deterministic: kind + ref id + order
  kind: StudyItemKind;
  refId: string;              // question id / topic id / lesson id
  topicId: string | null;
  title: string;
  reason: string;             // why this is next, shown in UI
  estimatedMinutes: number;
  difficulty: number | null;  // 1–5 for questions
  source: 'past_paper' | 'generated' | 'notes' | 'mock';
  status: 'pending' | 'done' | 'skipped';
}
```

The plan is **computed on load**, not persisted. Persist only attempts and settings. This keeps replanning cheap and avoids stale queues.

### 4.3 Profile rules

**past_first**

1. Confirm past questions grouped by topic.
2. Within each topic, sort by difficulty ascending, then year, then order.
3. For a question: open question → attempt → “teach me the pattern” → mark result.
4. After all past questions for a topic, queue that topic’s teaching lesson as a notes pass.
5. After 80% of confirmed questions are done, queue mixed review and mock sections.
6. Topics with no past questions become generated-question topics, clearly labelled.

**notes_first**

1. Order topics by roadmap order.
2. For each topic: teach lesson → worked example → generated questions easiest → hardest → recall.
3. After all topics, queue mixed review and mock sections.
4. If past papers exist, offer them as an optional “past paper pass” at the end.

**adaptive**

1. Diagnostic: 3–5 generated or confirmed questions covering different topics.
2. Score each topic: wrong = high priority; partial = medium; correct = low.
3. Priority = topic weight × weakness × exam proximity.
4. Interleave: lesson → two questions → recall for each weak topic.
5. Recompute after every 3 attempts.

### 4.4 Plan algorithm

Create a pure function in `packages/engine`:

```ts
export interface StudyPlanInput {
  profile: StudyProfile;
  dailyMinutes: number;
  examDate: string | null;
  topics: PlanTopic[];        // id, title, weight, order, type, progress
  questions: PlanQuestion[];  // id, topicIds, source, difficulty, status
  lessons: PlanLesson[];      // topicId, status
  attempts: PlanAttempt[];    // questionId, result, score, completedAt
  now: string;
}

export interface StudyPlan {
  daysUntilExam: number | null;
  items: StudyItem[];         // timeboxed for today
  backlog: StudyItem[];       // next items, not shown by default
  coverage: {
    pastQuestionsDone: number;
    pastQuestionsTotal: number;
    topicsTaught: number;
    topicsTotal: number;
  };
}
```

Rules:

- Deterministic: same inputs always produce the same order.
- Timebox: include items until `dailyMinutes` is reached, but always include at least one item.
- Skip `known` topics unless the learner asks to review.
- Do not schedule a lesson when the topic already has `in_progress` or `done` progress, unless the lesson is explicitly a recall pass.
- Tie-break by roadmap `order`, then `topicId`, then `questionId`.
- Add unit tests with fixed fixtures for all three profiles.

---

## 5. Database changes

### 5.1 Migration mechanism

Current `initDb` runs `MIGRATIONS` with `CREATE TABLE IF NOT EXISTS` on every start. That cannot handle `ALTER TABLE` or a changed `jobs` CHECK constraint safely.

Add a small versioned migration runner:

- `schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`.
- On first run after upgrade:
  - If `courses` exists and `schema_meta` is empty, insert `schema_version = 1`.
  - Apply `MIGRATION_V2` once, then set `schema_version = 2`.
- Keep `MIGRATIONS` as the v1 baseline for fresh installs.
- New code must be idempotent and safe to re-run.

Do not use `ALTER TABLE courses`. Use new tables instead where possible.

### 5.2 New tables

```sql
CREATE TABLE IF NOT EXISTS course_study_settings (
  course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  profile TEXT NOT NULL DEFAULT 'adaptive'
    CHECK (profile IN ('past_first','notes_first','adaptive')),
  daily_minutes INTEGER NOT NULL DEFAULT 45
    CHECK (daily_minutes BETWEEN 15 AND 240),
  has_past_papers INTEGER NOT NULL DEFAULT 0,
  plan_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  material_id TEXT REFERENCES materials(id) ON DELETE SET NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('past_paper','generated','user')),
  prompt TEXT NOT NULL,
  answer_md TEXT,
  rubric_json TEXT,
  year INTEGER,
  paper_label TEXT,
  question_number TEXT,
  marks INTEGER,
  question_type TEXT NOT NULL DEFAULT 'other'
    CHECK (question_type IN
      ('definition','explanation','derivation','numerical','comparison',
       'diagram','essay','code','other')),
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  difficulty_source TEXT NOT NULL DEFAULT 'model'
    CHECK (difficulty_source IN ('model','user','computed')),
  pattern_key TEXT,
  pattern_label TEXT,
  citation_pages TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','rejected')),
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS exam_questions_course_idx
  ON exam_questions (course_id, status, topic_id);

CREATE TABLE IF NOT EXISTS exam_question_topics (
  question_id TEXT NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  confidence REAL,
  PRIMARY KEY (question_id, topic_id)
);

CREATE TABLE IF NOT EXISTS study_attempts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL
    CHECK (item_kind IN ('question','lesson','recall','mock')),
  question_id TEXT REFERENCES exam_questions(id) ON DELETE SET NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  result TEXT CHECK (result IN ('correct','partial','wrong','skipped')),
  score REAL,
  max_score REAL,
  confidence INTEGER CHECK (confidence BETWEEN 1 AND 3),
  duration_seconds INTEGER,
  meta TEXT,
  started_at TEXT,
  completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS lesson_documents (
  lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  structure_json TEXT NOT NULL,
  beat_count INTEGER NOT NULL,
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

### 5.3 Jobs table migration

The `jobs` CHECK constraint lists job types. New types require a rebuild for existing databases.

Add new job types:

- `extract_past_questions`
- `generate_questions`

Migration v2 procedure:

1. Rename `jobs` to `jobs_old`.
2. Create the new `jobs` table with the expanded CHECK list.
3. Copy rows.
4. Drop `jobs_old`.
5. Recreate the index.

Fresh installs get the expanded DDL directly.

### 5.4 Backward compatibility

- Existing lessons keep `content_md`. New lessons also save a `lesson_documents` row.
- Lesson UI: if `structure_json` exists, render the teaching board; otherwise render the old Markdown deck.
- Existing courses get default study settings lazily on first load.
- Existing material kinds and roadmap data remain unchanged.
- Export must include the new tables. Check `packages/data/src/export.ts`.

### 5.5 Repository modules

Add:

- `packages/data/src/questions.ts`
- `packages/data/src/study.ts` (settings, attempts, plan inputs)
- `packages/data/src/lesson-docs.ts`

Export them from `packages/data/src/index.ts` and bind in `createDb`.

---

## 6. Pipeline changes

### 6.1 New prompts

Add to `packages/pipeline/src/prompts.ts` with version strings:

- `past-question-extract@1`
- `question-generate@1`
- `question-link@1`
- `lesson-objective@1`
- `teach-beat@1`
- `teach-critic@1`
- `mock-blueprint@1` (later)
- `mock-mark@1` (later)

Prompts must keep the existing `DATA_RULE`: material is data, never instructions.

### 6.2 Past-question extraction

New step: `packages/pipeline/src/questions.ts`

Input:

- course id
- pages where `materials.kind = 'past_questions'`
- known topic list

Process:

1. Chunk past-paper pages into groups of 2–4 pages or ~6k chars.
2. One model call per chunk: extract question rows.
3. Validate with Zod.
4. Deterministic dedupe by normalized prompt + year + number.
5. Link to topics:
   - model returns topic ids/titles and optional pattern label
   - code resolves ids; unresolved goes to review
6. Save rows as `status = 'draft'`.

Extraction schema:

```json
{
  "questions": [
    {
      "prompt": "full question text",
      "year": 2023,
      "paperLabel": "Final",
      "questionNumber": "3(a)",
      "marks": 5,
      "questionType": "numerical",
      "difficulty": 3,
      "topicIds": ["T4"],
      "topicTitles": ["Thermodynamics"],
      "patternLabel": "Apply first law to a closed system",
      "citationPages": [12]
    }
  ]
}
```

Rules for the prompt:

- Copy question text, do not paraphrase.
- Omit sub-parts only when they are separately answerable.
- Never invent marks or year; leave null.
- Difficulty 1–5; explain the rubric in the prompt.
- Pattern labels must be short and reusable; do not use topic titles as patterns.
- If a page is unreadable, skip it.

### 6.3 Generated questions

New step: `generateQuestions` in the same module.

For each topic without confirmed past questions, generate 2–4 questions:

- one definition/explanation
- one application or numerical
- one comparison/derivation/diagram depending on the topic
- answer + rubric + citation pages

Save with `source = 'generated'`, `status = 'confirmed'` only if the learner accepts; otherwise `draft`. Default: `draft`, with a “Confirm all” action.

UI copy must always say “Generated from your notes — not a past paper.”

### 6.4 Topic weights

Replace the title-mention heuristic with question-based counts when confirmed questions exist:

- `past_question_count` = number of confirmed past-paper questions linked to the topic.
- `past_question_share` = count / max count.
- Fall back to the current mention count only when no confirmed question bank exists.
- Keep `computeWeights` in `packages/engine/src/weights.ts`; change the input source, not the formula.

### 6.5 Lesson pipeline: from summary to teaching

Current `buildLessonStep` gets 8 pages and asks for sections. Replace with a staged pipeline.

**Stage A — objective and beat plan (deterministic + tiny model call)**

Code chooses the beat skeleton from available material and question links:

```ts
type LessonBeatKind =
  | 'hook'
  | 'intuition'
  | 'worked'
  | 'contrast'
  | 'note_anchor'
  | 'recall'
  | 'exam_shape';
```

Default sequence:

1. `hook`
2. `intuition`
3. `worked`
4. `contrast`
5. `note_anchor`
6. `recall`
7. `exam_shape`

Skip or merge a beat when the topic has no suitable material. The model may write the objective and a one-line “why this matters”, but it does not choose the pedagogy.

**Stage B — one beat per call**

Send only the pages needed for that beat (max ~6k chars) plus:

- topic title
- objective
- related past question prompts
- the beat kind
- a good and bad example
- output schema

Beat schema:

```json
{
  "title": "claim, not a label",
  "kind": "worked",
  "intro": "1–2 sentences",
  "blocks": [
    { "type": "text", "text": "..." },
    { "type": "steps", "items": ["...", "..."] },
    { "type": "callout", "tone": "trap", "text": "..." }
  ],
  "takeaway": "one sentence",
  "check": { "prompt": "...", "answer": "..." },
  "citationPages": [4]
}
```

Allowed block types for v1:

- `text`
- `steps`
- `compare` (left/right rows)
- `equation` (latex + labels)
- `code` (language + code + trace)
- `callout` (trap, tip, note)
- `flow` (nodes + edges)
- `recall` (prompt + hidden answer)

No image generation. No arbitrary HTML.

**Stage C — critic and repair**

`teach-critic@1` checks:

- Is this explaining, or just listing?
- Is there a concrete example?
- Is every claim supported by a cited page?
- Is the check question answerable from the beat?
- Does it repeat the title instead of teaching it?

If a beat fails, regenerate only that beat, max 2 attempts. If it still fails, keep the notes excerpt and a “Ask the tutor” action rather than shipping a bad slide.

### 6.6 Small local model strategy

This is mandatory, not optional. Assume a 7B model unless the provider probe says otherwise.

- **One beat per call**, not one lesson per call.
- **Tiny context**: 1–3 pages per beat, hard char cap.
- **Tiny output**: < 800 tokens per beat.
- **Low temperature**: 0.1 for extraction, 0.3 for teaching, 0 for critic.
- **Few-shot**: include one strong beat and one bad “summary” beat in the prompt.
- **Deterministic skeleton**: code decides beat order and block types.
- **Zod validation** after every call; existing retries stay.
- **Repair, not regenerate**: regenerate only the failing beat.
- **Cache**: reuse retrieved pages within a lesson; do not re-embed per beat.
- **Fallback**: notes + outline + tutor link if the model fails twice.

Add an option to `boundedModelTask` for temperature and max tokens; keep the default behaviour unchanged.

### 6.7 Prompt evaluation harness

Create `packages/pipeline/tests/evals/` with 3 fixtures:

1. A definition-heavy topic.
2. A numerical/derivation topic.
3. A process/diagram topic.

Each fixture contains note pages and a rubric:

- teaches rather than summarises
- has a worked example
- cites pages
- check question is answerable
- no invented facts
- no bullet-only slide

Run against the configured provider manually (not in CI). Record results in `docs/teaching-evals.md` with prompt version and model. This is how prompt changes become measurable.

---

## 7. UI changes

### 7.1 Course creation

Modify `apps/desktop/src/components/course-library.tsx`:

- Add profile selector (3 cards or a segmented control).
- Add daily minutes input.
- Add “I have past papers for this course” toggle.
- Keep the existing title, level, language, exam date.
- On create, insert `course_study_settings`.

Do not add a multi-step wizard yet; keep it one form with a short explanation.

### 7.2 Course workspace

Add a new tab: `study` (`Study`), placed first after Material.

Update `CourseTab` in `apps/desktop/src/lib/prefs.ts` and `course-screen.tsx`.

The Study tab contains:

```text
[ Header: exam countdown | profile | daily time | change plan ]
[ Today: 3 items with estimated minutes and reason ]
[ Question ladder: easiest → hardest, grouped by topic ]
[ Patterns: repeated question types, asked years, marks share ]
[ Generated question notice, if applicable ]
[ Mock exam button (phase 4) ]
```

Empty states:

- No topics yet → link to Material / Topics.
- No past papers → explain that generated questions come from notes and are labelled.
- Model unavailable → show the raw note pages and a retry action.

### 7.3 Question review

New component: `apps/desktop/src/components/question-review.tsx`.

- List extracted drafts grouped by year or topic.
- Inline edit prompt, marks, type, difficulty, topic.
- Confirm, reject, merge duplicate.
- “Confirm all” for a clean extraction.
- Show citation page and source material.

This screen is required. Do not auto-confirm extraction.

### 7.4 Lesson board

New component: `apps/desktop/src/components/lesson-board.tsx`.

Replace the default `LessonDeck` use inside `lessons-panel.tsx`.

Layout:

- Context rail: topic, source pages, related questions, progress.
- Board: title, beat content, visual block.
- Action strip: `Explain again`, `Show example`, `Your turn`, `Next`.

Behaviour:

- One beat at a time.
- Optional progressive reveal inside a beat (`steps` reveal one by one).
- Keyboard: arrows, Home/End, Escape exits Present.
- Present mode still full-screen.
- Mobile: context rail collapses to a top strip.
- Fallback: if no `structure_json`, render the old `LessonDeck`.

Visual rules:

- One idea per beat.
- Title is a claim, not a label.
- Max two short paragraphs plus one visual.
- Every worked beat has numbered steps.
- Every recall beat hides the answer until requested.
- Use the Catppuccin accent tokens already defined; no new palette.

### 7.5 Dashboard

Replace the generic “continue” area with today’s plan when a course is ready:

- next 3 study items
- exam countdown
- “Start studying” deep link to `/course?id=...&tab=study`

Keep the existing empty state for browser mode.

### 7.6 Settings

Add to Study defaults:

- Default study profile.
- Default daily minutes.
- Lesson format: `Guided board` (default) / `Slide deck` / `Read all`. This is the “different people” escape hatch, not a per-course requirement.

Per-course settings override app defaults.

---

## 8. File map

### Create

- `packages/engine/src/study-plan.ts`
- `packages/engine/tests/study-plan.test.ts`
- `packages/data/src/questions.ts`
- `packages/data/src/study.ts`
- `packages/data/src/lesson-docs.ts`
- `packages/pipeline/src/questions.ts`
- `packages/pipeline/src/teach.ts`
- `apps/desktop/src/components/study-panel.tsx`
- `apps/desktop/src/components/question-review.tsx`
- `apps/desktop/src/components/lesson-board.tsx`
- `apps/desktop/src/components/study-settings.tsx`
- `docs/teaching-playbook.md`
- `docs/teaching-evals.md`

### Modify

- `packages/data/src/ddl.ts`
- `packages/data/src/init.ts`
- `packages/data/src/index.ts`
- `packages/data/src/types.ts`
- `packages/data/src/jobs.ts`
- `packages/data/src/export.ts`
- `packages/data/src/lessons.ts`
- `packages/pipeline/src/prompts.ts`
- `packages/pipeline/src/lessons.ts`
- `packages/pipeline/src/steps.ts`
- `packages/pipeline/src/index.ts`
- `packages/pipeline/src/practice.ts`
- `packages/engine/src/index.ts`
- `apps/desktop/src/lib/worker.ts`
- `apps/desktop/src/lib/events.ts`
- `apps/desktop/src/lib/prefs.ts`
- `apps/desktop/src/components/course-library.tsx`
- `apps/desktop/src/components/course-screen.tsx`
- `apps/desktop/src/components/lessons-panel.tsx`
- `apps/desktop/src/components/dashboard.tsx`
- `apps/desktop/src/components/preferences-form.tsx`
- `apps/desktop/src/app/settings/page.tsx`
- `apps/desktop/src/app/globals.css`
- `PRODUCT.md`
- `DESIGN.md`
- `docs/axiom-learning-app-flow.md`

### Do not touch without a reason

- Roadmap graph UI and `packages/engine/src/build.ts` except for plan inputs.
- Tutor chat behaviour.
- Provider transport.
- Theme/accent system established in the previous UI work.

---

## 9. Milestones

### Milestone 0 — Foundations

- Add versioned migration runner.
- Add new tables and repositories.
- Rebuild `jobs` for new job types.
- Add `StudyProfile`, `StudyItem`, repositories, and exports.
- Add deterministic `buildStudyPlan` with tests.
- Course creation writes default study settings.

**Acceptance:** existing DB upgrades without data loss; `npm run typecheck` and `npm test` pass; fresh DB works.

### Milestone 1 — Question bank

- Add `extract_past_questions` job and worker branch.
- Implement chunked extraction, dedupe, topic linking, draft rows.
- Add `question-review.tsx`.
- Add generated questions for topics without past papers.
- Change weight calculation to use confirmed questions.
- Show source and citation pages everywhere.

**Acceptance:** upload a past paper → job runs → drafts appear → learner confirms → ladder shows correct counts → generated questions are labelled and cited.

### Milestone 2 — Study plan and Study tab

- Add course study settings UI.
- Add Study tab with Today, ladder, patterns, coverage.
- Wire dashboard next items.
- Implement all three profiles in the plan engine and UI.
- Add “change plan” action.

**Acceptance:** each profile produces a different deterministic order on the same fixture; no past papers still produces a usable notes-first plan; empty states are clear.

### Milestone 3 — Teaching engine and board

- Add `lesson_documents` and structure JSON.
- Add deterministic beat skeleton.
- Add per-beat prompts, few-shot examples, validator, critic, repair.
- Build `lesson-board.tsx` with visual blocks.
- Keep old Markdown deck fallback.
- Add “Explain again” and per-beat regeneration.
- Add `docs/teaching-playbook.md`.

**Acceptance:** a 7B model can produce one usable lesson with at least one worked example, one visual block, citations, and a recall check; old saved lessons still open; failed beats fall back honestly.

### Milestone 4 — Mock exams and mastery

- Add mock paper assembly from confirmed questions + generated questions.
- Add sections, marks, timer, submit.
- Add per-question and overall scoring.
- Add weak-topic feedback into the plan.
- Add `study_attempts` history and simple spaced review (deterministic intervals, no ML).

**Acceptance:** a student can sit a timed paper, see a score, and the next plan prioritises weak topics.

### Milestone 5 — Evaluation and polish

- Run prompt evals on the three fixtures.
- Compare prompt versions in `docs/teaching-evals.md`.
- Browser QA: desktop + narrow, light + dark, accent variants.
- Run the Impeccable detector on changed UI files.
- Update design docs.

**Acceptance:** no detector findings; typecheck, tests, and desktop build pass.

---

## 10. Testing

### Unit

- `packages/engine`: plan ordering for all profiles, timeboxing, known/skipped handling, determinism.
- `packages/data`: question CRUD, dedupe, migration runner, attempts.
- `packages/pipeline`: extraction schema, dedupe, beat validator, critic retry behaviour with a fake provider.

### Integration

- Existing data upgrade: start with a v1 DB, run `initDb`, verify new tables and old lessons.
- Job flow: enqueue extraction, claim, run against a fake provider, confirm drafts.
- Lesson flow: per-beat generation with one forced schema failure, confirm repair and fallback.

### Manual

- Create a course with past papers and one without.
- Switch profiles and verify the plan changes.
- Generate a lesson with a small local model.
- Check mobile and dark mode.
- Check keyboard navigation and reduced motion.

Commands:

```powershell
npm run typecheck
npm test
npm run build -w apps/desktop
```

For UI review:

```powershell
C:\Users\Ashfin\.config\opencode\skills\impeccable\scripts\impeccable.cmd detect --json <changed files>
```

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| 7B model produces poor lessons | Deterministic beats, per-beat calls, few-shot, critic, repair, fallback |
| Bad question extraction | Draft status, review UI, inline edit, no auto-confirm |
| Fake confidence in generated questions | Explicit labels, no past-paper stats, citations on every row |
| Migration breaks existing DB | Versioned runner, new tables only, test with v1 fixture |
| New job types blocked by CHECK | Rebuild `jobs` in migration v2, test upgrade path |
| UI becomes too configurable | Three profiles + time + lesson format only; no per-topic pedagogy switches |
| Scope creep into image generation | Structured visual blocks only; no image models |
| Prompt changes regress quality | Eval fixtures and recorded results per prompt version |

---

## 12. Handoff instructions

If another agent continues:

1. Start with Milestone 0 only. Do not jump to UI.
2. Read the current files listed in section 1.
3. Keep changes small and run typecheck/tests after each milestone.
4. Do not rewrite the roadmap engine or the theme system.
5. When adding a prompt, bump its version and record it with the saved result.
6. When adding a table, update `export.ts`.
7. When adding a job type, update `ddl.ts`, migration v2, `JobType`, and `worker.ts`.
8. When changing lesson output, keep `content_md` for backward compatibility and export.
9. Run the Impeccable detector for every UI milestone.
10. Update `PRODUCT.md`, `DESIGN.md`, and `docs/axiom-learning-app-flow.md` when the user-facing flow changes.

### Recommended first commit

> Migration runner + new tables + `buildStudyPlan` with tests + course study settings write-through.

No UI yet. This gives the rest of the work a stable base.

---

## 13. Open decisions

These can be settled during implementation; defaults are listed.

- **Pattern clustering:** start with the model’s `patternLabel` and deterministic normalization/grouping. Add embeddings only if labels are noisy.
- **Generated questions default:** drafts, with “Confirm all”. In `past_first`, generated questions appear only after real ones.
- **Mock exam timing:** phase 4; keep a simple countdown and auto-submit. No proctoring.
- **Diagrams:** v1 uses structured flow/timeline blocks. A richer diagram editor is out of scope.
- **Lesson format preference:** global default with per-course override later; v1 can be global only.
- **Sharing/premade:** unaffected by this work.
