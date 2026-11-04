import { z } from 'zod';
import { ProviderError, chatJson, type ProviderConfig } from '@axiom/ai';
import {
  buildAndSaveRoadmap,
  getProviderSettings,
  replaceEdges,
  saveProviderSettings,
  settingsToProviderConfig,
  upsertTopics,
  upsertWeights,
  type AxiomDb,
  type Course,
  type ProviderSettings,
} from '@axiom/data';
import { computeWeights, type Topic } from '@axiom/engine';
import { EDGE_PROPOSAL, TOPIC_EXTRACTION, type PromptSpec } from './prompts';

/** Context each step needs (DR-1: workflow logic in code, small model tasks). */
export interface RunContext {
  db: AxiomDb;
  course: Course;
  config: () => Promise<ProviderConfig | null>;
}

export class PipelineError extends Error {
  reason: 'provider' | 'schema' | 'limits';
  constructor(reason: 'provider' | 'schema' | 'limits', message: string) {
    super(message);
    this.name = 'PipelineError';
    this.reason = reason;
  }
}

const TopicListSchema = z.object({
  topics: z
    .array(z.object({ id: z.string().min(1), title: z.string().min(1) }))
    .min(1)
    .max(200),
});
const EdgeListSchema = z.object({
  edges: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(2000),
});

/**
 * One small bounded model task: JSON-mode chat, Zod-validated, up to 2
 * retries (TRD 8.2), temperature 0 for extraction (TRD 8.1 level A).
 */
export async function boundedModelTask<T>(
  ctx: RunContext,
  prompt: PromptSpec,
  userContent: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const config = await ctx.config();
  if (config === null) {
    throw new PipelineError('provider', 'No provider configured. Set it in Settings.');
  }
  let data: T;
  try {
    ({ data } = await chatJson(
      config,
      schema,
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: userContent },
      ],
      { retries: 2, temperature: 0 },
    ));
  } catch (error) {
    // Schema-validated failures after the retry budget surface as a schema
    // reason; other provider issues stay 'provider' (hosted-retry hint).
    if (error instanceof ProviderError && !error.status) {
      throw new PipelineError('schema', error.message);
    }
    throw error;
  }
  return data;
}

const MAX_INPUT_CHARS = 20_000;

/** Step 2 (TRD 5.2): build the Topic list from syllabus/notes pages. */
export async function buildTopicsStep(
  ctx: RunContext,
  pages: { text: string | null }[],
): Promise<Topic[]> {
  const material = pages
    .map((page, index) => `PAGE ${index + 1}\n${page.text ?? ''}`)
    .join('\n')
    .slice(0, MAX_INPUT_CHARS);
  if (material.trim().length === 0) {
    throw new PipelineError('limits', 'The material has no readable text yet.');
  }
  const { topics } = await boundedModelTask(
    ctx,
    TOPIC_EXTRACTION,
    `<material>\n${material}\n</material>`,
    TopicListSchema,
  );
  await upsertTopics(ctx.db.driver, ctx.course.id, topics, 'syllabus');
  await recalculateWeights(ctx);
  return topics;
}

/**
 * Weight step (TRD 5.4). Every topic found in the syllabus counts as
 * in_syllabus; topics that also appear in past-question pages earn a share
 * of the past_question weight (the model need not be involved: mention
 * counting is deterministic and cheap to re-run).
 */
export async function recalculateWeights(ctx: RunContext): Promise<Record<string, number>> {
  const topicRows = await ctx.db.driver.select<{ id: string; title: string }>(
    'SELECT id, title FROM topics WHERE course_id = $1',
    [ctx.course.id],
  );
  const pageRows = await ctx.db.driver.select<{ text: string | null; kind: string }>(
    `SELECT p.text, m.kind FROM material_pages p
     JOIN materials m ON m.id = p.material_id
     WHERE m.course_id = $1`,
    [ctx.course.id],
  );
  const pastText = pageRows
    .filter((row) => row.kind === 'past_questions' && row.text !== null)
    .map((row) => row.text!)
    .join('\n');
  const pastQuestionCounts: Record<string, number> = {};
  for (const topic of topicRows) {
    pastQuestionCounts[topic.id] = countMentions(topic.title, pastText);
  }
  const inSyllabus = new Set(topicRows.map((row) => row.id));
  const weights = computeWeights(
    topicRows.map((row) => ({ id: row.id })),
    { pastQuestionCounts, suggested: [], inSyllabus },
  );
  await upsertWeights(ctx.db.driver, ctx.course.id, weights, { inSyllabus });
  return weights;
}

/** Counts whole-word occurrences of a topic title inside free text. */
export function countMentions(title: string, text: string): number {
  const cleaned = title.trim().toLowerCase();
  if (cleaned === '' || text === '') return 0;
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.toLowerCase().match(new RegExp(escaped, 'g'));
  return matches === null ? 0 : matches.length;
}

/** Step 5 (TRD 5.5): propose edges with the model, then build the Roadmap. */
export async function buildRoadmapStep(ctx: RunContext): Promise<{ version: number }> {
  const topicRows = await ctx.db.driver.select<{ id: string; title: string }>(
    'SELECT id, title FROM topics WHERE course_id = $1 ORDER BY COALESCE(syllabus_order, 999999)',
    [ctx.course.id],
  );
  const listing = topicRows.map((row) => `${row.id}: ${row.title}`).join('\n');
  const knownIds = new Set(topicRows.map((row) => row.id));
  const knownEdges = await ctx.db.driver
    .select<{ prerequisite_id: string; topic_id: string; confidence: number | null }>(
      'SELECT prerequisite_id, topic_id, confidence FROM topic_edges WHERE course_id = $1 AND source = \'user\'',
      [ctx.course.id],
    )
    .catch(() => []);

  // Keep learner-drawn edges; only model edges regenerate on rebuild.
  await replaceEdges(
    ctx.db.driver,
    ctx.course.id,
    knownEdges.map((row) => ({
      from: row.prerequisite_id,
      to: row.topic_id,
      confidence: row.confidence ?? 0.8,
      source: 'manual' as const,
    })),
  );

  let modelEdges: { from: string; to: string; confidence: number }[] = [];
  try {
    const proposal = await boundedModelTask(
      ctx,
      EDGE_PROPOSAL,
      `Topics:\n${listing.slice(0, MAX_INPUT_CHARS)}\n`,
      EdgeListSchema,
    );
    modelEdges = proposal.edges.filter(
      (edge) => knownIds.has(edge.from) && knownIds.has(edge.to) && edge.from !== edge.to,
    );
  } catch (error) {
    if (!(error instanceof PipelineError) && !(error instanceof ProviderError)) {
      throw error;
    }
    // Model failed: rebuild with user edges only (pivot plan caveat 5).
  }
  await replaceEdges(
    ctx.db.driver,
    ctx.course.id,
    modelEdges.map((edge) => ({ ...edge, source: 'model' as const })),
  );

  const { version } = await buildAndSaveRoadmap(ctx.db.driver, ctx.course);
  return { version };
}

/** Settings helpers used by the app layer. */
export function providerConfigLoader(db: AxiomDb) {
  return async (): Promise<ProviderConfig | null> => {
    const settings = await getProviderSettings(db.driver);
    return settings === null ? null : settingsToProviderConfig(settings, undefined);
  };
}

export function settingsSaver(db: AxiomDb) {
  return (settings: ProviderSettings, detected = false) =>
    saveProviderSettings(db.driver, settings, detected);
}
