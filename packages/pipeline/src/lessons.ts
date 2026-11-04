import { saveActiveLesson, type DbDriver } from '@axiom/data';
import type { ProviderConfig } from '@axiom/ai';
import { retrievePagesSmart } from './embeddings';
import { LESSON_BUILD } from './prompts';
import { boundedModelTask, type RunContext } from './steps';
import { z } from 'zod';

const LessonSchema = z.object({
  sections: z
    .array(z.object({ title: z.string(), markdown: z.string() }))
    .min(1)
    .max(12),
  citations: z.array(z.object({ page: z.number().int().min(1) })).max(200),
  checkQuestions: z
    .array(z.object({ prompt: z.string(), answer: z.string() }))
    .min(3)
    .max(6),
});

export interface LessonDraft {
  contentMd: string;
  citations: number[];
  isGeneralContent: boolean;
  checkQuestions: { prompt: string; answer: string }[];
}

const MAX_LESSON_CHARS = 16_000;

/**
 * Lessons and diagnostics (pivot plan task 6): one topic + one depth per
 * job (DR-1). Retrieval is suggestion-local per material: pages of the same
 * course, keyword-scored. Every factual claim must come from a retrieved
 * page - citations there list the page number. When nothing has evidence:
 * isGeneralContent=true and the first section says so (FR-057 rule).
 */
export async function buildLessonStep(
  driver: DbDriver,
  courseId: string,
  topicId: string,
  config: RunContext['config'],
  depth: 'core' | 'bridge' = 'core',
): Promise<LessonDraft> {
  const { topicTitle, pages } = await lessonInput(driver, courseId, topicId, await config());
  if (pages.length === 0) {
    throw new Error('No material pages to ground the lesson. Read material first.');
  }
  const ctx: RunContext = {
    db: { driver } as never,
    course: { id: courseId } as never,
    config,
  };
  const result = await boundedModelTask(
    ctx,
    LESSON_BUILD,
    `<topic>${topicTitle}</topic>\n<material>\n${pages
      .map((page) => `PAGE ${page.pageNumber} (score ${page.score}): ${page.text ?? ''}`)
      .join('\n\n')
      .slice(0, MAX_LESSON_CHARS)}\n</material>`,
    LessonSchema,
  );

  const contentMd = result.sections.map((section) => `## ${section.title}\n\n${section.markdown}`).join('\n\n');
  const isGeneral = result.citations.length === 0;
  const draft: LessonDraft = {
    contentMd: isGeneral
      ? `# ${topicTitle}\n\n_I could not find this in your material for pages you uploaded._\n\n${contentMd}`
      : `# ${topicTitle}\n\n${contentMd}`,
    citations: result.citations.map((cit) => cit.page),
    isGeneralContent: isGeneral,
    checkQuestions: result.checkQuestions,
  };
  // The check questions are part of the saved lesson (single source), so the
  // UI can render the 3-question diagnostic without another query.
  draft.contentMd +=
    '\n\n## Check yourself\n\n' +
    draft.checkQuestions
      .map((question, index) => `${index + 1}. ${question.prompt} (Answer: ${question.answer})`)
      .join('\n');
  // The diagnostic uses exactly 3 check questions (app flow SC-04).
  draft.checkQuestions = result.checkQuestions.slice(0, 3);

  await saveActiveLesson(driver, {
    scope: 'course',
    courseId,
    topicId,
    language: 'mixed',
    depth,
    contentMd: draft.contentMd,
    citations: result.citations.map((cit) => ({ page: cit.page })),
    isGeneralContent: draft.isGeneralContent,
  });
  return draft;
}

interface LessonPage {
  pageNumber: number;
  text: string | null;
  score: number;
}

async function lessonInput(
  db: DbDriver,
  courseId: string,
  topicId: string,
  resolvedConfig?: ProviderConfig | null,
): Promise<{ topicTitle: string; pages: LessonPage[] }> {
  const topicRows = await db.select<{ title: string }>('SELECT title FROM topics WHERE id = $1', [topicId]);
  const topicTitle = topicRows[0]?.title ?? topicId;
  // With an embedding model configured and stored vectors, cosine ranking is
  // more faithful than title keywords; it falls back to keyword search
  // whenever there is nothing to embed against.
  if (resolvedConfig !== undefined && resolvedConfig !== null) {
    const smart = await retrievePagesSmart(db, courseId, topicTitle, resolvedConfig);
    if (smart.length > 0) {
      return { topicTitle, pages: smart };
    }
  }
  const pageRows = await db.select<{ page_number: number; text: string | null }>(
    `SELECT p.page_number, p.text FROM material_pages p
     JOIN materials m ON m.id = p.material_id
     WHERE m.course_id = $1`,
    [courseId],
  );
  const terms = tokenize(topicTitle);
  const pages = pageRows
    .map((row) => {
      const text = row.text ?? '';
      const lower = text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let count = 0;
        let offset = 0;
        while ((offset = lower.indexOf(term, offset)) !== -1) {
          count += 1;
          offset += term.length;
        }
        score += count;
      }
      return { pageNumber: row.page_number, text, score };
    })
    .filter((page) => page.text !== null && page.text.trim() !== '')
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return { topicTitle, pages };
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z\u0980-\u09ff]+/i)
    .filter((term) => term.length > 2);
}
