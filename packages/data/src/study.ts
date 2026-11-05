import type { DbDriver } from './driver';
import type {
  AttemptResult,
  CourseStudySettings,
  StudyAttempt,
  StudyItemKindDb,
  StudyProfile,
} from './types';

function uuid(): string {
  return crypto.randomUUID();
}

interface SettingsRow extends Record<string, unknown> {
  course_id: string;
  profile: string;
  daily_minutes: number;
  has_past_papers: number;
  plan_version: number;
  updated_at: string;
}

interface AttemptRow extends Record<string, unknown> {
  id: string;
  course_id: string;
  item_kind: string;
  question_id: string | null;
  topic_id: string | null;
  lesson_id: string | null;
  result: string | null;
  score: number | null;
  max_score: number | null;
  confidence: number | null;
  duration_seconds: number | null;
  meta: string | null;
  started_at: string | null;
  completed_at: string;
}

function settingsFromRow(row: SettingsRow): CourseStudySettings {
  return {
    courseId: row.course_id,
    profile: row.profile as StudyProfile,
    dailyMinutes: row.daily_minutes,
    hasPastPapers: !!row.has_past_papers,
    planVersion: row.plan_version,
    updatedAt: row.updated_at,
  };
}

function attemptFromRow(row: AttemptRow): StudyAttempt {
  return {
    id: row.id,
    courseId: row.course_id,
    itemKind: row.item_kind as StudyItemKindDb,
    questionId: row.question_id,
    topicId: row.topic_id,
    lessonId: row.lesson_id,
    result: row.result as AttemptResult | null,
    score: row.score,
    maxScore: row.max_score,
    confidence: row.confidence,
    durationSeconds: row.duration_seconds,
    meta: row.meta ? (JSON.parse(row.meta) as unknown) : null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export async function getStudySettings(
  db: DbDriver,
  courseId: string,
): Promise<CourseStudySettings | null> {
  const rows = await db.select<SettingsRow>(
    'SELECT * FROM course_study_settings WHERE course_id = $1',
    [courseId],
  );
  return rows.length === 0 ? null : settingsFromRow(rows[0]!);
}

/**
 * Reads the course settings, creating defaults on first use. Past-paper
 * presence is inferred only for the initial default; the learner can change it.
 */
export async function ensureStudySettings(
  db: DbDriver,
  courseId: string,
): Promise<CourseStudySettings> {
  const existing = await getStudySettings(db, courseId);
  if (existing !== null) return existing;
  const pastCount = await db.select<{ c: number }>(
    "SELECT COUNT(*) AS c FROM materials WHERE course_id = $1 AND kind = 'past_questions'",
    [courseId],
  );
  const settings: CourseStudySettings = {
    courseId,
    profile: 'adaptive',
    dailyMinutes: 45,
    hasPastPapers: (pastCount[0]?.c ?? 0) > 0,
    planVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  await db.execute(
    `INSERT INTO course_study_settings
       (course_id, profile, daily_minutes, has_past_papers, plan_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      settings.courseId,
      settings.profile,
      settings.dailyMinutes,
      settings.hasPastPapers ? 1 : 0,
      settings.planVersion,
      settings.updatedAt,
      settings.updatedAt,
    ],
  );
  return settings;
}

export async function saveStudySettings(
  db: DbDriver,
  courseId: string,
  patch: Partial<Pick<CourseStudySettings, 'profile' | 'dailyMinutes' | 'hasPastPapers'>>,
): Promise<CourseStudySettings> {
  const current = await ensureStudySettings(db, courseId);
  const requestedMinutes = patch.dailyMinutes ?? current.dailyMinutes;
  const next = {
    ...current,
    ...patch,
    dailyMinutes: Number.isFinite(requestedMinutes)
      ? Math.min(240, Math.max(15, Math.round(requestedMinutes)))
      : current.dailyMinutes,
    planVersion: current.planVersion + 1,
    updatedAt: new Date().toISOString(),
  };
  await db.execute(
    `UPDATE course_study_settings
     SET profile = $1, daily_minutes = $2, has_past_papers = $3,
         plan_version = $4, updated_at = $5
     WHERE course_id = $6`,
    [
      next.profile,
      next.dailyMinutes,
      next.hasPastPapers ? 1 : 0,
      next.planVersion,
      next.updatedAt,
      courseId,
    ],
  );
  return next;
}

export async function bumpPlanVersion(db: DbDriver, courseId: string): Promise<void> {
  await db.execute(
    `UPDATE course_study_settings SET plan_version = plan_version + 1, updated_at = $1
     WHERE course_id = $2`,
    [new Date().toISOString(), courseId],
  );
}

export async function listAttempts(
  db: DbDriver,
  courseId: string,
  limit = 500,
): Promise<StudyAttempt[]> {
  const rows = await db.select<AttemptRow>(
    'SELECT * FROM study_attempts WHERE course_id = $1 ORDER BY completed_at DESC LIMIT $2',
    [courseId, limit],
  );
  return rows.map(attemptFromRow);
}

export async function saveAttempt(
  db: DbDriver,
  attempt: Omit<StudyAttempt, 'id' | 'completedAt'> & { id?: string; completedAt?: string },
): Promise<StudyAttempt> {
  const saved: StudyAttempt = {
    ...attempt,
    id: attempt.id ?? uuid(),
    completedAt: attempt.completedAt ?? new Date().toISOString(),
  };
  await db.execute(
    `INSERT INTO study_attempts
       (id, course_id, item_kind, question_id, topic_id, lesson_id, result, score,
        max_score, confidence, duration_seconds, meta, started_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      saved.id,
      saved.courseId,
      saved.itemKind,
      saved.questionId,
      saved.topicId,
      saved.lessonId,
      saved.result,
      saved.score,
      saved.maxScore,
      saved.confidence,
      saved.durationSeconds,
      saved.meta === null ? null : JSON.stringify(saved.meta),
      saved.startedAt,
      saved.completedAt,
    ],
  );
  return saved;
}
