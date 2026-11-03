# Axiom Learning: Product Requirements Document (PRD)

| Item | Value |
|---|---|
| Document ID | AXL-PRD-001 |
| Version | 1.0 |
| Date | 2026-10-25 |
| Owner | Obidur Rahman, NorthAxis |
| Status | Draft for the prototype |
| Related documents | AXL-TRD-001, AXL-FLOW-001, AXL-DESIGN-001, AXL-SCHEMA-001, AXL-PLAN-001, AXL-VIDEO-001 |

Writing rules: This document follows the ASD-STE100 rules as closely as possible. Sentences are short. Each term has one meaning. See Section 14 for the terms.

---

## 1. Purpose

This document states what the Axiom Learning prototype must do. It names the users, the problems, and the requirements. The TRD states how to build it.

## 2. Product summary

Axiom Learning is a desktop app. It helps a Learner study only what the Learner needs.

The Learner gives the app the Material for a Course. The app builds a Roadmap. The Roadmap is a tree of Nodes in a good study order. A Tutor answers questions about the Material. A Learner with no Material can start a Premade Roadmap.

The app runs on the computer of the Learner. It needs no account to use own Material. An account is optional. It is needed to fetch Premade Roadmaps and shared Roadmaps.

AI runs through one pluggable provider. The Learner can use a hosted API key (OpenRouter or OpenAI) or a local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM). The app auto-detects a local endpoint on startup. Features expand or shrink based on model capabilities.

For each Node the app can also build a Tutorial Video. The video has three parts that play together: a slide deck, a voice track, and a transcript. The slides show the key points, formulas, and diagrams. The voice explains them. The transcript shows the spoken words so the Learner can read along, pause, and take notes.

## 3. Users

| ID | User | Description |
|---|---|---|
| U1 | University student | Has an exam soon. Has a syllabus, class notes, suggestions, and past questions. This is the main user. |
| U2 | School student | Has a textbook and class notes. Needs clear lessons and practice. |
| U3 | General learner | Has no exam. Wants to learn a subject. Uses Premade Roadmaps. |

The first market is Bangladesh. Many Learners use Bangla and English together.

## 4. Problems

| ID | Problem |
|---|---|
| P1 | The Learner has too much Material and too little time. |
| P2 | The Learner does not know which Topics the exam covers. A teacher can remove Topics from the exam. |
| P3 | If the Learner skips a Prerequisite, the Learner cannot understand a later Topic. |
| P4 | A general AI chat does not use the class Material. Its answers can be wrong. |
| P5 | Most study apps make flashcards and short quizzes. Many university exams need long written answers. |
| P6 | The Bangla quality of AI models is not known. The team must test it. |

## 5. Market review

The team reviewed public descriptions of these tools: StudyAI, StudyPal, StudyFetch, Knowunity, Vaia, NotebookLM, and Khanmigo.

- These tools make study sets, plans, and a Tutor from uploaded Material.
- NotebookLM and Khanmigo ask guiding questions instead of giving only answers.
- None of the public descriptions says that the tool removes Topics at the Prerequisite level.

The review used store pages and articles. It did not use the tools themselves. The team must test the tools before launch.

## 6. Goals and non-goals

### Goals for the prototype

| ID | Goal |
|---|---|
| G1 | Build a working prototype that has every planned feature. Each feature can be shallow. |
| G2 | Let a tester try every feature without help. |
| G3 | Keep the running cost as low as possible. |
| G4 | Show that a pruned Roadmap helps a Learner study less and still cover the exam. |

### Non-goals for the prototype

- Native phone apps. The prototype is a desktop app.
- Payments.
- Points, streaks, and other game features.
- Voice and video.
- Community features, except the clone link.
- Teacher tools.
- Model fine-tuning.
- Multi-agent systems.

## 7. Differences from other tools

| ID | Difference | Meaning |
|---|---|---|
| D1 | Minimal Roadmap | The Roadmap has the exam Topics and only the Prerequisites that the exam Topics need. |
| D2 | Written exam practice | The app scores a written answer on three parts and shows a model answer. |
| D3 | Local context | The app supports Bangla and English, scanned notes, and shared Roadmaps for one course. |
| D4 | Trust | Each Tutor answer shows the page of the source. The Tutor says when it has no source. |

## 8. Functional requirements

Priority: P0 means the prototype must have it. P1 means the prototype must have it if time allows. P2 means a later release.

### 8.1 Accounts

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-001 | The app must let a Learner sign up and log in with email and password. | P0 | A new user makes an account and logs in. |
| FR-002 | The app must let a Learner choose Bangla or English for the screens and for made content. | P0 | The Learner changes the language. All screens change. |
| FR-003 | The app must let a Learner delete the account and all stored data. | P1 | After deletion, no data of the Learner remains. |
| FR-004 | The app must let a Learner switch between a light theme and a dark theme. The dark theme is the first option. | P0 | The theme changes on all screens. |

### 8.2 Courses and Material

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-010 | The app must let a Learner make a Course with a title, a level, a language, and an optional exam date. | P0 | The Course shows in the Course list. |
| FR-011 | The app must let a Learner open, rename, and delete a Course. | P0 | Each action works. |
| FR-020 | The app must accept PDF, JPG, and PNG files and pasted text. | P0 | Each type uploads and reaches the status Ready. |
| FR-021 | The Learner must set the kind of each Material: syllabus, notes, past questions, suggestions, textbook, or other. | P0 | The kind shows on each Material. |
| FR-022 | The app must enforce these proposed limits: 20 MB for each file, 10 files for each Course, 200 pages for each Course. | P0 | A file over the limit gets a clear message. |
| FR-023 | The app must show the status of each Material: queued, reading, ready, or failed. | P0 | The status changes while the job runs. |
| FR-024 | The app must delete a Material and all data made from it. | P0 | No Chunk of the Material remains. |
| FR-025 | The app must keep page numbers. It must mark pages that it could not read well. | P1 | The Learner can see the marked pages. |

### 8.3 Topics and exam scope

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-030 | The app must build a Topic list from the syllabus. If there is no syllabus, it must use the notes and show a warning. | P0 | A Topic list shows after the Material is ready. |
| FR-031 | The Learner must be able to rename, merge, add, and delete Topics before the Roadmap is built. | P0 | Each edit saves. |
| FR-032 | The exam scope screen must show a checkbox "Not coming in the exam" for each Topic. | P0 | A checked Topic becomes excluded. |
| FR-033 | The Learner can type a scope note in free text. The app proposes changes to the checkboxes. The Learner confirms each change. | P1 | The note "Chapter 5 is not in the exam" proposes the Topics of Chapter 5. |
| FR-034 | The app must compute a weight for each Topic from past questions, suggestions, and the syllabus. | P0 | Each Topic has a weight. |
| FR-035 | The app must extract each past question and link it to a Topic. | P0 | Each past question shows its Topic. |

### 8.4 Roadmap

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-040 | The app must build a Roadmap with Core Nodes, Bridge Nodes, and Skipped Nodes. The TRD gives the rules. | P0 | Each Topic has one Node type. |
| FR-041 | Each Bridge Node and each Skipped Node must show a reason in plain words. | P0 | The reason shows on the Node. |
| FR-042 | A Node must come after its Prerequisites in the study order. | P0 | No Node comes before a Prerequisite. |
| FR-043 | The app must show the Roadmap as a graph and as a list. | P0 | Both views show the same Nodes. |
| FR-044 | The Learner can set the Bridge depth from 0 to 4. The default is 2. | P1 | A change updates the Roadmap. |
| FR-045 | The Learner can rebuild the Roadmap. The edits of the Learner must stay. | P0 | After a rebuild, the Overrides still apply. |

### 8.5 Graph editing

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-050 | A click on a Node must open its Lesson. | P0 | The Lesson opens. |
| FR-051 | The Learner must be able to mark a Node "not coming" and to restore it. The Roadmap must update in less than 1 second for 200 Nodes. | P0 | The update time is below 1 second. |
| FR-052 | The Learner must be able to add a Node with a title and a parent. | P0 | The new Node shows in the graph. |
| FR-053 | The Learner must be able to delete a Node. If another Node needs it, the app must show a warning first. | P0 | The warning names the Nodes that need it. |
| FR-054 | The Learner can draw an edge between two Nodes. | P2 | Later release. |
| FR-055 | The Learner can attach a page or a note to a Node. | P2 | Later release. |
| FR-056 | The app can suggest changes after an edit. | P2 | Later release. |

### 8.6 Tutorial Videos

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-150 | The app must build a Tutorial Video for each Node. | P0 | A video opens for the Node. |
| FR-151 | A Tutorial Video must have three parts that play together: a slide deck, a voice track, and a transcript. | P0 | All three parts play together. |
| FR-152 | The slide deck must show the key points, the formulas, and a simple diagram of the concept. | P0 | Each slide has text and a formula or a diagram. |
| FR-153 | The voice track must speak the text that explains the slides. The voice must not read every word on the slide. The slide shows the key points; the voice does the rest. | P0 | The voice explains the slide. The slide shows the key points. |
| FR-154 | The transcript must show the spoken words. The Learner can tap a word in the transcript to jump to that moment in the video. | P1 | A tap on a transcript line moves the video. |
| FR-155 | The Learner can pause, rewind, and fast-forward the video. | P0 | The controls work. |
| FR-156 | The video must save and play again without a new build. | P0 | The second play is fast. |
| FR-157 | The video must use the language of the Learner. | P0 | A video in Bangla plays in Bangla. |
| FR-158 | The video must show captions for the voice. | P0 | Captions show on the video. |
| FR-159 | The video must respect the "reduce motion" setting. | P1 | Slide changes are slower. |
| FR-160 | The video must be built from the same source as the Lesson. The slides and the voice must not contradict the Lesson text. | P0 | The video matches the Lesson. |

### 8.7 Lessons and Diagnostics

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-170 | The app must build a Lesson when the Learner opens a Node for the first time. It must save the Lesson and use it again. | P0 | The second open is fast and has the same text. |
| FR-171 | A Lesson must use the language of the Learner. If Material exists, the Lesson must show Citations to Material pages. | P0 | Each Lesson shows its sources. |
| FR-172 | A Lesson for a Bridge Node must be shorter than a Lesson for a Core Node. | P1 | Bridge Lessons are shorter. |
| FR-173 | The app must show math formulas correctly. | P0 | A test page with 10 formulas shows all of them. |
| FR-174 | The Learner can report a Lesson and can ask for a new version. | P1 | A report is saved. A new version replaces the old one. |
| FR-175 | Each Lesson must end with 3 check questions. | P1 | The questions show. |
| FR-176 | Each Bridge Node must have a Diagnostic of 3 questions. A Learner who answers all 3 correctly marks the Node as Known. | P0 | A pass sets the status to Known. |
| FR-177 | If a Node is Known, the app must not add its Prerequisites, unless another Node needs them. | P0 | The Roadmap shows fewer Nodes after a pass. |

### 8.8 Tutor

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-080 | The app must give each Course a chat with a Tutor. The Tutor must stream its answer. | P0 | Text appears while the Tutor writes. |
| FR-081 | An answer that uses Material must show a Citation with the file name and the page. | P0 | Each cited page contains the supporting text. |
| FR-082 | If the Material has no evidence, the Tutor must say so. It can then give a general answer. It must mark that answer "Not from your material". | P0 | A test question outside the Material gets the mark. |
| FR-083 | The Learner can ask a question from a Node page. The Tutor then uses the Node as context. | P1 | The answer is about the Node. |
| FR-084 | The Learner can choose the mode "Guide me". In this mode the Tutor asks guiding questions before it gives the answer. | P1 | The Tutor asks at least one question first. |
| FR-085 | The Tutor must treat Material text as data. It must not follow instructions that are inside the Material. | P0 | A test file with a hidden instruction does not change the Tutor. |

### 8.9 Practice

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-090 | The app must give multiple-choice practice for a Node. The questions come from past questions or from the Material. | P0 | Each question shows an explanation after the answer. |
| FR-091 | The app must give written practice. The Learner types an answer. The app scores it on correctness, completeness, and structure. The app then shows feedback and a model answer. | P0 | Three scores and feedback show. |
| FR-092 | The Learner can practice the past questions of a Topic. | P1 | The past questions show. |

### 8.9 Premade Roadmaps, progress, and sharing

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-100 | The app must have 3 to 5 Premade Roadmaps. The Learner starts one with one click. | P0 | The Roadmap opens without an upload. |
| FR-101 | Lessons in a Premade Roadmap must show the mark "General content". | P0 | The mark shows. |
| FR-110 | Each Node must have a status: not started, in progress, done, or known. | P0 | The status changes. |
| FR-111 | The app must show the percent of the Course that is done and the days to the exam. | P0 | Both values show. |
| FR-112 | The Learner enters the minutes for each day. The app lists the next Nodes that fit. | P1 | The list matches the time. |
| FR-120 | The Learner can make a share link. The link shows the Roadmap structure. It does not show the Material files. | P0 | A person with the link sees no Material. |
| FR-121 | A person with the link can copy the Roadmap into their own account. | P0 | The copy has the Nodes and weights. |
| FR-122 | The owner can cancel a share link. | P1 | A cancelled link shows an error. |

### 8.10 Limits and devices

| ID | Requirement | Priority | Check |
|---|---|---|---|
| FR-130 | The app must set a daily limit for each Learner on Tutor messages, uploads, and Lesson builds. | P0 | The limit stops further use. |
| FR-131 | The app must show a clear message when a limit is reached. | P0 | The message shows the time when the limit resets. |
| FR-140 | The app is a desktop app. It installs from the website. It runs on Windows, macOS, and Linux. | P1 | The app installs and runs. |

## 9. Non-functional requirements

The TRD gives the details. These are the main requirements.

| ID | Requirement | Proposed target |
|---|---|---|
| NFR-001 | Time to build the first Roadmap from 100 pages | Less than 5 minutes |
| NFR-002 | Time to show a Lesson that is not saved | Less than 20 seconds |
| NFR-003 | Time to the first word of a Tutor answer | Less than 5 seconds |
| NFR-004 | Data privacy | A Learner can read only the data of the Learner |
| NFR-005 | Mobile use | Works on a 4G network and on a screen 360 pixels wide |
| NFR-006 | Accessibility | Meets WCAG 2.2 level AA for contrast and keyboard use |
| NFR-007 | Running cost | Inside the free plans, except model use |
| NFR-008 | Time to build the first Tutorial Video that is not saved | Less than 30 seconds |
| NFR-009 | Time to the first frame of a saved Tutorial Video | Less than 2 seconds |
| NFR-010 | Video play on a slow network | Works on a 4G network. The video streams. |

The targets are proposals. The team must measure them in the prototype.

## 10. Success measures

| ID | Measure | Proposed target |
|---|---|---|
| S1 | Testers who finish the full flow | 10 testers |
| S2 | Testers who build a Roadmap without help | At least 80 percent |
| S3 | Tutor answers that cite a correct page, when the Material has the answer | At least 70 percent |
| S4 | Tester rating of Roadmap relevance | At least 4 out of 5 |
| S5 | Model cost for each active tester each week | The team sets the limit after the cost test |
| S6 | Tester rating of Tutorial Video quality | At least 4 out of 5 |
| S7 | Tutorial Videos that play without error | At least 95 percent |

## 11. Risks

| ID | Risk | Plan |
|---|---|---|
| R1 | The Roadmap graph has wrong Prerequisites. | Show the reason for each Node. Let the Learner edit. Check a sample of 100 edges by hand. |
| R2 | The Tutor gives a wrong answer. | Use retrieval. Require Citations. Make the Tutor say when it has no source. |
| R3 | The models read Bangla badly. | Run the Bangla test in milestone M0. Choose models from the result. |
| R4 | Scanned and handwritten pages are read badly. | Test 10 real pages. Mark pages with low confidence. |
| R5 | One bad saved Lesson reaches many Learners. | Add a report button. Let the app build a new version. |
| R6 | Model cost is too high. | Use two model levels. Save results. Build Lessons only when needed. Set daily limits. |
| R7 | Learners upload copyright Material. | Let each Learner use only their own Material. Share only the Roadmap structure. |
| R8 | A Tutorial Video costs too much to build. | Build the video only when the Learner opens the Node. Save it. Reuse it. Set a daily limit on video builds. |
| R9 | The voice does not speak Bangla well. | Test voices in milestone M0. Choose a voice from the test. Let the Learner change the voice in Settings. |
| R10 | The slides and the voice contradict each other. | Build both from the same Lesson text. Check that the transcript matches the voice. |

## 12. Assumptions

- The builder works alone.
- The prototype has about 20 testers.
- The Learner has the right to use the uploaded Material.

## 13. Open questions

| ID | Question |
|---|---|
| Q1 | Which model providers and credits does the team have? |
| Q2 | Which courses are the first Premade Roadmaps? |
| Q3 | What is the monthly model budget for the prototype? |
| Q4 | Does Axiom Learning use the visual style of the current Axiom product? |
| Q5 | What does the model provider do with the data that the app sends? The team must read the terms. |

## 14. Terms

| Term | Meaning |
|---|---|
| Learner | A person who uses the app. |
| Course | One subject that a Learner studies for one goal, for example one exam. |
| Material | A file or text that the Learner gives to a Course. |
| Topic | One unit of knowledge in a Course. |
| Prerequisite | A Topic that a Learner must know before another Topic. |
| Exam scope | The Topics that the exam covers. |
| Roadmap | An ordered tree of Nodes for one Course. |
| Node | One Topic in a Roadmap. It has a type. |
| Core Node | A Node for a Topic that the exam covers. |
| Bridge Node | A Node for a Topic that the exam does not cover, but a Core Node needs. |
| Skipped Node | A Node that the Learner does not need to study. |
| Known | A Node that the Learner passed in a Diagnostic. |
| Lesson | The text that teaches one Node. |
| Diagnostic | A check of 3 questions on a Bridge Node. |
| Tutor | The chat that answers questions about the Course. |
| Citation | A link from an answer to a page of the Material. |
| Override | An edit of the Learner that the app keeps when it rebuilds the Roadmap. |
| Premade Roadmap | A Roadmap that the team made. It needs no Material. |
| Tutorial Video | A video that teaches one Node. It has a slide deck, a voice track, and a transcript. |
| Slide | One screen in a Tutorial Video. It shows a key point, a formula, or a diagram. |
| Voice track | The speech that explains the slides in a Tutorial Video. |
| Transcript | The written words of the voice track. The Learner can tap a word to jump to that moment. |
