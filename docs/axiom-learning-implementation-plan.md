# Axiom Learning: Implementation Plan

| Item | Value |
|---|---|
| Document ID | AXL-PLAN-001 |
| Version | 1.0 |
| Date | 2026-10-25 |
| Owner | Obidur Rahman, NorthAxis |
| Status | Draft for the prototype |
| Related documents | AXL-PRD-001, AXL-TRD-001, AXL-FLOW-001, AXL-DESIGN-001, AXL-SCHEMA-001, AXL-VIDEO-001 |

Writing rules: This document follows the ASD-STE100 rules as closely as possible. Terms are in the PRD, Section 14.

---

## 1. Purpose

This document gives the work plan for the prototype. It lists the milestones, the tasks, the tests, and the checks.

## 2. Plan summary

- One builder. About 6 weeks. The times are estimates.
- The prototype has all P0 features. Each feature is shallow.
- The first work is a test of models and OCR (milestone M0).
- The Roadmap engine is built and tested as code before the screens.
- A group of about 10 testers uses the prototype in the last week.

## 3. Repository layout

```
axiom-learning/
  apps/
    web/            Next.js app (screens and API routes)
    worker/         Node worker (job runner and pipeline steps)
  packages/
    engine/         Pruning rules, schemas (Zod), shared types
    prompts/        Prompt files with version numbers
  supabase/
    migrations/     SQL files in the order in AXL-SCHEMA-001
    seed/           Premade Roadmap data
  eval/
    sets/           E1 to E5 test sets
    scripts/        Scripts that run the tests
  docs/             The six project documents
```

## 4. Milestones

| ID | Milestone | Time (estimate) | Result |
|---|---|---|---|
| M0 | Model and OCR tests | 3 days | Chosen models, OCR method, embedding model |
| M1 | Setup, login, upload, read files | 5 days | A Learner uploads files and the app reads them |
| M2 | Topics, scope, weights, Roadmap engine | 7 days | A Roadmap for a real Course |
| M3 | Roadmap screens and graph editing | 5 days | The Learner sees and edits the Roadmap |
| M4 | Lessons, Diagnostics, Tutor | 7 days | The Learner studies and asks questions |
| M5 | Practice, Premade Roadmaps, progress, sharing | 6 days | All P0 features present |
| M6 | Bangla pass, limits, test with Learners, fixes | 7 days | The prototype is ready to share |

Total: 40 days of work. This is about 6 weeks with some free time.

## 5. Tasks

Task IDs show the milestone. Each task lists the check that proves it is done.

### M0: Model and OCR tests

| ID | Task | Done when |
|---|---|---|
| M0-1 | Make test sets E2 (Bangla) and E3 (scans). | Both sets are in `eval/sets`. |
| M0-2 | Run 3 or 4 candidate models on E2. Compare topic extraction and answers. | A table of scores exists. |
| M0-3 | Compare the OCR method and the vision method on E3. | A table of errors by page type exists. |
| M0-4 | Test 2 or 3 embedding models on Bangla search. Test trigram search. | The best embedding model and the value `N` are chosen. |
| M0-5 | Write the model configuration file. | One file holds the model names for levels A and B. |
| M0-6 | Estimate the cost for one Course. | A cost figure exists for the steps in the pipeline. |
| M0-7 | Read the data terms of the model provider. | The result is written in the decision log. |
| M0-8 | Test 2 or 3 text-to-speech providers on E7 (voice set). Test Bangla and English. | The best voice provider and the voice IDs are chosen. |
| M0-9 | Test 2 slide-to-video renderers. Check the render time and the output size. | The best renderer is chosen. |
| M0-10 | Read the data terms of the voice provider and the video renderer. | The result is written in the decision log. |

Gate: If no model gives acceptable Bangla results, the team must change the plan. The options are to limit the first release to English, or to use a different model.

### M1: Setup, login, upload, read files

| ID | Task | Done when |
|---|---|---|
| M1-1 | Make the repository. Set up the web app, the worker, and the shared package. | The apps start on a local computer. |
| M1-2 | Make the Supabase project. Run the migrations for accounts, Courses, and Material. | The tables exist. |
| M1-3 | Add login and sign up (FR-001). Add the language switch (FR-002). | A test user logs in. |
| M1-4 | Add the Course screens (FR-010, FR-011). | A Course is made and shown. |
| M1-5 | Add upload with limits and kinds (FR-020 to FR-022). | Each file type uploads. |
| M1-6 | Add the job queue and the worker loop. | A test job runs and ends. |
| M1-7 | Add the read step (TRD 5.1). Save pages with confidence. | A PDF and a photo give page text. |
| M1-8 | Add the processing screen with status (FR-023). | The status changes without a reload. |
| M1-9 | Decide the worker host. | The worker runs outside the local computer. |
| M1-10 | Add delete of a Material (FR-024). | No data of the Material remains. |

### M2: Topics, scope, weights, Roadmap engine

| ID | Task | Done when |
|---|---|---|
| M2-1 | Write the engine package: schemas and the pruning function (TRD 6). | The function passes the unit tests in TRD 6.5. |
| M2-2 | Write the unit tests for the engine. | All tests pass. |
| M2-3 | Add the Topic extraction step (FR-030). | A syllabus gives a Topic tree in E1. |
| M2-4 | Add the Chunk step with section paths and the removal of copies (TRD 5.3). | Chunks have a section path and an embedding. |
| M2-5 | Add past question extraction and linking (FR-035). | Past questions of E1 link to Topics. |
| M2-6 | Add the weight step (FR-034). | Each Topic has a weight. |
| M2-7 | Add the Prerequisite step with the shared table (TRD 5.5). | Edges exist. Cycles are removed. |
| M2-8 | Add the Roadmap build step (FR-040 to FR-042). | A Roadmap saves for E1. |
| M2-9 | Run the Roadmap engine as a script on 2 real Courses. Review the output by hand. | The builder agrees that the Roadmap is useful. |
| M2-10 | Check 100 edges by hand. Record the precision. | The precision value is in the log. |
| M2-11 | Tune the weight values if needed. | The new values are saved. |

Gate: If the hand review shows that the Roadmaps are not useful, fix the extraction before M3.

### M3: Roadmap screens and graph editing

| ID | Task | Done when |
|---|---|---|
| M3-1 | Build the Topic list screen (FR-031). | The Learner edits Topics. |
| M3-2 | Build the Exam scope screen (FR-032, FR-033). | The checkbox and the scope note work. |
| M3-3 | Build the list view of the Roadmap (FR-043). | The list shows type and reason. |
| M3-4 | Build the graph view with React Flow (FR-043). | The graph shows all Nodes. |
| M3-5 | Add mark skip and restore (FR-051). | The update takes less than 1 second for 200 Nodes. |
| M3-6 | Add add Node and delete Node with the warning (FR-052, FR-053). | The warning names the Nodes that need the deleted Node. |
| M3-7 | Add the Override save and rebuild (FR-045). | A rebuild keeps the edits. |
| M3-8 | Add the depth setting (FR-044). | A change updates the Roadmap. |
| M3-9 | Add keyboard control for the graph. | The keyboard test passes. |

### M4: Lessons, Diagnostics, Tutor

| ID | Task | Done when |
|---|---|---|
| M4-1 | Write the retrieval function (TRD 7). | A test query returns the right Chunks in E4. |
| M4-2 | Add the Lesson build step with Citations and the Citation check (FR-060, FR-061). | A Lesson shows with valid Citations. |
| M4-3 | Add the Node page and formula display (FR-050, FR-063). | A page with 10 formulas shows all of them. |
| M4-4 | Add the shorter Lesson for Bridge Nodes (FR-062). | The Bridge Lesson is shorter. |
| M4-5 | Add the Diagnostic (FR-070, FR-071). | A pass sets the status to Known and updates the Roadmap. |
| M4-6 | Add the Tutor with 3 tools and streaming (FR-080). | An answer streams. |
| M4-7 | Add Citations and the no-evidence rule (FR-081, FR-082). | The test questions outside the Material get the mark. |
| M4-8 | Add the Node context and the mode "Guide me" (FR-083, FR-084). | The mode changes the Tutor behavior. |
| M4-9 | Add the prompt rule for Material text (FR-085). Test with a file that has a hidden instruction. | The Tutor ignores the instruction. |
| M4-10 | Run test set E4. Record groundedness. | The result is in the log. |
| M4-11 | Add the Lesson report and the new version (FR-064). | A report saves. A new Lesson replaces the old one. |
| M4-12 | Add the Tutorial Video build step (TRD 5.8). The worker splits the Lesson into Slides, writes the Voice text, makes the Transcript, and renders the audio and the video. | A video builds for a Node in E6. |
| M4-13 | Add the video save and reuse. The API looks for a saved video before it makes a job. | The second open is fast. |
| M4-14 | Run test set E6 and E7. Check the Slides, the Voice text, the Transcript, and the voice quality. | The results are in the log. |

### M5: Practice, Premade Roadmaps, progress, sharing

| ID | Task | Done when |
|---|---|---|
| M5-1 | Add multiple-choice practice (FR-090). | A question shows with an explanation. |
| M5-2 | Add written practice with scores on three parts (FR-091). | Three scores and the model answer show. |
| M5-3 | Run test set E5. Compare the scores with the human scores. | The agreement value is in the log. |
| M5-4 | Make 3 to 5 Premade Roadmaps. Add the seed data. | Each opens without an upload (FR-100, FR-101). |
| M5-5 | Add status, percent done, and the exam countdown (FR-110, FR-111). | The values are correct. |
| M5-6 | Add the daily plan (FR-112). | The list matches the time. |
| M5-7 | Add the share link and copy (FR-120 to FR-122). | A second account copies a Roadmap and sees no Material. |
| M5-8 | Add the practice of past questions (FR-092). | The past questions of a Topic show. |

### M6: Bangla pass, limits, test with Learners, fixes

| ID | Task | Done when |
|---|---|---|
| M6-1 | Check all screen text in Bangla and English. A Bangla reader checks the Bangla. | The text is correct. |
| M6-2 | Add daily limits and messages (FR-130, FR-131). | A limit stops use and shows the reset time. |
| M6-3 | Add account deletion (FR-003). | No data remains. |
| M6-4 | Add the installable web app setup (FR-140). | The install prompt works on a phone. |
| M6-5 | Run the security checks in Section 8. | All checks pass. |
| M6-6 | Run the performance checks (TRD 13). | The values are in the log. |
| M6-7 | Find about 10 testers. Give them a task list. | Each tester tries every feature. |
| M6-8 | Collect feedback with a short form. | The form has the measures S1 to S4. |
| M6-9 | Fix the main problems from the feedback. | The list of fixes is done. |
| M6-10 | Write the cost report (S5). | The cost for each tester each week is known. |

## 6. Dependencies

```
M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6
```

- M2 needs the models and the value `N` from M0.
- M3 needs the Roadmap engine from M2.
- M4 needs the Chunks, the retrieval function, and the TTS/video renderer choices from M0.
- M5 needs the Topics and Lessons from M4.
- M6 needs all P0 features.

## 7. Test plan

| Level | What | When |
|---|---|---|
| Unit | The engine rules (TRD 6.5), schemas, helpers | At each change to the engine |
| Pipeline | Each step on the E1 Courses. Check the output with the schema. | At the end of M2 and M4 |
| Evaluation | E2 to E5 and the measures in TRD 14 | M0, M2, M4, M5 |
| Evaluation (video) | E6 (videos) and E7 (voice quality) and the measures in TRD 14 | M4, M6 |
| End to end | One full flow: sign up, upload, Roadmap, Lesson, Tutor, Practice, video, share | At the end of M3, M5, M6 |
| Security | Section 8 | M6 |
| Learner test | About 10 testers | M6 |

Model output can change between runs. Test with schemas and with score limits. Do not test with exact text.

## 8. Security checks

| ID | Check | Pass when |
|---|---|---|
| SC-1 | Read the data of another user with the API. | The request fails. |
| SC-2 | Open a file link of another user. | The request fails. |
| SC-3 | Open a share link. | Only the Roadmap structure shows. |
| SC-4 | Use a cancelled link. | An error shows. |
| SC-5 | Upload a file with a hidden instruction. | The Tutor ignores the instruction. |
| SC-6 | Send many requests in a short time. | The limit stops the requests. |
| SC-7 | Search the browser code for keys. | No key is present. |
| SC-8 | Delete an account. | No row and no file remain. |
| SC-9 | Open another user's video link. | The request fails. |

## 9. Release checklist

- All P0 requirements pass their checks.
- The security checks pass.
- The limits are on.
- The cost report is done.
- The data terms of the provider are read.
- The free plan limits are checked.
- The Bangla text is checked.
- A backup of the database exists.
- The feedback form is ready.
- TTS voices for Bangla and English are tested.
- Tutorial Videos play on 4G without error.

## 10. Risks and actions

| ID | Risk | Action |
|---|---|---|
| IR-1 | M0 shows poor Bangla results. | Limit the first release to English. Or choose other models. |
| IR-2 | M2 takes more time than planned. | Cut P1 features. Keep P0 features. |
| IR-3 | The worker cannot run on a free host. | Use the lowest-cost host. |
| IR-4 | The free plan limits are too small. | Move to a small paid plan. |
| IR-5 | The testers do not finish the flow. | Reduce the steps. Add help text. |
| IR-6 | The model cost is above the budget. | Use level A more. Reduce the limits. |
| IR-7 | Text-to-speech does not support Bangla well. | Test voices in M0. Limit the first release to English if needed. |
| IR-8 | Video build takes too long or costs too much. | Build on demand. Save and reuse. Set daily limits. |

## 11. Cut list

If time is short, remove these items in this order.

1. FR-112 (daily plan).
2. FR-084 (mode "Guide me").
3. FR-092 (practice of past questions).
4. FR-044 (depth setting).
5. FR-033 (scope note).
6. FR-122 (cancel a share link).

Do not remove P0 features.

## 12. After the prototype

- Review the measures S1 to S5.
- Decide the next work: more Premade Roadmaps, a vision test for scans, draw edges, attach notes to Nodes, or a teacher view.
- Consider LangGraph only if the Roadmap build needs resume after a failure.
- Consider a model fine-tune only if the cost or the quality needs it. Mix known data into the training data.

## 13. Open items

| ID | Item | Owner | Due |
|---|---|---|---|
| OI-1 | Choose the model providers and check the credits. | Builder | Before M0 |
| OI-2 | Choose the first Premade Roadmap Courses. | Builder | Before M5 |
| OI-3 | Set the monthly model budget. | Builder | Before M1 |
| OI-4 | Decide the visual style. | Builder | Before M3 |
| OI-5 | Find a Bangla reader for the text check. | Builder | Before M6 |
