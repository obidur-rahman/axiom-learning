import type { DbDriver } from './driver';
import type { Course, CourseDraft } from './types';

function uuid(): string {
  return crypto.randomUUID();
}

export function rowToCourse(row: Record<string, unknown>): Course {
  return {
    id: row.id as string,
    title: row.title as string,
    level: row.level as Course['level'],
    language: row.language as Course['language'],
    examDate: (row.exam_date as string | null) ?? null,
    isPremade: !!row.is_premade,
    clonedFrom: (row.cloned_from as string | null) ?? null,
    bridgeDepth: row.bridge_depth as number,
    status: row.status as Course['status'],
    createdAt: row.created_at as string,
  };
}

export async function createCourse(
  db: DbDriver,
  draft: CourseDraft,
): Promise<Course> {
  const course: Course = {
    id: uuid(),
    title: draft.title,
    level: draft.level ?? 'university',
    language: draft.language ?? 'en',
    examDate: draft.examDate ?? null,
    isPremade: false,
    clonedFrom: null,
    bridgeDepth:
      draft.bridgeDepth === undefined
        ? 2
        : Math.min(4, Math.max(0, Math.round(draft.bridgeDepth))),
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
  await db.execute(
    `INSERT INTO courses (id, title, level, language, exam_date, is_premade,
       cloned_from, bridge_depth, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      course.id,
      course.title,
      course.level,
      course.language,
      course.examDate,
      0,
      course.clonedFrom,
      course.bridgeDepth,
      course.status,
      course.createdAt,
    ],
  );
  return course;
}

export async function listCourses(db: DbDriver): Promise<Course[]> {
  const rows = await db.select(
    'SELECT * FROM courses ORDER BY created_at DESC',
  );
  return rows.map(rowToCourse);
}

export async function getCourse(db: DbDriver, courseId: string): Promise<Course | null> {
  const rows = await db.select('SELECT * FROM courses WHERE id = $1', [courseId]);
  return rows.length > 0 ? rowToCourse(rows[0]!) : null;
}

export async function updateCourse(
  db: DbDriver,
  courseId: string,
  patch: Partial<Pick<Course, 'title' | 'level' | 'language' | 'examDate' | 'bridgeDepth' | 'status'>>,
): Promise<void> {
  if (patch.bridgeDepth !== undefined) {
    await db.execute('UPDATE courses SET bridge_depth = $1 WHERE id = $2', [
      patch.bridgeDepth,
      courseId,
    ]);
  }
  if (patch.status !== undefined) {
    await db.execute('UPDATE courses SET status = $1 WHERE id = $2', [
      patch.status,
      courseId,
    ]);
  }
  if (patch.title !== undefined) {
    await db.execute('UPDATE courses SET title = $1 WHERE id = $2', [
      patch.title,
      courseId,
    ]);
  }
  if (patch.level !== undefined) {
    await db.execute('UPDATE courses SET level = $1 WHERE id = $2', [patch.level, courseId]);
  }
  if (patch.language !== undefined) {
    await db.execute('UPDATE courses SET language = $1 WHERE id = $2', [
      patch.language,
      courseId,
    ]);
  }
  if (patch.examDate !== undefined) {
    await db.execute('UPDATE courses SET exam_date = $1 WHERE id = $2', [
      patch.examDate,
      courseId,
    ]);
  }
}

/** Deletes the course; SQLite cascades to materials, topics, roadmaps, etc. */
export async function deleteCourse(db: DbDriver, courseId: string): Promise<void> {
  await db.execute('DELETE FROM courses WHERE id = $1', [courseId]);
}

/**
 * Clears everything a course produced, but keeps the course itself: material
 * files and pages, topics, weights and edges, roadmaps, lessons, questions,
 * attempts, progress and queued jobs. Title, level, language, exam date and
 * the learner's study profile/daily minutes survive, so a reset course is
 * ready for a fresh upload.
 *
 * Children are deleted explicitly (not only through cascades) so the reset
 * also works on a connection where SQLite foreign keys are off.
 */
export async function resetCourse(db: DbDriver, courseId: string): Promise<void> {
  // Any lesson that belongs to this course, directly or through one of its
  // topics. The topic arm matters for a shared lesson linked to a topic.
  const courseLessons = `SELECT id FROM lessons WHERE course_id = $1
     OR topic_id IN (SELECT id FROM topics WHERE course_id = $1)`;

  const statements: [sql: string, params: unknown[]][] = [
    ['DELETE FROM jobs WHERE course_id = $1', [courseId]],
    ['DELETE FROM study_attempts WHERE course_id = $1', [courseId]],
    [
      `DELETE FROM exam_question_topics WHERE question_id IN
         (SELECT id FROM exam_questions WHERE course_id = $1)`,
      [courseId],
    ],
    ['DELETE FROM exam_questions WHERE course_id = $1', [courseId]],
    [`DELETE FROM lesson_documents WHERE lesson_id IN (${courseLessons})`, [courseId]],
    [`DELETE FROM lesson_reports WHERE lesson_id IN (${courseLessons})`, [courseId]],
    [
      `DELETE FROM lessons WHERE course_id = $1
         OR topic_id IN (SELECT id FROM topics WHERE course_id = $1)`,
      [courseId],
    ],
    ['DELETE FROM user_progress WHERE course_id = $1', [courseId]],
    ['DELETE FROM node_overrides WHERE course_id = $1', [courseId]],
    [
      `DELETE FROM roadmap_nodes WHERE roadmap_version_id IN
         (SELECT id FROM roadmap_versions WHERE course_id = $1)`,
      [courseId],
    ],
    ['DELETE FROM roadmap_versions WHERE course_id = $1', [courseId]],
    ['DELETE FROM exam_scope_rules WHERE course_id = $1', [courseId]],
    ['DELETE FROM topic_edges WHERE course_id = $1', [courseId]],
    ['DELETE FROM topic_weights WHERE course_id = $1', [courseId]],
    ['DELETE FROM topics WHERE course_id = $1', [courseId]],
    [
      `DELETE FROM material_embeddings WHERE material_id IN
         (SELECT id FROM materials WHERE course_id = $1)`,
      [courseId],
    ],
    [
      `DELETE FROM material_pages WHERE material_id IN
         (SELECT id FROM materials WHERE course_id = $1)`,
      [courseId],
    ],
    ['DELETE FROM materials WHERE course_id = $1', [courseId]],
  ];

  for (const [sql, params] of statements) {
    await db.execute(sql, params);
  }

  await db.execute("UPDATE courses SET status = 'draft' WHERE id = $1", [courseId]);
  // The learner keeps their study profile and daily time, but past papers are
  // gone with the material; the plan version advances so it is rebuilt.
  await db.execute(
    `UPDATE course_study_settings
     SET has_past_papers = 0, plan_version = plan_version + 1, updated_at = $2
     WHERE course_id = $1`,
    [courseId, new Date().toISOString()],
  );
}
