# Axiom Learning: Technical Requirements Document (TRD)

| Item | Value |
|---|---|
| Document ID | AXL-TRD-001 |
| Version | 1.0 |
| Date | 2026-10-25 |
| Owner | Obidur Rahman, NorthAxis |
| Status | Draft for the prototype |
| Related documents | AXL-PRD-001, AXL-SCHEMA-001, AXL-PLAN-001, AXL-VIDEO-001 |

Writing rules: This document follows the ASD-STE100 rules as closely as possible. Terms are in the PRD, Section 14.

---

## 1. Scope

This document states how to build the prototype. It covers the architecture, the data pipeline, the Roadmap rules, the retrieval method, the model use, security, cost, and tests.

## 2. Design rules

These rules come from the work in this project and from the research papers that the team read.

| ID | Rule | Reason |
|---|---|---|
| DR-1 | Put the workflow logic in code. Use the model only for small, bounded tasks. | Code is testable and cheap. The paper "Blueprint First, Model Second" supports this method. |
| DR-2 | Do the Roadmap pruning in code. Do not use a model. | The result is the same each time. The app can show a reason. |
| DR-3 | Send a model only a small set of relevant text. | Model quality falls when the input is long. See the Chroma "Context Rot" report. |
| DR-4 | Use retrieval. Do not fine-tune a model on Course content. | Fine-tuning on new facts can cause wrong answers. |
| DR-5 | Use one Tutor agent with a few tools. Do not use many agents. | A fixed pipeline does not need many agents. Many agents cost more tokens. |
| DR-6 | Save each made result. Show the saved result again. | The same model call can give different text. |
| DR-7 | Use a different model to judge a result than the model that made it. | A model can favor its own output. |
| DR-8 | Treat all Material text as data. | A file can contain instructions that attack the Tutor. |

## 3. Architecture

The system has five parts.

1. **Desktop app.** The Tauri app shell with a webview. It runs on the computer of the Learner.
2. **API (in-process).** The routes inside the app. They check the optional login and write jobs.
3. **Database and storage.** Local SQLite for own data. Supabase is optional, for login, Premade Roadmaps, and sharing.
4. **Worker (in-process).** A job queue inside the app. It runs the pipeline.
5. **Model provider.** A pluggable OpenAI-compatible endpoint: hosted (OpenRouter, OpenAI) or local (Ollama, LM Studio, vLLM). Configured by base URL, API key, and model names.

```
Desktop app (webview)  ->  in-process API  ->  local SQLite
                                                  ^
                                                  |
                        in-process worker  <--  jobs  -->  Model provider (pluggable)
                                                  |
                                       optional Supabase (auth, premade, share)
```

The app and the worker share one TypeScript package named `engine`. The package has the pruning code and the data schemas. The AI layer is a separate package named `ai` with an OpenAI-compatible client.

## 4. Technology

| Area | Choice | Note |
|---|---|---|
| Desktop framework | Tauri (thin Rust shell) | Small bundle. Fast startup. Rust only for window, dialogs, and key storage. |
| Web framework | Next.js (static export), TypeScript, Tailwind CSS | Reused in the Tauri webview. |
| Graph view | React Flow | Handles drag, add, and delete of Nodes. |
| Math display | KaTeX | Shows formulas. |
| Language support | A translation file for Bangla and English | One file for each language. |
| Local database | SQLite (via Tauri) | Stores courses, materials, roadmap, lessons, progress. |
| Optional cloud | Supabase (auth, premade, share) | Used only when the Learner signs in. |
| Search | HNSW vector index plus SQLite FTS and trigram search | See Section 7. |
| Login | Supabase Auth (optional) | Email and password. Only for premade and sharing. |
| File storage | Local file system (Tauri) | Private folder of the app. |
| Job queue | In-process table | No extra service. |
| AI provider | OpenAI-compatible client | Covers hosted APIs and local endpoints. |
| Validation | Zod schemas | Each model output must pass a schema. |

## 5. Data pipeline

Each step is a job. A job has a status: queued, running, done, or failed. A failed job can run again.

### 5.1 Step 1: Read the files

1. The API saves the file in storage and makes a Material record.
2. The worker makes a text for each page. The method depends on the page.
3. For a PDF with a text layer, the worker reads the text.
4. For a scan or a photo, the worker uses OCR or a vision model. The default OCR is `tesseract.js` (offline, no download). If the configured AI provider has vision capability, the worker can use it instead. The team compares the two in milestone M0. The method with fewer errors wins for that page type. The paper "Lost in OCR Translation?" found that OCR pipelines generalize better to unseen documents than a vision retriever. The paper did not test handwriting in the abstract. The team must test it.
5. The worker saves the text, the page number, the method, and a confidence value in `material_pages`.
6. The worker marks each page with low confidence.

OCR test (milestone M0): Compare two methods on 10 real pages. Include Bangla pages, handwriting, and math. The method with fewer errors wins for that page type. The paper "Lost in OCR Translation?" found that OCR pipelines generalize better to unseen documents than a vision retriever. The paper did not test handwriting in the abstract. The team must test it.

### 5.2 Step 2: Build the Topic list

1. The worker reads the syllabus pages.
2. A level-A model returns a list of Topics as JSON. Each Topic has a title, a parent, and an order.
3. The code checks the JSON with a Zod schema.
4. If the model returns bad JSON, the worker tries again up to 2 times.
5. If it still fails, the app offers to retry with a hosted model. The Learner must have an API key.
6. If there is no syllabus, the worker builds the list from the notes. The app shows a warning.

### 5.3 Step 3: Make Chunks

1. The worker splits the pages by section. It uses the Topic list and the headings.
2. If no headings are found, the worker splits into fixed-size chunks of 200 to 500 tokens.
3. Each Chunk has 200 to 500 tokens. The limits are proposals.
3. Each Chunk keeps its file, page range, section path, and Topic.
4. The worker removes exact copies with a content hash.
5. The worker removes near copies. A near copy has a cosine similarity above 0.95 with another Chunk in the same Course. The worker keeps one Chunk and lists the other pages as extra sources.
6. The worker makes an embedding for each Chunk.

The section path is the idea from the STAIR paper. The paper fine-tunes a retriever on a table of contents. The prototype does not do that. It uses the structure as search data.

### 5.4 Step 4: Link and weight

1. A level-A model links each past question to one Topic.
2. A level-A model marks the Topics that the suggestions name.
3. The code computes the weight of each Topic with this formula.

```
weight = 0.5 * past_question_share + 0.3 * suggested + 0.2 * in_syllabus
```

- `past_question_share` is the number of past questions for the Topic divided by the largest count for any Topic.
- `suggested` is 1 if a suggestion names the Topic. Otherwise it is 0.
- `in_syllabus` is 1 if the syllabus lists the Topic. Otherwise it is 0.
- The values 0.5, 0.3, and 0.2 are first values. The team must tune them.
- A Topic with an exclusion has weight 0.

### 5.5 Step 5: Find Prerequisites

1. The worker looks for the Topic in the shared concept table. If it has Prerequisite edges, the worker uses them.
2. If it has none, a level-A model proposes edges. Each edge has a confidence value.
3. A level-B model checks each edge with a confidence below 0.7.
4. The worker saves the edges and adds them to the shared table.
5. The worker finds cycles. It removes the edge with the lowest confidence in each cycle.

### 5.6 Step 6: Build the Roadmap

The `engine` package runs the pruning rules in Section 6. It saves a Roadmap version.

### 5.7 Step 7: Build Lessons (on demand)

1. The Learner opens a Node.
2. The API looks for a saved Lesson for the Node, the language, and the level.
3. If none exists, the API makes a job. The worker retrieves the Chunks of the Node and builds the Lesson.
4. The Lesson has Citations to Chunks. The code checks that each cited Chunk was in the retrieved set.
5. The worker saves the Lesson. All Learners of the same Course use the saved Lesson.

A Premade Roadmap uses a shared Lesson. It has no Material. The Lesson has the mark "General content".

### 5.8 Step 8: Build a Tutorial Video (on demand)

1. The Learner opens the video tab on a Node page.
2. The API looks for a saved Tutorial Video for the Node, the language, and the level.
3. If none exists, the API makes a job. The worker builds the video from the saved Lesson of the Node.
4. The worker splits the Lesson into Slides. Each Slide holds one key point, one formula, or one diagram. The Slide shows the key point. It does not show the full text.
5. The worker writes the Voice text. The Voice text explains each Slide. It does not read the Slide word for word.
6. The worker makes a Transcript from the Voice text. Each line has the text and the start time.
7. The worker renders the audio for the Voice track.
8. The worker renders the Slides as a video. The audio and the Slides are timed to the Transcript.
9. The worker saves the video in storage. It saves the Transcript and the slide list in the database.
10. The API returns the video, the Transcript, and the slide list. The Learner can play it at once.

The video is saved. The second open is fast. The same video serves all Learners of the same Node, language, and level.

The video uses the same Lesson text as the Lesson page. The Slides and the Voice must not contradict the Lesson.

The video must respect the "reduce motion" setting. The slide change time is longer when the setting is on.

The video supports the language of the Learner. A video in Bangla uses a Bangla voice and Bangla text.

The video shows captions for the voice. The captions come from the Transcript.

The Learner can tap a line in the Transcript to jump to that moment in the video.

The worker does not use voice or video models in the prototype. It uses a text-to-speech provider and a slide renderer. The team chooses the providers in milestone M0.

## 6. Roadmap rules

### 6.1 Inputs

| Name | Meaning |
|---|---|
| T | The set of Topics. |
| E | The set of Prerequisite edges. An edge (u, v) means u is a Prerequisite of v. |
| w(t) | The weight of Topic t. |
| X | The set of Topics that the Learner excluded. |
| K | The set of Topics that the Learner passed in a Diagnostic. They are Known. |
| d | The Bridge depth limit. The default is 2. |

### 6.2 Rules

1. **Core.** A Topic t is Core if w(t) is above 0 and t is not in X.
2. **Bridge.** Start at each Core Topic. Follow the edges backward. Stop at depth d. Stop at a Known Topic. Each Topic found is Bridge, unless it is Core or Known.
3. **Excluded Bridge.** A Topic in X can be Bridge. This happens when a Core Topic needs it.
4. **Skipped.** All other Topics are Skipped.
5. **Reason codes.** Each Node has one reason code.

| Code | Meaning |
|---|---|
| EXAM_TOPIC | The Topic is in the exam scope. |
| NEEDED_BY | A Core Topic needs the Topic. The Node lists the Core Topics. |
| EXCLUDED | The Learner marked the Topic "not coming". |
| LOW_WEIGHT | The weight is 0 and no Core Topic needs the Topic. |
| KNOWN | The Learner passed the Diagnostic. |

6. **Order.** Sort the Nodes in a topological order. For equal Nodes, put the higher weight first.

### 6.3 Pseudocode

```
function buildRoadmap(T, E, w, X, K, d):
  core = { t in T : w(t) > 0 and t not in X }
  bridge = empty set
  for each c in core:
    walk backward from c along E, with depth up to d:
      for each node p reached:
        if p in K: stop this path
        if p not in core: add p to bridge
  skipped = T - core - bridge - K
  order = topologicalSort(core + bridge, E, tiebreak = higher w first)
  return nodes with type, reason code, depth, order
```

### 6.4 Overrides

The Learner edits are saved as Overrides. An Override has an action: `mark_skip`, `restore`, `add_node`, `delete_node`, `add_edge`, or `delete_edge`.

1. The engine builds the base graph from the model output.
2. The engine applies the Overrides in order of time.
3. The engine runs the rules in Section 6.2.
4. A rebuild changes only the base graph. The Overrides stay.

A delete of a Node is allowed. Before it, the code checks if a Core or Bridge Node needs the Node. If so, the app shows a warning with the names of those Nodes.

### 6.5 Tests

The `engine` package must have unit tests for these cases.

- A Core Topic has a Prerequisite that is excluded. The Prerequisite becomes Bridge.
- A Bridge Topic is Known. Its Prerequisites are not added.
- A cycle in the edges is removed.
- A deletion that breaks a Prerequisite returns a warning.
- A rebuild keeps the Overrides.
- A Roadmap of 200 Nodes updates in less than 1 second.

## 7. Retrieval

1. **Filter.** Use only the Chunks of the Course of the Learner. Row-level security enforces this.
2. **Query rewrite.** If the question is short or vague, a level-A model rewrites it into a search query. It adds the Topic title when the question comes from a Node page.
3. **Search.** Run a vector search for 20 Chunks. Run a keyword search for 20 Chunks. Merge the lists with reciprocal rank fusion.
4. **Topic first.** If a Node is in context, rank the Chunks of that Node higher.
5. **Select.** Keep the best 5 to 8 Chunks. The limit is about 3,000 tokens. The values are proposals.
6. **Answer.** Send the Chunks and the question to the Tutor model.
7. **Check Citations.** The code rejects a Citation to a Chunk that was not sent.
8. **No evidence.** If the best score is below a limit, the Tutor says it has no source. The limit is set by tests.

Bangla search: The default Postgres full-text search handles Bangla poorly. Use trigram search with the `pg_trgm` extension. Test it in milestone M0.

## 8. Models

### 8.1 Two levels

| Level | Use | Rule |
|---|---|---|
| A (low cost) | Topic extraction, tagging, query rewrite, Lesson drafts, question making | Temperature 0 for extraction tasks. |
| B (higher quality) | Tutor answers, written answer scoring, check of weak Prerequisite edges | Used only when needed. |

The team chooses the models in milestone M0 from the Bangla test. The code must keep the model names in one configuration file. The code must not use the model names in other files.

### 8.2 Output rules

- Use the structured output feature of the provider.
- Check each output with a Zod schema.
- Try again up to 2 times when the check fails.
- Save the model name, the prompt version, and the token counts with each result.

### 8.3 Repeat results

A model API can give different text for the same input, also at temperature 0. The cause is the load on the server. The prototype cannot change this. Do these steps.

- Save each Roadmap, Lesson, and question set. Show the saved result.
- Test with schema checks and score limits. Do not test with exact text.
- If the team hosts its own model later, use batch-invariant kernels. The Thinking Machines post reports a speed cost of about 60 to 110 percent in its test.

### 8.4 Persona text

Do not use a persona sentence to improve accuracy. Research on factual questions found no gain. A persona can set tone. Test once in the Tutor: plain instruction against a persona.

## 9. Tutor

The Tutor is one agent. It has these tools.

| Tool | Action |
|---|---|
| `search_material` | Returns Chunks for a query in the Course. |
| `get_node` | Returns the Node, its status, and its Lesson summary. |
| `get_progress` | Returns the progress of the Learner in the Course. |

All tools are read-only. The Tutor must not change data.

Modes:
- **Answer.** The Tutor gives the answer and the Citations.
- **Guide me.** The Tutor asks guiding questions first.

## 10. Written answer scoring

1. The Learner sends a written answer.
2. A level-B model scores the answer on three parts: correctness, completeness, and structure. Each part has a score from 0 to 5 and a short note.
3. The prompt has a rubric with the model answer and the key points.
4. The app shows the three scores, the notes, and the model answer.

Do not use one total score from the model. Scores by part reduce judge bias.

## 11. Security and privacy

| ID | Requirement |
|---|---|
| SEC-1 | Turn on row-level security for all tables that hold user data. |
| SEC-2 | A Learner can read and write only their own rows. |
| SEC-3 | Store files in a private bucket. Use signed links that expire. |
| SEC-4 | Check the file type and size on upload. Do not run uploaded files. |
| SEC-5 | Treat Material text as data. The model prompt must say that text in the Material is not an instruction. |
| SEC-6 | Give the Tutor read-only tools. |
| SEC-7 | Limit the requests of each Learner. See Section 12. |
| SEC-8 | When a Learner deletes data, delete the rows, the files, and the vectors. |
| SEC-9 | A share link shows only the Roadmap structure. It never shows Material. |
| SEC-10 | Do not put API keys in the browser. Keep them on the server. |
| SEC-11 | Read the data terms of the model provider. Record the result before launch. |
| SEC-12 | Store video files in a private bucket. Use signed links that expire. |
| SEC-13 | A share link never shows a video or a Lesson. It shows only the Roadmap structure. |
| SEC-14 | Read the data terms of the text-to-speech provider. Record the result before launch. |

## 12. Cost control

| ID | Rule |
|---|---|
| COST-1 | Use level A for bulk work. Use level B only for Tutor answers, scoring, and weak edges. |
| COST-2 | Build a Lesson only when a Learner opens its Node. |
| COST-3 | Save and reuse all made content. |
| COST-4 | Share Prerequisite edges and Lessons between Learners when the Topic is the same. |
| COST-5 | Set daily limits. The first limits are 20 Tutor messages, 3 Material uploads, 30 Lesson builds, and 10 video builds for each Learner. They are proposals. |
| COST-6 | Record the tokens and the cost of each call in `usage_events`. |
| COST-7 | Do not use fine-tuning, voice, or video models in the prototype. |
| COST-8 | Check the free plan limits of Vercel and Supabase before launch. |
| COST-9 | Share Tutorial Videos between Learners when the Topic, language, and level are the same. |
| COST-10 | Build a video only when the Learner opens the video tab. Do not build it at the same time as the Lesson. |
| COST-11 | Record the cost of each video build in `usage_events`. |

## 13. Performance targets

| Item | Proposed target |
|---|---|
| Roadmap build for 100 pages | Less than 5 minutes |
| Lesson that is not saved | Less than 20 seconds |
| Saved Lesson | Less than 1 second |
| First word of a Tutor answer | Less than 5 seconds |
| Graph update after a toggle | Less than 1 second for 200 Nodes |
| First page load on 4G | Less than 4 seconds |
| Tutorial Video that is not saved | Less than 30 seconds |
| Saved Tutorial Video | Less than 2 seconds |
| First frame of a Tutorial Video on 4G | Less than 4 seconds |

## 14. Evaluation

### 14.1 Test sets

| ID | Set | Content |
|---|---|---|
| E1 | Course set | 2 real Courses of the builder, with syllabus, notes, and past questions. |
| E2 | Bangla set | 20 Bangla and English exam questions and 1 page of notes. |
| E3 | Scan set | 10 pages: print, handwriting, math, and Bangla. |
| E4 | Tutor set | 30 questions with known answers and known source pages. |
| E5 | Grading set | 30 written answers that a human scored. |
| E6 | Video set | 10 Nodes with known Lessons. The builder checks the Slides, the Voice text, and the Transcript. |
| E7 | Voice set | 20 sentences in Bangla and in English. A human rates the voice quality on a scale of 1 to 5. |

### 14.2 Measures

| Measure | Method |
|---|---|
| Topic extraction | Compare with a hand list. Compute precision and recall. |
| Prerequisite edges | A human checks 100 edges. Compute precision. |
| Pruning | Unit tests. All must pass. |
| Tutor groundedness | A judge model checks that the cited page supports each claim. A human checks 30 answers. |
| Scoring | Compare the model scores with the human scores. |
| Bangla quality | A human rates 20 answers on a scale of 1 to 5. |
| Video slide quality | A human checks 10 videos in E6. Each Slide must show one key point, formula, or diagram. |
| Voice and transcript sync | The transcript time codes must match the audio. A human checks 10 videos. |
| Slide and voice agreement | The Voice text must explain the Slide. It must not read the Slide word for word. A human checks 10 videos. |
| Voice quality | A human rates 20 sentences in E7 on a scale of 1 to 5. |

The judge model must not be the model that made the content. A human set must back each judge test.

## 15. Operations

- Log each job: type, time, status, error, and token counts.
- Show the jobs and the cost in a simple admin page for the builder.
- Keep a daily backup of the database. Use the Supabase tools.
- Use two environments: development and production.

## 16. Decision log

| ID | Decision | Reason |
|---|---|---|
| DEC-1 | Use pgvector. Do not add a separate vector database. | Each search covers one Course. The data is small. Filters and deletes stay simple. |
| DEC-2 | Do not use a multi-agent framework. | The tasks are fixed pipelines. A framework adds cost and debug work. |
| DEC-3 | Consider LangGraph later for the Roadmap build only. | That job is long and may need resume after a failure. |
| DEC-4 | Use React Flow for the graph. | It fits Next.js. It has the needed editing functions. |
| DEC-5 | Keep Overrides separate from the base graph. | A rebuild must not delete user edits. |
| DEC-6 | Do not fine-tune. | Retrieval is enough. Fine-tuning can add wrong answers. |
| DEC-7 | Use a section path for Chunks. | The Roadmap is a table of contents. Section search gives better context. |
| DEC-8 | Build the video from the saved Lesson. Do not call the model again for the same Node. | The Lesson is already saved. A second model call adds cost and can give different text. |
| DEC-9 | Use a third-party text-to-speech provider for the voice. Do not build a voice model. | A third-party provider is fast. It supports Bangla. It keeps the prototype cost low. |
| DEC-10 | Use a slide renderer to make the video. Do not use a video model. | A slide renderer is cheap. The slides are simple text, formulas, and diagrams. |
| DEC-11 | Save the Transcript with time codes. The Transcript is the source of truth for the video. | The Transcript links the voice, the slides, and the captions. |

## 17. Technical risks

| ID | Risk | Plan |
|---|---|---|
| TR-1 | Free plan limits stop the app. | Check limits. Plan a small paid plan. |
| TR-2 | Jobs take longer than the host allows. | Run the worker as a separate process. |
| TR-3 | Prerequisite extraction is poor. | Use shared edges, a level-B check, and Learner edits. |
| TR-4 | Bangla OCR is poor. | Test in M0. Show low-confidence pages. Let the Learner paste text. |
| TR-5 | The model API changes or fails. | Keep model names in one file. Add retries. |
| TR-6 | The text-to-speech provider does not support Bangla well. | Test voices in milestone M0. Choose a voice from the test. Let the Learner change the voice in Settings. |
| TR-7 | The video build takes too long or fails. | Build the video on demand. Save it. Show a clear error if it fails. Let the Learner fall back to the Lesson text. |
| TR-8 | The slides and the voice contradict each other. | Build both from the saved Lesson. Check that the Transcript matches the Voice text. |
