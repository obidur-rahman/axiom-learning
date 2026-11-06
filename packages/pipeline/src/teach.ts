import { z } from 'zod';
import {
  getLessonDocument,
  saveActiveLesson,
  saveLessonDocument,
  type LessonAnimation,
  type LessonBeat,
  type LessonBeatKind,
  type LessonBlock,
  type LessonDocument,
} from '@axiom/data';
import { retrievePagesSmart } from './embeddings';
import { retrievePages } from './tutor';
import { ANIMATION_SCRIPT, LESSON_OBJECTIVE, LESSON_PLAN, TEACH_BEAT, TEACH_CRITIC } from './prompts';
import { boundedModelTask, type RunContext } from './steps';

/**
 * Teaching engine. The app chooses the beat skeleton; the model writes one
 * small beat at a time. Every beat is validated, optionally reviewed, and
 * saved as structured JSON. The old Markdown lesson stays as a fallback and
 * for export.
 */

const BlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }),
  z.object({ type: z.literal('steps'), items: z.array(z.string().min(1)).min(2).max(20) }),
  z.object({
    type: z.literal('compare'),
    columns: z.array(z.string().min(1)).min(2).max(6),
    rows: z.array(z.array(z.string())).min(1).max(20),
  }),
  z.object({ type: z.literal('equation'), latex: z.string().min(1), label: z.string().optional() }),
  z.object({
    type: z.literal('code'),
    language: z.string().min(1),
    code: z.string().min(1),
    trace: z.array(z.string()).max(12).optional(),
  }),
  z.object({
    type: z.literal('callout'),
    tone: z.enum(['trap', 'tip', 'note']),
    title: z.string().optional(),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal('flow'),
    nodes: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).min(2).max(12),
    edges: z
      .array(z.object({ from: z.string().min(1), to: z.string().min(1), label: z.string().optional() }))
      .max(20),
  }),
  z.object({ type: z.literal('recall'), prompt: z.string().min(1), answer: z.string().min(1) }),
]);

const BeatSchema = z.object({
  title: z.string().min(2),
  intro: z.string().min(1),
  blocks: z.array(BlockSchema).min(1).max(8),
  takeaway: z.string().nullable().optional(),
  check: z.object({ prompt: z.string().min(1), answer: z.string().min(1) }).nullable().optional(),
  /** Ask for a visual only when the beat genuinely needs one. */
  animation: z
    .object({ needed: z.boolean(), brief: z.string().max(400).default('') })
    .nullable()
    .optional(),
  citationPages: z.array(z.number().int().min(1)).max(20).default([]),
});

const ObjectiveSchema = z.object({
  objective: z.string().min(3),
  why: z.string().min(3),
});

const PlanSchema = z.object({
  beats: z
    .array(
      z.object({
        kind: z.enum([
          'hook',
          'intuition',
          'worked',
          'contrast',
          'note_anchor',
          'recall',
          'exam_shape',
        ]),
        focus: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(18),
});

type PlannedBeat = z.infer<typeof PlanSchema>['beats'][number];

const CriticSchema = z.object({
  pass: z.boolean(),
  problems: z.array(z.string()).max(8).default([]),
  repaired: BeatSchema.nullable().optional(),
});

type BeatDraft = z.infer<typeof BeatSchema>;

const SKELETON: LessonBeatKind[] = [
  'hook',
  'intuition',
  'worked',
  'contrast',
  'note_anchor',
  'recall',
  'exam_shape',
];

const BEAT_BRIEF: Record<LessonBeatKind, string> = {
  hook: 'Open with a concrete situation or question that makes the learner want the answer. Do not define yet.',
  intuition:
    'Explain the idea in plain language and say why it works. Use one analogy or one small example. This is the core explanation.',
  worked:
    'Work one exam-style example from start to finish. Use a steps block for the reasoning. Show the numbers or the exact substitution.',
  contrast:
    'Put the idea next to the thing students confuse it with. Use a compare block. State how to tell them apart.',
  note_anchor:
    'Connect the idea to the exact wording in the learner notes. Quote the key line and explain what each part means.',
  recall:
    'Active recall. Ask one short question that can be answered from the previous beats. Include a recall block with the answer.',
  exam_shape:
    'Show how an exam answer is shaped: what the marker looks for, the order of the answer, and one trap that loses marks.',
};

const MAX_PAGE_CHARS = 6_000;

export interface TeachOptions {
  depth?: 'core' | 'bridge';
  /** False turns off generated animations; the lesson itself is unchanged. */
  animate?: boolean;
  /** Reported per build stage so the UI can show real progress. */
  onProgress?: (percent: number, message: string) => void;
  /** Fires as each slide is saved, so the learner can start reading early. */
  onSlide?: (document: LessonDocument, lessonId: string) => void;
}

interface LessonInput {
  topicTitle: string;
  pages: { pageNumber: number; text: string; score: number }[];
  relatedQuestions: string[];
}

async function lessonInput(
  ctx: RunContext,
  topicId: string,
  depth: 'core' | 'bridge',
): Promise<LessonInput> {
  const topicRows = await ctx.db.driver.select<{ title: string }>(
    'SELECT title FROM topics WHERE id = $1',
    [topicId],
  );
  const topicTitle = topicRows[0]?.title ?? topicId;
  const config = await ctx.config();
  const pages =
    config !== null
      ? await retrievePagesSmart(ctx.db.driver, ctx.course.id, topicTitle, config)
      : await retrievePages(ctx.db.driver, ctx.course.id, topicTitle, 6);

  const questionRows = await ctx.db.driver.select<{ prompt: string }>(
    `SELECT e.prompt FROM exam_questions e
     JOIN exam_question_topics q ON q.question_id = e.id
     WHERE e.course_id = $1 AND q.topic_id = $2 AND e.status = 'confirmed'
     ORDER BY e.difficulty LIMIT $3`,
    [ctx.course.id, topicId, depth === 'bridge' ? 2 : 4],
  );

  return {
    topicTitle,
    pages: pages
      .filter((page) => page.text.trim() !== '')
      .slice(0, depth === 'bridge' ? 3 : 5),
    relatedQuestions: questionRows.map((row) => row.prompt.slice(0, 400)),
  };
}

function pagesText(input: LessonInput): string {
  return input.pages
    .map((page) => `PAGE ${page.pageNumber}\n${page.text.slice(0, 2_500)}`)
    .join('\n\n')
    .slice(0, MAX_PAGE_CHARS);
}

/** Deterministic skeleton, used only when the planner call fails. */
export function beatSkeleton(depth: 'core' | 'bridge'): LessonBeatKind[] {
  return depth === 'bridge'
    ? ['hook', 'intuition', 'worked', 'recall']
    : SKELETON;
}

/**
 * The model chooses the deck's length and shape from the topic's real scope:
 * one slide for a definition, a dozen for a derivation with several worked
 * problems. No fixed count, and no slides repeating the same idea.
 */
async function planBeats(
  ctx: RunContext,
  input: LessonInput,
  objective: string,
  depth: 'core' | 'bridge',
): Promise<PlannedBeat[]> {
  const fallback = (): PlannedBeat[] =>
    beatSkeleton(depth).map((kind) => ({ kind, focus: BEAT_BRIEF[kind] }));
  try {
    const plan = await boundedModelTask(
      ctx,
      LESSON_PLAN,
      [
        `<topic>${input.topicTitle}</topic>`,
        `<objective>${objective}</objective>`,
        `<depth>${
          depth === 'bridge'
            ? 'quick recap, at most 4 slides, only what is needed to remember the idea'
            : 'full lesson'
        }</depth>`,
        input.relatedQuestions.length === 0
          ? ''
          : `<exam_questions>\n${input.relatedQuestions.join('\n---\n')}\n</exam_questions>`,
        `<material>\n${pagesText(input)}\n</material>`,
      ]
        .filter((part) => part !== '')
        .join('\n'),
      PlanSchema,
      // Up to 18 planned slides with a sentence each must not truncate.
      { temperature: 0.2, maxTokens: 2_000 },
    );
    const beats = depth === 'bridge' ? plan.beats.slice(0, 4) : plan.beats;
    return beats.length === 0 ? fallback() : beats;
  } catch {
    return fallback();
  }
}

async function writeBeat(
  ctx: RunContext,
  input: LessonInput,
  objective: string,
  kind: LessonBeatKind,
  extra: string,
  focus = '',
): Promise<{ beat: LessonBeat; animationBrief: string | null }> {
  const userContent = [
    `<topic>${input.topicTitle}</topic>`,
    `<objective>${objective}</objective>`,
    `<beat kind="${kind}">${BEAT_BRIEF[kind]}</beat>`,
    focus === '' ? '' : `<focus>${focus}</focus>`,
    input.relatedQuestions.length === 0
      ? ''
      : `<exam_questions>\n${input.relatedQuestions.join('\n---\n')}\n</exam_questions>`,
    `<material>\n${pagesText(input)}\n</material>`,
    extra === '' ? '' : `<repair>${extra}</repair>`,
  ]
    .filter((part) => part !== '')
    .join('\n');

  const draft = await boundedModelTask(ctx, TEACH_BEAT, userContent, BeatSchema, {
    temperature: 0.3,
    maxTokens: 1_400,
  });
  return { beat: toBeat(draft, kind), animationBrief: animationBriefOf(draft) };
}

function animationBriefOf(draft: BeatDraft): string | null {
  const animation = draft.animation;
  if (animation === null || animation === undefined || !animation.needed) return null;
  const brief = animation.brief.trim();
  return brief === '' ? null : brief;
}

function toBeat(draft: BeatDraft, kind: LessonBeatKind): LessonBeat {
  return {
    title: draft.title,
    kind,
    intro: draft.intro,
    blocks: draft.blocks as LessonBlock[],
    takeaway: draft.takeaway ?? null,
    check: draft.check ?? null,
    citationPages: draft.citationPages,
  };
}

function fallbackBeat(input: LessonInput, kind: LessonBeatKind, objective: string): LessonBeat {
  return {
    title: `What your notes say about ${input.topicTitle}`,
    kind,
    intro:
      'The teaching model could not produce a reliable explanation for this beat, so here is the source text instead.',
    blocks: [
      // Fenced code, not parsed Markdown: an unbalanced $ or half a LaTeX
      // environment in OCR text would otherwise swallow the next page header
      // into a broken formula and paint the rest of the excerpt red.
      ...input.pages.slice(0, 2).map((page) => ({
        type: 'code' as const,
        language: 'text',
        code: `Page ${page.pageNumber}\n${page.text.slice(0, 1_200)}`,
      })),
      {
        type: 'callout',
        tone: 'note',
        title: 'Next step',
        text: `Open the Tutor and ask: "Teach me ${input.topicTitle} - ${objective}".`,
      },
    ],
    takeaway: null,
    check: null,
    citationPages: input.pages.map((page) => page.pageNumber),
  };
}

const AnimationSchema = z.object({
  title: z.string().min(2).max(80),
  html: z.string().min(200).max(24_000),
});

/** Two animations per core lesson is enough; a recap gets one at most. */
const MAX_ANIMATIONS = 2;
/** A failed animation must not occupy the whole lesson build. */
const MAX_ANIMATION_ATTEMPTS = 3;

/**
 * The frame is sandboxed without same-origin, but a generated page that tries
 * to load the outside world is still not what a lesson should contain.
 */
const UNSAFE_ANIMATION =
  /https?:\/\/|<\s*(?:link|iframe|object|embed|video|audio|source)\b|<\s*script[^>]+src\s*=|@import\b|\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|window\.open|document\.cookie/i;

/**
 * One extra model call, after a beat has asked for a visual. Best effort: a
 * failure leaves the beat exactly as it was, never a half-written lesson.
 */
async function writeAnimation(
  ctx: RunContext,
  input: LessonInput,
  beat: LessonBeat,
  brief: string,
): Promise<LessonAnimation | null> {
  try {
    const draft = await boundedModelTask(
      ctx,
      ANIMATION_SCRIPT,
      [
        `<topic>${input.topicTitle}</topic>`,
        `<beat>${beat.title}\n${beat.intro}</beat>`,
        `<brief>${brief}</brief>`,
      ].join('\n'),
      AnimationSchema,
      { temperature: 0.2, maxTokens: 3_000 },
    );
    if (UNSAFE_ANIMATION.test(draft.html)) return null;
    return { title: draft.title.trim(), html: draft.html, brief };
  } catch {
    return null;
  }
}

async function reviewBeat(
  ctx: RunContext,
  input: LessonInput,
  beat: LessonBeat,
): Promise<LessonBeat> {
  try {
    const result = await boundedModelTask(
      ctx,
      TEACH_CRITIC,
      `<beat>${JSON.stringify(beat)}</beat>\n<material>\n${pagesText(input)}\n</material>`,
      CriticSchema,
      { temperature: 0, maxTokens: 900 },
    );
    if (result.pass) return beat;
    if (result.repaired !== null && result.repaired !== undefined) {
      return toBeat(result.repaired, beat.kind);
    }
    return beat;
  } catch {
    // A critic failure must not lose the beat: keep the original.
    return beat;
  }
}

function blockToMarkdown(block: LessonBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'steps':
      return block.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    case 'compare': {
      const header = `| ${block.columns.join(' | ')} |`;
      const rule = `| ${block.columns.map(() => '---').join(' | ')} |`;
      const rows = block.rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
      return [header, rule, rows].join('\n');
    }
    case 'equation':
      return block.label === undefined
        ? `$$${block.latex}$$`
        : `$$${block.latex}$$ *( ${block.label} )*`;
    case 'code':
      return [
        `\`\`\`${block.language}`,
        block.code,
        '```',
        ...(block.trace ?? []).map((line) => `- ${line}`),
      ].join('\n');
    case 'callout':
      return `> **${block.title ?? (block.tone === 'trap' ? 'Trap' : block.tone === 'tip' ? 'Tip' : 'Note')}:** ${block.text}`;
    case 'flow':
      return block.nodes
        .map((node) => {
          const outgoing = block.edges
            .filter((edge) => edge.from === node.id)
            .map((edge) => `${edge.to}${edge.label === undefined ? '' : ` (${edge.label})`}`)
            .join(', ');
          return `- ${node.label}${outgoing === '' ? '' : ` → ${outgoing}`}`;
        })
        .join('\n');
    case 'recall':
      return `**Recall:** ${block.prompt}\n\n**Answer:** ${block.answer}`;
  }
}

export function documentToMarkdown(document: LessonDocument): string {
  const parts = [`# ${document.title}`, `_${document.objective}_`];
  for (const beat of document.beats) {
    parts.push(`## ${beat.title}`, beat.intro);
    for (const block of beat.blocks) parts.push(blockToMarkdown(block));
    if (beat.takeaway !== null) parts.push(`> **Takeaway:** ${beat.takeaway}`);
  }
  if (document.checkQuestions.length > 0) {
    parts.push(
      '## Check yourself',
      document.checkQuestions
        .map((question, index) => `${index + 1}. ${question.prompt} (Answer: ${question.answer})`)
        .join('\n'),
    );
  }
  return parts.join('\n\n');
}

/**
 * Builds a whole lesson, one beat per model call, and saves the structured
 * document next to the Markdown fallback.
 */
export async function buildTeachingLesson(
  ctx: RunContext,
  topicId: string,
  options: TeachOptions = {},
): Promise<{ lessonId: string; document: LessonDocument }> {
  const depth = options.depth ?? 'core';
  const report = options.onProgress ?? (() => {});
  report(5, 'Reading the material for this topic');
  const input = await lessonInput(ctx, topicId, depth);
  if (input.pages.length === 0) {
    throw new Error('No material pages to ground the lesson. Read material first.');
  }
  report(12, 'Planning the lesson objective');

  let objective = `Explain ${input.topicTitle} and apply it to an exam question.`;
  let why = '';
  try {
    const plan = await boundedModelTask(
      ctx,
      LESSON_OBJECTIVE,
      `<topic>${input.topicTitle}</topic>\n<material>\n${pagesText(input)}\n</material>`,
      ObjectiveSchema,
      { temperature: 0.2, maxTokens: 200 },
    );
    objective = plan.objective;
    why = plan.why;
  } catch {
    // The skeleton and the notes are enough to continue.
  }

  report(14, 'Planning the slides');
  const plan = await planBeats(ctx, input, objective, depth);
  const animate = options.animate !== false;
  const onSlide = options.onSlide ?? (() => {});
  let animationBudget = depth === 'bridge' ? 1 : MAX_ANIMATIONS;
  let animationAttempts = 0;

  const makeDocument = (beats: LessonBeat[]): LessonDocument => ({
    version: 2,
    title: input.topicTitle,
    objective: why === '' ? objective : `${objective} ${why}`,
    beats,
    plannedBeats: plan.length,
    checkQuestions: beats
      .map((beat) => beat.check)
      .filter((check): check is { prompt: string; answer: string } => check !== null)
      .slice(0, 3),
    citations: [...new Set(beats.flatMap((beat) => beat.citationPages))].sort((a, b) => a - b),
    isGeneralContent: false,
  });

  // The lesson record is created with its first finished slide, so every
  // further slide saves straight into it and is readable immediately. The old
  // lesson stays active until then, and a cancelled build loses nothing.
  let lessonId: string | null = null;
  const persist = async (document: LessonDocument) => {
    if (lessonId === null) {
      const created = await saveActiveLesson(ctx.db.driver, {
        scope: 'course',
        courseId: ctx.course.id,
        topicId,
        language: 'mixed',
        depth,
        contentMd: documentToMarkdown(document),
        citations: document.citations.map((page) => ({ page })),
        isGeneralContent: false,
      });
      lessonId = created.id;
    } else {
      await ctx.db.driver.execute(
        'UPDATE lessons SET content_md = $1, citations = $2 WHERE id = $3',
        [
          documentToMarkdown(document),
          JSON.stringify(document.citations.map((page) => ({ page }))),
          lessonId,
        ],
      );
    }
    await saveLessonDocument(ctx.db.driver, lessonId, document, TEACH_BEAT.version);
    onSlide(document, lessonId);
  };

  const beats: LessonBeat[] = [];
  for (const [beatIndex, planned] of plan.entries()) {
    const kind = planned.kind;
    report(
      18 + Math.round((beatIndex / Math.max(1, plan.length)) * 70),
      `Writing slide ${beatIndex + 1} of ${plan.length}`,
    );
    let beat: LessonBeat;
    let animationBrief: string | null = null;
    try {
      const written = await writeBeat(ctx, input, objective, kind, '', planned.focus);
      beat = written.beat;
      animationBrief = written.animationBrief;
      if (kind === 'worked' || kind === 'intuition' || kind === 'exam_shape') {
        beat = await reviewBeat(ctx, input, beat);
      }
    } catch {
      beat = fallbackBeat(input, kind, objective);
    }
    if (kind === 'recall' && !beat.blocks.some((block) => block.type === 'recall')) {
      const check = beat.check ?? {
        prompt: `In one sentence, what is the key idea of ${input.topicTitle}?`,
        answer: beat.takeaway ?? beat.intro,
      };
      beat = {
        ...beat,
        blocks: [...beat.blocks, { type: 'recall', prompt: check.prompt, answer: check.answer }],
        check,
      };
    }
    beats.push(beat);
    // Show this slide now; the rest keep writing while it is read.
    await persist(makeDocument(beats));

    // The beat model decides whether the idea needs motion, not the app: most
    // beats do not, so a lesson is not padded with animations nobody asked for.
    if (
      animate &&
      animationBrief !== null &&
      animationBudget > 0 &&
      animationAttempts < MAX_ANIMATION_ATTEMPTS
    ) {
      animationAttempts += 1;
      report(
        18 + Math.round((beatIndex / Math.max(1, plan.length)) * 70),
        `Animating the idea for slide ${beatIndex + 1}`,
      );
      const animation = await writeAnimation(ctx, input, beat, animationBrief);
      if (animation !== null) {
        beat = { ...beat, animation };
        beats[beats.length - 1] = beat;
        animationBudget -= 1;
        await persist(makeDocument(beats));
      }
    }
  }

  report(94, 'Saving the lesson');
  const document = makeDocument(beats);
  await persist(document);
  if (lessonId === null) throw new Error('The lesson could not be saved.');
  return { lessonId, document };
}

/**
 * Adds a generated animation to an existing slide on request. Automatic
 * builds only animate beats that asked for motion; this is the manual path
 * for a slide the learner wants to see move after the fact.
 */
export async function addTeachingAnimation(
  ctx: RunContext,
  lessonId: string,
  topicId: string,
  beatIndex: number,
): Promise<LessonDocument> {
  const existing = await getLessonDocument(ctx.db.driver, lessonId);
  if (existing === null) throw new Error('This lesson has no teaching board to animate.');
  const current = existing.beats[beatIndex];
  if (current === undefined) throw new Error('That slide no longer exists.');
  if (current.animation !== undefined && current.animation !== null) return existing;
  // Only the topic title is used by the animation prompt: skip page retrieval.
  const topicRows = await ctx.db.driver.select<{ title: string }>(
    'SELECT title FROM topics WHERE id = $1',
    [topicId],
  );
  const input: LessonInput = {
    topicTitle: topicRows[0]?.title ?? topicId,
    pages: [],
    relatedQuestions: [],
  };
  const brief = `Animate the central mechanism of this slide so it can be watched: ${current.title}. ${current.intro}`.slice(
    0,
    400,
  );
  const animation = await writeAnimation(ctx, input, current, brief);
  if (animation === null) {
    throw new Error('The animation could not be generated. Try again, or pick a slide with a clear process.');
  }
  const beats = existing.beats.map((beat, index) =>
    index === beatIndex ? { ...beat, animation } : beat,
  );
  const next: LessonDocument = { ...existing, beats };
  await saveLessonDocument(ctx.db.driver, lessonId, next, TEACH_BEAT.version);
  await ctx.db.driver.execute('UPDATE lessons SET content_md = $1 WHERE id = $2', [
    documentToMarkdown(next),
    lessonId,
  ]);
  return next;
}

/** Rebuilds one beat and saves the updated document (per-beat repair). */
export async function rebuildTeachingBeat(
  ctx: RunContext,
  lessonId: string,
  topicId: string,
  beatIndex: number,
): Promise<LessonDocument> {
  const existing = await getLessonDocument(ctx.db.driver, lessonId);
  if (existing === null) throw new Error('This lesson has no teaching board to rebuild.');
  const current = existing.beats[beatIndex];
  if (current === undefined) throw new Error('That beat no longer exists.');
  const input = await lessonInput(ctx, topicId, 'core');
  let beat: LessonBeat;
  let animationBrief: string | null = null;
  try {
    const written = await writeBeat(
      ctx,
      input,
      existing.objective,
      current.kind,
      'The learner asked for a clearer explanation of this beat.',
    );
    beat = written.beat;
    animationBrief = written.animationBrief;
    beat = await reviewBeat(ctx, input, beat);
  } catch {
    beat = fallbackBeat(input, current.kind, existing.objective);
  }
  // Keep the beat's visual when it had one: regenerating the explanation must
  // not silently remove the animation the learner was watching.
  const brief = animationBrief ?? current.animation?.brief ?? null;
  if (current.animation !== undefined && current.animation !== null && brief !== null) {
    const animation = await writeAnimation(ctx, input, beat, brief);
    if (animation !== null) beat = { ...beat, animation };
  }
  const beats = existing.beats.map((item, index) => (index === beatIndex ? beat : item));
  const next: LessonDocument = {
    ...existing,
    beats,
    checkQuestions: beats
      .map((item) => item.check)
      .filter((check): check is { prompt: string; answer: string } => check !== null)
      .slice(0, 3),
    citations: [...new Set(beats.flatMap((item) => item.citationPages))].sort((a, b) => a - b),
  };
  await saveLessonDocument(ctx.db.driver, lessonId, next, TEACH_BEAT.version);
  await ctx.db.driver.execute('UPDATE lessons SET content_md = $1 WHERE id = $2', [
    documentToMarkdown(next),
    lessonId,
  ]);
  return next;
}
