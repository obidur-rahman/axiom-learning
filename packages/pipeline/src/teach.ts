import { z } from 'zod';
import {
  getLessonDocument,
  saveActiveLesson,
  saveLessonDocument,
  type LessonBeat,
  type LessonBeatKind,
  type LessonBlock,
  type LessonDocument,
} from '@axiom/data';
import { retrievePagesSmart } from './embeddings';
import { retrievePages } from './tutor';
import { LESSON_OBJECTIVE, TEACH_BEAT, TEACH_CRITIC } from './prompts';
import { boundedModelTask, type RunContext } from './steps';

/**
 * Teaching engine. The app chooses the beat skeleton; the model writes one
 * small beat at a time. Every beat is validated, optionally reviewed, and
 * saved as structured JSON. The old Markdown lesson stays as a fallback and
 * for export.
 */

const BlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }),
  z.object({ type: z.literal('steps'), items: z.array(z.string().min(1)).min(2).max(12) }),
  z.object({
    type: z.literal('compare'),
    columns: z.array(z.string().min(1)).min(2).max(5),
    rows: z.array(z.array(z.string())).min(1).max(12),
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
  blocks: z.array(BlockSchema).min(1).max(4),
  takeaway: z.string().nullable().optional(),
  check: z.object({ prompt: z.string().min(1), answer: z.string().min(1) }).nullable().optional(),
  citationPages: z.array(z.number().int().min(1)).max(20).default([]),
});

const ObjectiveSchema = z.object({
  objective: z.string().min(3),
  why: z.string().min(3),
});

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
  /** Reported per build stage so the UI can show real progress. */
  onProgress?: (percent: number, message: string) => void;
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

/** Deterministic skeleton. A bridge recap keeps the explanation beats only. */
export function beatSkeleton(depth: 'core' | 'bridge'): LessonBeatKind[] {
  return depth === 'bridge'
    ? ['hook', 'intuition', 'worked', 'recall']
    : SKELETON;
}

async function writeBeat(
  ctx: RunContext,
  input: LessonInput,
  objective: string,
  kind: LessonBeatKind,
  extra: string,
): Promise<LessonBeat> {
  const userContent = [
    `<topic>${input.topicTitle}</topic>`,
    `<objective>${objective}</objective>`,
    `<beat kind="${kind}">${BEAT_BRIEF[kind]}</beat>`,
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
    maxTokens: 900,
  });
  return toBeat(draft, kind);
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
  const excerpt = input.pages
    .map((page) => `Page ${page.pageNumber}: ${page.text.slice(0, 600)}`)
    .join('\n');
  return {
    title: `What your notes say about ${input.topicTitle}`,
    kind,
    intro:
      'The teaching model could not produce a reliable explanation for this beat, so here is the source text instead.',
    blocks: [
      { type: 'text', text: excerpt === '' ? 'No readable note pages were found.' : excerpt },
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

  const beats: LessonBeat[] = [];
  const skeleton = beatSkeleton(depth);
  for (const [beatIndex, kind] of skeleton.entries()) {
    report(
      18 + Math.round((beatIndex / Math.max(1, skeleton.length)) * 72),
      `Writing beat ${beatIndex + 1} of ${skeleton.length}`,
    );
    let beat: LessonBeat;
    try {
      beat = await writeBeat(ctx, input, objective, kind, '');
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
  }

  const checks = beats
    .map((beat) => beat.check)
    .filter((check): check is { prompt: string; answer: string } => check !== null)
    .slice(0, 3);
  report(94, 'Saving the lesson');
  const citations = [...new Set(beats.flatMap((beat) => beat.citationPages))].sort((a, b) => a - b);
  const document: LessonDocument = {
    version: 2,
    title: input.topicTitle,
    objective: why === '' ? objective : `${objective} ${why}`,
    beats,
    checkQuestions: checks,
    citations,
    isGeneralContent: false,
  };

  const lesson = await saveActiveLesson(ctx.db.driver, {
    scope: 'course',
    courseId: ctx.course.id,
    topicId,
    language: 'mixed',
    depth,
    contentMd: documentToMarkdown(document),
    citations: citations.map((page) => ({ page })),
    isGeneralContent: false,
  });
  await saveLessonDocument(ctx.db.driver, lesson.id, document, TEACH_BEAT.version);
  return { lessonId: lesson.id, document };
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
  try {
    beat = await writeBeat(
      ctx,
      input,
      existing.objective,
      current.kind,
      'The learner asked for a clearer explanation of this beat.',
    );
    beat = await reviewBeat(ctx, input, beat);
  } catch {
    beat = fallbackBeat(input, current.kind, existing.objective);
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
