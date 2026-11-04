import type { DbDriver } from './driver';
import type { ProgressStatus } from './types';

export async function setProgress(
  db: DbDriver,
  courseId: string,
  topicId: string,
  status: ProgressStatus,
): Promise<void> {
  const completedAt = status === 'done' || status === 'known' ? new Date().toISOString() : null;
  await db.execute(
    `REPLACE INTO user_progress (course_id, topic_id, status, completed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [courseId, topicId, status, completedAt, new Date().toISOString()],
  );
}

export async function listProgress(
  db: DbDriver,
  courseId: string,
): Promise<{ topicId: string; status: ProgressStatus }[]> {
  const rows = await db.select<{ topic_id: string; status: string }>(
    'SELECT topic_id, status FROM user_progress WHERE course_id = $1',
    [courseId],
  );
  return rows.map((row) => ({
    topicId: row.topic_id,
    status: row.status as ProgressStatus,
  }));
}

/** Known topic ids (TRD 6 input K comes from here + server sync later). */
export async function getKnownTopicIds(
  db: DbDriver,
  courseId: string,
): Promise<string[]> {
  const rows = await db.select<{ topic_id: string }>(
    "SELECT topic_id FROM user_progress WHERE course_id = $1 AND status = 'known'",
    [courseId],
  );
  return rows.map((row) => row.topic_id);
}
