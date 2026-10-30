# Axiom Learning: Tutorial Video

| Item | Value |
|---|---|
| Document ID | AXL-VIDEO-001 |
| Version | 1.0 |
| Date | 2026-10-30 |
| Owner | Obidur Rahman, NorthAxis |
| Status | Draft for the prototype |
| Related documents | AXL-PRD-001, AXL-TRD-001, AXL-SCHEMA-001, AXL-PLAN-001 |

Writing rules: This document follows the ASD-STE100 rules as closely as possible. Terms are in the PRD, Section 14.

---


## 1. Purpose

This document defines the Tutorial Video feature. The app generates a complete tutorial video for each Node. The video combines three parts: a slide deck, a voice track, and a transcript. The slides show the key points, formulas, and diagrams. The voice explains them. The transcript shows the spoken words so the Learner can read along, pause, and take notes.

The goal is to give the Learner a full tutorial without reading a long page. The Learner sees the important ones. The rest is narrated to them.

## 2. Where it fits

On the Node page, the Learner finds a tab or button Watch the video. The tab opens the video player. A Premade Roadmap can have shared tutorial videos with the mark General content.

## 3. Parts of a tutorial video

### 3.1 Slides

- Each slide is one visual panel. A slide holds one key point, one formula, or one diagram.
- The slide shows the key point. It does not show the full text.
- The slides are interactive. The Learner can tap to go forward and back.
- The slide that matches the current voice is highlighted.

### 3.2 Voice track

- A text-to-speech voice reads the Voice text.
- The Voice text explains each slide. It does not read the slide word for word.
- The voice is in the language of the Learner. Bangla or English.
- The Learner can change the voice speed. The Learner can mute the voice and read only.

### 3.3 Transcript

- The transcript shows the spoken words of the voice track.
- Each line has the text and a time code.
- The current line is highlighted as the voice speaks.
- The Learner can tap a line in the transcript to jump to that moment in the video.
- The Learner can make notes next to each line of the transcript.

## 4. Generation pipeline

1. The Learner opens the video tab on a Node page.
2. The API looks for a saved Tutorial Video for the Node, language, and level.
3. If none exists, the API makes a job. The worker builds the video from the saved Lesson of the Node.
4. The worker splits the Lesson into Slides. Each Slide holds one key point, formula, or diagram.
5. The worker writes the Voice text. It explains each Slide. It does not read the Slide word for word.
6. The worker makes a Transcript from the Voice text. Each line has text and a start time.
7. The worker renders the audio for the Voice track.
8. The worker renders the Slides as a video. The audio and the Slides are timed to the Transcript.
9. The worker saves the video in storage. It saves the Transcript and the slide list in the database.
10. The API returns the video, the Transcript, and the slide list. The Learner can play it at once.

The video is saved. The second open is fast. The same video serves all Learners of the same Node, language, and level.

The video uses the same Lesson text as the Lesson page. The Slides and the Voice must not contradict the Lesson.

The video must respect the reduce motion setting. The slide change time is longer when the setting is on.

The video supports the language of the Learner. A video in Bangla uses a Bangla voice and Bangla text.

The video shows captions for the voice. The captions come from the Transcript.

The Learner can tap a line in the Transcript to jump to that moment in the video.

The worker uses a third-party text-to-speech provider and a slide renderer. The worker does not use voice models or video models in the prototype.

## 5. Rules

- One tutorial video per Node, language, level, and depth. Save it and reuse it.
- The transcript must match the voice. Check it with a schema.
- The slides must come from the Lesson text. Do not add facts that are not in the Material.
- Show the mark General content when there is no Material.
- The Learner can pause, rewind, and fast-forward.

## 6. Cost

- Text-to-speech costs tokens. Save the result and reuse it.
- Make a tutorial video only when the Learner opens the video tab.
- Set a daily limit on video builds. Share videos between Learners when the Topic, language, and level are the same.

## 7. Open questions

| ID | Question |
|---|---|
| VQ-1 | Which text-to-speech voice provider supports Bangla and English well? Test voices in milestone M0. |
| VQ-2 | Which slide-to-video renderer is fastest and cheapest? Test two renderers in milestone M0. |
| VQ-3 | Does the free plan allow the text-to-speech cost? Check before launch. |
| VQ-4 | What is the max length of a Tutorial Video? Keep it under 10 minutes. |
