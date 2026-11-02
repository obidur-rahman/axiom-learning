# Axiom Learning: App Flow

| Item | Value |
|---|---|
| Document ID | AXL-FLOW-001 |
| Version | 1.0 |
| Date | 2026-10-25 |
| Owner | Obidur Rahman, NorthAxis |
| Status | Draft for the prototype |
| Related documents | AXL-PRD-001, AXL-DESIGN-001, AXL-VIDEO-001 |

Writing rules: This document follows the ASD-STE100 rules as closely as possible. Terms are in the PRD, Section 14.

---

## 1. Purpose

This document shows how a Learner moves through the app. It lists the screens, the steps, and the states.

## 2. Screen list

| ID | Screen | Purpose |
|---|---|---|
| SC-01 | Welcome | Explain the app. Give the buttons Sign up and Log in. |
| SC-02 | Sign up and log in | Make an account or log in. |
| SC-03 | Home | Show the Courses and the Premade Roadmaps. |
| SC-04 | New Course | Collect the title, level, language, and exam date. |
| SC-05 | Upload Material | Add files and text. Set the kind of each Material. |
| SC-06 | Processing | Show the status of each Material. |
| SC-07 | Topic list | Show the Topics. Let the Learner edit them. |
| SC-08 | Exam scope | Let the Learner mark Topics "not coming". |
| SC-09 | Roadmap (graph) | Show the Roadmap as a graph. |
| SC-10 | Roadmap (list) | Show the Roadmap as an ordered list. |
| SC-11 | Node page | Show the Lesson, the check questions, and the actions. |
| SC-11b | Tutorial Video | Show the video player, the Transcript, and the slide list. |
| SC-12 | Diagnostic | Show 3 questions for a Bridge Node. |
| SC-13 | Practice | Show multiple-choice and written practice. |
| SC-14 | Tutor | Show the chat. |
| SC-15 | Progress | Show the percent done, the exam countdown, and the daily plan. |
| SC-16 | Share | Make, copy, and cancel a share link. |
| SC-17 | Shared Roadmap | Show a shared Roadmap to a person with the link. |
| SC-18 | Settings | Language, account, and data deletion. |
| SC-19 | AI provider | Base URL, API key, model, capabilities, auto-detect. |

## 3. Navigation map

```
Welcome -> Sign up / Log in -> Home
Home -> New Course -> Upload Material -> Processing -> Topic list -> Exam scope -> Roadmap
Home -> Premade Roadmap -> Roadmap
Roadmap (graph or list) -> Node page -> Diagnostic or Practice
Node page -> Tutorial Video
Course menu: Roadmap | Tutor | Practice | Progress | Share
Any screen -> Settings
Shared link -> Shared Roadmap -> Log in -> Copy to my account -> Roadmap
```

## 4. Flows

### F1: Sign up and log in

1. The Learner opens the app. The Welcome screen shows.
2. The Learner selects Sign up.
3. The Learner enters an email and a password.
4. The app makes the account and shows Home.
5. The Learner can select the language on Welcome or in Settings.

Error states:
- The email is already in use. The app shows a message and a link to Log in.
- The password is too short. The app shows the rule.

### F2: Make a Course and upload Material

1. The Learner selects New Course on Home.
2. The Learner enters a title, selects a level, selects a language, and optionally enters an exam date.
3. The Learner selects Next. The Upload Material screen shows.
4. The Learner adds files, takes photos, or pastes text.
5. The Learner sets the kind for each Material.
6. The Learner selects Build my Roadmap.
7. The Processing screen shows.

Error states:
- A file is too large. The app shows the limit and does not upload the file.
- The file type is not allowed. The app shows the allowed types.
- The Course limit is reached. The app shows the limit.

### F3: Processing

1. The screen shows each Material with a status: queued, reading, ready, or failed.
2. The app updates the status without a page reload.
3. When all Material is ready, the app moves to the Topic list.
4. If a Material fails, the app shows a message and the buttons Try again and Remove.
5. If pages have low confidence, the app shows a notice with the page numbers.

The Learner can leave the screen. The jobs continue. The Home screen shows the Course status.

### F4: Check the Topics

1. The Topic list shows the Topics as a tree.
2. The Learner can rename, merge, add, or delete a Topic.
3. If there is no syllabus, a warning shows: "The Topics come from your notes. Check them."
4. The Learner selects Next.

### F5: Set the exam scope

1. The Exam scope screen lists each Topic with a checkbox "Not coming in the exam".
2. The app shows the weight of each Topic as a small bar.
3. The Learner can type a scope note, for example "Chapter 5 is not in the exam".
4. The app shows the proposed changes. The Learner accepts or rejects each change.
5. The Learner selects Build Roadmap.

### F6: View the Roadmap

1. The graph view shows the Nodes and the edges.
2. The node type shows by shape, label, and color. See the design brief.
3. The Learner can switch to the list view.
4. A Bridge Node or a Skipped Node shows its reason. The reason shows when the Learner selects the Node.
5. The top bar shows the percent done and the days to the exam.

Empty state: If the Roadmap has no Core Nodes, the app shows "No exam Topics found. Check your exam scope." The app shows a button to go back.

### F7: Study a Node

1. The Learner selects a Node. The Node page opens.
2. If a Lesson exists, it shows at once.
3. If it does not exist, the app shows a loading state and builds the Lesson.
4. The Lesson shows text, formulas, and Citations.
5. The Lesson ends with 3 check questions.
6. The Learner selects Mark as done. The status changes to done.
7. The app shows the next Node.

Available actions on the Node page: Ask the Tutor, Practice, Report this Lesson, Not coming (mark skip), Delete Node.

Error states:
- The Lesson build fails. The app shows a message and a Try again button.
- The daily Lesson limit is reached. The app shows the time when the limit resets.

### F8: Diagnostic for a Bridge Node

1. A Bridge Node shows the button "I already know this".
2. The Learner selects it. The Diagnostic screen shows 3 questions.
3. The Learner answers all 3 questions.
4. If all 3 answers are correct, the Node status becomes Known. The Roadmap updates.
5. If not, the app shows the Lesson and the missed questions.

### F9: Edit the graph

1. The Learner selects a Node in the graph.
2. The Learner selects Not coming. The Node becomes Skipped, unless another Node needs it. If another Node needs it, the Node stays Bridge and the app shows the reason.
3. The Learner selects Restore to undo.
4. The Learner selects Add Node. The app asks for a title and a parent. The Node shows in the graph.
5. The Learner selects Delete Node. If other Nodes need it, the app shows a warning with their names. The Learner confirms or cancels.
6. The graph updates in less than 1 second.

Not in the prototype: draw an edge, attach a page to a Node, and AI suggestions.

### F10: Tutor

1. The Learner opens the Tutor from the Course menu or from a Node page.
2. The Learner types a question.
3. The Tutor streams the answer.
4. A cited answer shows the file name and the page number. A tap on the Citation opens the page text.
5. If the Material has no evidence, the Tutor says so. It then offers a general answer marked "Not from your material".
6. The Learner can switch the mode to "Guide me".

Error states:
- The daily limit is reached. The app shows the reset time.
- The model fails. The app shows a message and a Try again button.

### F11: Practice

Multiple choice:
1. The Learner selects Practice on a Node page.
2. The app shows a question with options.
3. The Learner selects an option.
4. The app shows if the answer is correct, and an explanation.

Written answer:
1. The app shows a question. The Learner types an answer.
2. The Learner selects Check my answer.
3. The app shows three scores (correctness, completeness, structure), notes, and the model answer.

### F12: Premade Roadmap

1. The Learner selects a Premade Roadmap on Home.
2. The app copies the Roadmap into the account of the Learner.
3. The Roadmap shows. Lessons show the mark "General content".
4. The Learner can add Material later to make a personal Roadmap.

### F13: Progress and daily plan

1. The Progress screen shows the percent done, the number of Nodes by status, and the days to the exam.
2. The Learner enters the minutes for each day.
3. The app lists the next Nodes that fit the time.

### F14: Share and copy

Owner:
1. The Learner selects Share.
2. The app makes a link.
3. The Learner copies the link.
4. The Learner can cancel the link.

Person with the link:
1. The person opens the link. The Shared Roadmap screen shows the Nodes and the weights. It shows no Material.
2. The person selects Copy to my account.
3. If the person is not logged in, the app shows the login screen first.
4. The app makes a new Course with the Roadmap.

Error state: A cancelled link shows "This link is not active".

### F15: Settings

1. The Learner can change the language.
2. The Learner can change the voice for the Tutorial Videos.
3. The Learner can turn on or off the "reduce motion" setting.
4. The Learner can delete a Course.
5. The Learner can delete the account. The app asks the Learner to confirm. The app then deletes all data.

### F16: Watch a Tutorial Video

1. The Learner opens the Node page.
2. The Learner selects the video tab. The tab shows "Watch the video".
3. If a saved video exists, the app shows the video player at once.
4. If no video exists, the app shows a build button. The Learner selects Build the video.
5. The app shows the building state. It shows the slides that are ready.
6. The app shows the video player when the build is done.
7. The Learner can play, pause, rewind, and fast-forward.

The video player shows:
- The video. The video shows the slides and the voice.
- The captions. The captions come from the Transcript.
- The Transcript. The Transcript shows the spoken words with time codes.
- The slide list. The slide list shows the title of each slide.

The Learner can tap a line in the Transcript to jump to that moment in the video.

The Learner can tap a slide in the slide list to jump to that slide in the video.

Error states:
- The video build fails. The app shows a message and a Try again button. The Learner can fall back to the Lesson text.
- The daily video limit is reached. The app shows the time when the limit resets.

### F17: Change the video settings

1. The Learner opens Settings.
2. The Learner changes the voice.
3. The Learner turns on or off the "reduce motion" setting.
4. The change applies to the next video build. A saved video does not change.

## 5. Global states

| State | Behavior |
|---|---|
| Loading | Show a skeleton or a progress text. Do not show a blank screen. |
| Empty | Show one sentence and one button. |
| Error | Show what happened and one action. |
| Offline | Show "No network". Keep saved pages readable if possible. |
| Limit reached | Show the limit and the reset time. |
| Building video | Show a progress text. Show the slides that are ready. |

## 6. Language rules for screens

- Use short words and short sentences.
- Show the same term for the same thing on all screens.
- Provide each text in Bangla and in English.
- Do not show model error text to the Learner.
