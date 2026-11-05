import { z } from 'zod';
import {
  listQuestions,
  questionFingerprint,
  replaceQuestionTopics,
  saveQuestion,
  type ExamQuestion,
} from '@axiom/data';
import { retrievePages } from './tutor';
import { PAST_QUESTION_EXTRACT, QUESTION_GENERATE } from './prompts';
import { boundedModelTask, type RunContext } from './steps';

/**
 * Past-paper question extraction. One model call per small chunk of pages,
 * deterministic dedupe, draft status. Nothing enters the study queue until a
 * human confirms it.
 */
const QuestionTypeSchema = z.enum([
  'definition',
  'explanation',
  'derivation',
  'numerical',
  'comparison',
  'diagram',
  'essay',
  'code',
  'other',
]);

const ExtractedQuestionSchema = z.object({
  prompt: z.string().min(4),
  year: z.number().int().min(1950).max(2200).nullable().optional(),
  paperLabel: z.string().max(120).nullable().optional(),
  questionNumber: z.string().max(40).nullable().optional(),
  marks: z.number().int().min(1).max(200).nullable().optional(),
  questionType: QuestionTypeSchema.default('other'),
  difficulty: z.number().int().min(1).max(5).default(3),
  topicIds: z.array(z.string()).max(10).default([]),
  topicTitles: z.array(z.string()).max(10).default([]),
  patternLabel: z.string().max(140).nullable().optional(),
  citationPages: z.array(z.number().int().min(1)).max(40).default([]),
});

const ExtractionSchema = z.object({
  questions: z.array(ExtractedQuestionSchema).max(60),
});

const GeneratedQuestionSchema = z.object({
  prompt: z.string().min(4),
  answerMd: z.string().min(10),
  keyPoints: z.array(z.string()).max(12).default([]),
  marks: z.number().int().min(1).max(200).nullable().optional(),
  questionType: QuestionTypeSchema.default('other'),
  difficulty: z.number().int().min(1).max(5).default(3),
  patternLabel: z.string().max(140).nullable().optional(),
  citationPages: z.array(z.number().int().min(1)).max(40).default([]),
});

const GenerationSchema = z.object({
  questions: z.array(GeneratedQuestionSchema).min(1).max(6),
});

export interface QuestionJobResult {
  extracted: number;
  skipped: number;
  chunks: number;
}

interface RawPage {
  material_id: string;
  page_number: number;
  text: string | null;
}

const CHUNK_CHARS = 6_000;

function chunkPages(pages: RawPage[]): RawPage[][] {
  const chunks: RawPage[][] = [];
  let current: RawPage[] = [];
  let used = 0;
  let materialId: string | null = null;
  for (const page of pages) {
    const length = page.text?.length ?? 0;
    const crossedMaterial = materialId !== null && page.material_id !== materialId;
    if (current.length > 0 && (crossedMaterial || used + length > CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    materialId = page.material_id;
    current.push(page);
    used += length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Extracts questions from past-paper pages and saves them as drafts. */
export async function extractPastQuestionsStep(ctx: RunContext): Promise<QuestionJobResult> {
  const pages = await ctx.db.driver.select<RawPage>(
    `SELECT p.material_id, p.page_number, p.text
     FROM material_pages p JOIN materials m ON m.id = p.material_id
     WHERE m.course_id = $1 AND m.kind = 'past_questions'
     ORDER BY p.material_id, p.page_number`,
    [ctx.course.id],
  );
  const readable = pages.filter((page) => (page.text ?? '').trim().length > 0);
  if (readable.length === 0) {
    throw new Error('No readable past-paper pages. Upload the paper first.');
  }

  const topicRows = await ctx.db.driver.select<{ id: string; title: string }>(
    'SELECT id, title FROM topics WHERE course_id = $1',
    [ctx.course.id],
  );
  const byId = new Map(topicRows.map((row) => [row.id, row.id]));
  const byTitle = new Map(topicRows.map((row) => [normalise(row.title), row.id]));
  const topicListing = topicRows.map((row) => `${row.id}: ${row.title}`).join('\n');

  const existing = await listQuestions(ctx.db.driver, ctx.course.id);
  const seen = new Set(
    existing.map((question) =>
      questionFingerprint(question.prompt, question.year, question.questionNumber),
    ),
  );

  const chunks = chunkPages(readable);
  let extracted = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    const material = chunk
      .map(
        (page) =>
          `PAGE ${page.page_number} (material ${page.material_id})\n${(page.text ?? '').slice(0, 4_000)}`,
      )
      .join('\n\n')
      .slice(0, CHUNK_CHARS + 2_000);
    const result = await boundedModelTask(
      ctx,
      PAST_QUESTION_EXTRACT,
      `<topics>\n${topicListing}\n</topics>\n<material>\n${material}\n</material>`,
      ExtractionSchema,
      { temperature: 0.1, maxTokens: 2_000 },
    );

    for (const question of result.questions) {
      const fingerprint = questionFingerprint(
        question.prompt,
        question.year ?? null,
        question.questionNumber ?? null,
      );
      if (seen.has(fingerprint)) {
        skipped += 1;
        continue;
      }
      seen.add(fingerprint);
      const topicIds = [
        ...new Set([
          ...question.topicIds.filter((id) => byId.has(id)),
          ...question.topicTitles
            .map((title) => byTitle.get(normalise(title)))
            .filter((id): id is string => id !== undefined),
        ]),
      ];
      const firstPage = chunk[0]?.page_number ?? null;
      const saved = await saveQuestion(ctx.db.driver, {
        courseId: ctx.course.id,
        materialId: chunk[0]?.material_id ?? null,
        topicId: topicIds[0] ?? null,
        source: 'past_paper',
        prompt: question.prompt.trim(),
        year: question.year ?? null,
        paperLabel: question.paperLabel ?? null,
        questionNumber: question.questionNumber ?? null,
        marks: question.marks ?? null,
        questionType: question.questionType,
        difficulty: question.difficulty,
        difficultySource: 'model',
        patternLabel: question.patternLabel ?? null,
        citationPages:
          question.citationPages.length > 0
            ? question.citationPages
            : firstPage === null
              ? []
              : [firstPage],
        status: 'draft',
        promptVersion: PAST_QUESTION_EXTRACT.version,
      });
      await replaceQuestionTopics(ctx.db.driver, saved.id, topicIds);
      extracted += 1;
    }
  }

  return { extracted, skipped, chunks: chunks.length };
}

export interface GenerateQuestionResult {
  generated: number;
  topics: number;
}

/**
 * Generates practice questions for every topic that has no confirmed past
 * question. Generated questions are always labelled and always drafts.
 */
export async function generateQuestionsStep(ctx: RunContext): Promise<GenerateQuestionResult> {
  const topics = await ctx.db.driver.select<{ id: string; title: string }>(
    `SELECT id, title FROM topics WHERE course_id = $1
     ORDER BY COALESCE(syllabus_order, 999999), created_at`,
    [ctx.course.id],
  );
  if (topics.length === 0) {
    throw new Error('No topics yet. Build the topic list first.');
  }

  const questions = await listQuestions(ctx.db.driver, ctx.course.id);
  const topicsWithPast = new Set<string>();
  const topicsWithGenerated = new Set<string>();
  for (const question of questions) {
    for (const topicId of question.topicIds) {
      if (question.status !== 'confirmed' && question.status !== 'draft') continue;
      if (question.source === 'past_paper') topicsWithPast.add(topicId);
      if (question.source === 'generated') topicsWithGenerated.add(topicId);
    }
  }

  let generated = 0;
  let covered = 0;
  for (const topic of topics) {
    if (topicsWithPast.has(topic.id) || topicsWithGenerated.has(topic.id)) continue;
    const pages = await retrievePages(ctx.db.driver, ctx.course.id, topic.title, 5);
    const evidence = pages.filter((page) => page.text.trim() !== '' && page.score > 0);
    if (evidence.length === 0) continue;
    const result = await boundedModelTask(
      ctx,
      QUESTION_GENERATE,
      `<topic>${topic.title}</topic>\n<material>\n${evidence
        .map((page) => `PAGE ${page.pageNumber}\n${page.text.slice(0, 3_500)}`)
        .join('\n\n')
        .slice(0, 10_000)}\n</material>`,
      GenerationSchema,
      { temperature: 0.3, maxTokens: 1_800 },
    );
    for (const question of result.questions) {
      await saveQuestion(ctx.db.driver, {
        courseId: ctx.course.id,
        topicId: topic.id,
        source: 'generated',
        prompt: question.prompt.trim(),
        answerMd: question.answerMd.trim(),
        rubric: { keyPoints: question.keyPoints },
        marks: question.marks ?? null,
        questionType: question.questionType,
        difficulty: question.difficulty,
        difficultySource: 'model',
        patternLabel: question.patternLabel ?? null,
        citationPages: question.citationPages,
        status: 'draft',
        promptVersion: QUESTION_GENERATE.version,
      });
      generated += 1;
    }
    covered += 1;
  }

  return { generated, topics: covered };
}

/** Counts questions by source for the Study tab summary. */
export function summariseQuestions(questions: ExamQuestion[]): {
  past: number;
  generated: number;
  drafts: number;
} {
  return {
    past: questions.filter((question) => question.source === 'past_paper' && question.status === 'confirmed').length,
    generated: questions.filter((question) => question.source === 'generated' && question.status === 'confirmed').length,
    drafts: questions.filter((question) => question.status === 'draft').length,
  };
}
