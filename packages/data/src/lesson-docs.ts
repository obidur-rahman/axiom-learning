import type { DbDriver } from './driver';
import type { LessonDocument } from './types';

interface LessonDocRow extends Record<string, unknown> {
  lesson_id: string;
  structure_json: string;
  beat_count: number;
  prompt_version: string | null;
  created_at: string;
}

export async function saveLessonDocument(
  db: DbDriver,
  lessonId: string,
  document: LessonDocument,
  promptVersion: string,
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO lesson_documents
       (lesson_id, structure_json, beat_count, prompt_version, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [lessonId, JSON.stringify(document), document.beats.length, promptVersion, new Date().toISOString()],
  );
}

export async function getLessonDocument(
  db: DbDriver,
  lessonId: string,
): Promise<LessonDocument | null> {
  const rows = await db.select<LessonDocRow>(
    'SELECT * FROM lesson_documents WHERE lesson_id = $1',
    [lessonId],
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0]!.structure_json) as LessonDocument;
  } catch {
    return null;
  }
}

export async function deleteLessonDocument(db: DbDriver, lessonId: string): Promise<void> {
  await db.execute('DELETE FROM lesson_documents WHERE lesson_id = $1', [lessonId]);
}
