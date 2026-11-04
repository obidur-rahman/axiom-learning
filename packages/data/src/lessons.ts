import type { DbDriver } from './driver';
import type { Lesson } from './types';

function uuid(): string {
  return crypto.randomUUID();
}

interface LessonRow extends Record<string, unknown> {
  id: string; scope: string; course_id: string | null; topic_id: string | null;
  language: string; depth: string; content_md: string; citations: string | null;
  is_general_content: number; status: string; created_at: string;
}

export function rowToLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    scope: row.scope as Lesson['scope'],
    courseId: row.course_id,
    topicId: row.topic_id,
    language: row.language as Lesson['language'],
    depth: row.depth as Lesson['depth'],
    contentMd: row.content_md,
    citations: row.citations ? (JSON.parse(row.citations) as unknown[]) : null,
    isGeneralContent: !!row.is_general_content,
    status: row.status as Lesson['status'],
    createdAt: row.created_at,
  };
}

/**
 * Save a lesson as the active one for a topic. A previous active lesson is
 * marked replaced (DR-6: made results are saved; the report flow swaps them).
 */
export async function saveActiveLesson(
  db: DbDriver,
  lesson: Omit<Lesson, 'id' | 'status' | 'createdAt'> & { id?: string },
): Promise<Lesson> {
  if (lesson.topicId) {
    await db.execute(
      `UPDATE lessons SET status = 'replaced'
       WHERE topic_id = $1 AND language = $2 AND depth = $3 AND status = 'active'`,
      [lesson.topicId, lesson.language, lesson.depth],
    );
  }
  const saved: Lesson = {
    id: lesson.id ?? uuid(),
    scope: 'course',
    courseId: lesson.courseId,
    topicId: lesson.topicId,
    language: lesson.language,
    depth: lesson.depth,
    contentMd: lesson.contentMd,
    citations: lesson.citations ?? null,
    isGeneralContent: lesson.isGeneralContent,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  await db.execute(
    `INSERT INTO lessons (id, scope, course_id, topic_id, shared_concept_id, language,
       depth, content_md, citations, is_general_content, status, model_id, prompt_version, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, NULL, NULL, $11)`,
    [
      saved.id,
      saved.scope,
      saved.courseId,
      saved.topicId,
      saved.language,
      saved.depth,
      saved.contentMd,
      saved.citations ? JSON.stringify(saved.citations) : null,
      saved.isGeneralContent ? 1 : 0,
      saved.status,
      saved.createdAt,
    ],
  );
  return saved;
}

export async function getActiveLesson(
  db: DbDriver,
  topicId: string,
  language: string,
  depth?: string,
): Promise<Lesson | null> {
  if (!topicId) return null;
  const rows = await db.select<LessonRow>(
    `SELECT * FROM lessons WHERE topic_id = $1 AND language = $2 AND status = 'active'
     ${depth === undefined ? '' : 'AND depth = $3'}
     ORDER BY created_at DESC LIMIT 1`,
    depth === undefined ? [topicId, language] : [topicId, language, depth],
  );
  return rows.length > 0 && rows[0]!.scope === 'course' ? rowToLesson(rows[0]!) : null;
}

/** Flag a bad saved lesson (risk R5) and record the report row. */
export async function flagLesson(
  db: DbDriver,
  lessonId: string,
  reason: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO lesson_reports (id, lesson_id, reason)
     VALUES ($1, $2, $3)`,
    [uuid(), lessonId, reason],
  );
  await db.execute("UPDATE lessons SET status = 'flagged' WHERE id = $1", [lessonId]);
}
