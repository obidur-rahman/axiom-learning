import { z } from 'zod';
import { ProviderError, chatJson, type ProviderConfig } from '@axiom/ai';
import {
  buildAndSaveRoadmap,
  getProviderSettings,
  pastQuestionCounts as confirmedPastQuestionCounts,
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
  /** Aborts the in-flight model request when the learner stops the job. */
  signal?: AbortSignal;
}

export class PipelineError extends Error {
  reason: 'provider' | 'schema' | 'limits';
  constructor(reason: 'provider' | 'schema' | 'limits', message: string) {
    super(message);
    this.name = 'PipelineError';
    this.reason = reason;
  }
}

const TopicItemSchema = z.object({ id: z.string().min(1), title: z.string().min(1) });
const EdgeItemSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

/**
 * Small models regularly answer with the bare list instead of the wrapper
 * object the prompt asks for (`[...]` instead of `{"topics":[...]}`). That is
 * a formatting slip, not a bad answer, so unwrap it before validating.
 */
const TopicListSchema = z.preprocess(
  (value) => (Array.isArray(value) ? { topics: value } : value),
  z.object({ topics: z.array(TopicItemSchema).min(1).max(200) }),
);
const EdgeListSchema = z.preprocess(
  (value) => (Array.isArray(value) ? { edges: value } : value),
  z.object({ edges: z.array(EdgeItemSchema).max(2000) }),
);

/**
 * One small bounded model task: JSON-mode chat, Zod-validated, up to 2
 * retries (TRD 8.2), temperature 0 for extraction (TRD 8.1 level A).
 */
export async function boundedModelTask<T>(
  ctx: RunContext,
  prompt: PromptSpec,
  userContent: string,
  schema: z.ZodType<T>,
  options: { temperature?: number; maxTokens?: number } = {},
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
      {
        retries: 2,
        temperature: options.temperature ?? 0,
        maxTokens: options.maxTokens,
        ...(config.chatThink === undefined ? {} : { think: config.chatThink }),
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      },
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

/**
 * Characters of material per model call. Local models usually run with a 4k
 * token context (~2.4k tokens of text, plus prompt and answer); a single
 * 20k-character request was rejected with HTTP 400 "exceeds the available
 * context size" before any topic was extracted.
 */
const MATERIAL_CHAR_BUDGET = 4_500;
/** Bound on extraction calls for one course, so 130 pages stay workable. */
const MAX_TOPIC_CHUNKS = 8;

/** Splits the readable pages into request-sized groups, keeping page headers. */
function chunkMaterial(pages: { text: string | null }[]): string[] {
  const chunks: string[] = [];
  let current = '';
  pages.forEach((page, index) => {
    const text = (page.text ?? '').slice(0, MATERIAL_CHAR_BUDGET);
    if (text.trim() === '') return;
    const block = `PAGE ${index + 1}\n${text}`;
    if (current !== '' && current.length + block.length > MATERIAL_CHAR_BUDGET) {
      chunks.push(current);
      current = '';
    }
    current += (current === '' ? '' : '\n') + block;
  });
  if (current.trim() !== '') chunks.push(current);
  return chunks;
}

/** Spreads picks across the list, so the first and last pages are represented. */
function evenlySpaced<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * step)] as T);
}

/** The provider refused the request because it does not fit the context. */
function isContextOverflow(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  return /context|exceed|too many tokens|too long/i.test(error.message);
}

async function extractTopicsFrom(ctx: RunContext, material: string) {
  const ask = (content: string) =>
    boundedModelTask(ctx, TOPIC_EXTRACTION, `<material>\n${content}\n</material>`, TopicListSchema);
  try {
    return await ask(material);
  } catch (error) {
    if (!isContextOverflow(error) || material.length <= MATERIAL_CHAR_BUDGET / 2) throw error;
    // A smaller context than expected: retry once with a shorter slice rather
    // than failing the whole topic build.
    return ask(material.slice(0, Math.floor(MATERIAL_CHAR_BUDGET / 2)));
  }
}

/**
 * Step 2 (TRD 5.2): build the Topic list from syllabus/notes pages. The pages
 * are read in budget-sized chunks and the topic lists merged, so a long scan
 * produces topics instead of a context-length error.
 */
export async function buildTopicsStep(
  ctx: RunContext,
  pages: { text: string | null }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Topic[]> {
  const chunks = evenlySpaced(chunkMaterial(pages), MAX_TOPIC_CHUNKS);
  if (chunks.length === 0) {
    throw new PipelineError('limits', 'The material has no readable text yet.');
  }
  const titles = new Map<string, string>();
  for (const [index, chunk] of chunks.entries()) {
    const { topics } = await extractTopicsFrom(ctx, chunk);
    for (const topic of topics) {
      const title = topic.title.trim();
      if (title === '') continue;
      const key = title.toLowerCase();
      if (!titles.has(key)) titles.set(key, title);
    }
    onProgress?.(index + 1, chunks.length);
  }
  const topics = [...titles.values()].map((title, index) => ({ id: `T${index + 1}`, title }));
  if (topics.length === 0) {
    throw new PipelineError('schema', 'The model found no topics in this material.');
  }
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
  const confirmedCounts = await confirmedPastQuestionCounts(ctx.db.driver, ctx.course.id);
  if (Object.keys(confirmedCounts).length > 0) {
    // Confirmed real questions are a stronger importance signal than a title
    // mention in the past-paper text.
    for (const topic of topicRows) {
      pastQuestionCounts[topic.id] = confirmedCounts[topic.id] ?? 0;
    }
  } else {
    for (const topic of topicRows) {
      pastQuestionCounts[topic.id] = countMentions(topic.title, pastText);
    }
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
      `Topics:\n${listing.slice(0, MATERIAL_CHAR_BUDGET)}\n`,
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
