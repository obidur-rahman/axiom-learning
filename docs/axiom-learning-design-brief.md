# Axiom Learning: Design Brief

| Item | Value |
|---|---|
| Document ID | AXL-DESIGN-001 |
| Version | 1.0 |
| Date | 2026-10-25 |
| Owner | Obidur Rahman, NorthAxis |
| Status | Draft for the prototype |
| Related documents | AXL-PRD-001, AXL-FLOW-001, AXL-VIDEO-001 |

Writing rules: This document follows the ASD-STE100 rules as closely as possible. Terms are in the PRD, Section 14.

---

## 1. Purpose

This document states the design goals and rules for the Axiom Learning interface. A designer or a builder can use it to make the screens.

## 2. Users and use

- The main user is a university student who studies before an exam. The student is often under time pressure.
- Many users have a phone as the only computer. The network can be slow.
- Many users read Bangla and English in the same session.
- The user needs to know what to study next. The user does not need to see all the data.

## 3. Design goals

| ID | Goal |
|---|---|
| DG-1 | Show the next action on each screen. |
| DG-2 | Make the Roadmap easy to read at a glance. |
| DG-3 | Make the reason for each Node clear. |
| DG-4 | Make the app work well on a small phone. |
| DG-5 | Keep the app fast on a slow network. |
| DG-6 | Show Bangla and English text with equal quality. |

## 4. Design principles

1. **One main action.** Each screen has one main button.
2. **Show the reason.** A Bridge Node or a Skipped Node always shows why.
3. **Calm and clear.** Use few colors. Use space. Do not fill the screen.
4. **Do not use color alone.** Each state has a color, a shape, and a label.
5. **Show trust.** Each Tutor answer and each Lesson shows its sources.
6. **Short text.** Use short sentences. Avoid long paragraphs.

## 5. Visual direction

- Theme: A light theme and a dark theme. The dark theme is the first option for the builder. Use one set of design tokens for both.
- Open question: Should the app use the visual style of the current Axiom product? The owner must decide. If yes, reuse its colors and fonts.
- Style: Clean and modern. Use thin borders and small shadows. Use rounded corners of 8 to 12 pixels.
- Motion: Use short transitions of 150 to 250 milliseconds. Do not use motion that is not needed. Respect the setting "reduce motion".

### Color tokens (first proposal)

| Token | Use |
|---|---|
| `bg` | Page background |
| `surface` | Cards and panels |
| `text` | Main text |
| `text-muted` | Second text |
| `accent` | Main action |
| `core` | Core Node |
| `bridge` | Bridge Node |
| `skipped` | Skipped Node |
| `known` | Known Node |
| `warning` | Warnings |
| `danger` | Delete actions |

The designer sets the values. Each text and background pair must meet the WCAG 2.2 AA contrast ratio. The ratio is 4.5 to 1 for normal text.

## 6. Typography

- Bangla font: Use a font with full Bangla support, for example Noto Sans Bengali or Hind Siliguri.
- Latin font: Use one sans-serif font. Pair it with the Bangla font so the sizes match.
- Body size: At least 16 pixels. Line height 1.5 for Latin and 1.6 for Bangla.
- Math: Use KaTeX. Formulas must scale with the text.
- Load only the font weights that the app uses. This keeps the page small.

## 7. Layout

- Design for a screen 360 pixels wide first. Then add the wide layouts.
- Use a bottom bar on the phone with these items: Roadmap, Tutor, Practice, Progress.
- Use a side bar on a wide screen with the same items.
- Use a 16 pixel gutter on the phone.
- Do not let the page scroll sideways.

## 8. Key components

### 8.1 Roadmap graph

- Use React Flow.
- The graph flows from top to bottom on the phone. It can flow from left to right on a wide screen.
- Show the node title on the Node. Show the type with a shape and a label.
- Show the done status with a check mark.

| Node type | Shape | Line | Label |
|---|---|---|---|
| Core | Solid fill | Solid | "Exam" |
| Bridge | Light fill | Dashed | "Needed" |
| Skipped | No fill | Dotted, muted text | "Skipped" |
| Known | Light fill with check | Solid | "Known" |

- A tap on a Node opens a small panel with the reason and the actions.
- Provide keyboard control: arrow keys move between Nodes, Enter opens a Node, and Delete asks to delete.
- Provide the list view as an equal option. It is the best view for a small phone.
- Show a mini map only on a wide screen.

### 8.2 Lesson page

- Show the title, the type of the Node, and the reading time.
- Show the text in short sections.
- Show Citations as small tags. A tap opens the source text.
- Show the check questions at the end.
- Show the buttons Ask the Tutor, Practice, and Mark as done.
- Show the mark "General content" on a Lesson that has no Material.

### 8.3 Tutor chat

- Show the question and the answer as messages.
- Show Citations under each answer.
- Show the mark "Not from your material" on a general answer. Use a different background.
- Show the mode switch: Answer and Guide me.
- Show a stop button while the Tutor writes.

### 8.4 Practice

- Show one question on each screen.
- For multiple choice, show a large tap area for each option.
- For a written answer, show a text box and a counter of words.
- Show the three scores as three small bars with a short note each.

### 8.5 Tutorial Video player

- Show the video at the top. The video plays the slides with the voice track.
- Show captions under the video. The captions come from the Transcript.
- Show the Transcript below the captions. Each line has a time code. The current line is highlighted as the voice speaks.
- Show a slide list next to or below the Transcript. Each list item shows the slide title.
- Show controls: play, pause, rewind, fast-forward, speed, mute.
- A tap on a Transcript line jumps to that moment in the video.
- A tap on a slide in the slide list jumps to that slide in the video.
- Respect the "reduce motion" setting. Slide changes are slower when the setting is on.
- Show the mark "General content" on a video that has no Material.

### 8.6 Upload and processing

- Show a drop area on a wide screen. Show buttons Take photo and Choose file on a phone.
- Show the status of each file as a label and an icon.
- Show the pages with low confidence as a link to a list.

### 8.7 Exam scope

- Show each Topic with a checkbox and a weight bar.
- Group the Topics by chapter. Let the Learner collapse a group.
- Show the proposed changes from a scope note as a list. Each item has Accept and Reject.

## 9. Content and tone

- Use simple words. Use short sentences.
- Speak to the Learner directly.
- Be clear about limits. Say "I could not find this in your material."
- Do not use praise that is not needed.
- Use the same name for the same thing. For example, always use "Roadmap" and never use two names.
- Write each text in Bangla and in English. Do not use machine text without a check by a Bangla reader.

## 10. States

Design each of these states for every main screen.

- Loading
- Empty
- Error
- Limit reached
- Offline
- Success

## 11. Accessibility

- Meet WCAG 2.2 level AA.
- Do not use color alone to show a state.
- Make each action reachable with the keyboard.
- Give each icon a text label.
- Set tap areas to at least 44 by 44 pixels.
- Support the browser text size setting.
- Respect the setting "reduce motion".

## 12. Performance

- Keep the first page small.
- Load the graph code only on the Roadmap screen.
- Use compressed images. Use lazy loading.
- Show saved pages again without a new request when possible.
- Test on a slow 4G setting.

## 13. Deliverables

| ID | Deliverable |
|---|---|
| DD-1 | Design tokens (colors, type, spacing) in one file |
| DD-2 | Screens SC-01 to SC-18 for the phone and the desktop |
| DD-3 | The Node component in all four types and all states |
| DD-4 | The states in Section 10 for each main screen |
| DD-5 | The Bangla and English text for all screens |
| DD-6 | A check of contrast and keyboard use |

## 14. Open questions

| ID | Question |
|---|---|
| DQ-1 | Does the app use the visual style of the current Axiom product? |
| DQ-2 | What is the product logo and name style? |
| DQ-3 | Which Bangla font gives the best result for math and mixed text? Test two fonts. |
