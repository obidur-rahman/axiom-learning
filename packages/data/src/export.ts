import type { DbDriver } from './driver';
import { loadLatestRoadmap } from './roadmaps';

/**
 * Course export (offline portability): one JSON snapshot of everything the
 * learner has read, been taught, or fixed by hand - the part that must never
 * be lost if they reinstall. Server sync stays out of scope; this is the
 * field-recovery format.
 */
export async function exportCourse(
  db: DbDriver,
  courseId: string,
): Promise<Record<string, unknown>> {
  const [course, materials, topics, weights, scopeRules, roadmap, progressRows, lessonRows, reports] = await Promise.all([
    db.select<Record<string, unknown>>('SELECT * FROM courses WHERE id = $1', [courseId]),
    db.select<Record<string, unknown>>(
      'SELECT * FROM materials WHERE course_id = $1',
      [courseId],
    ),
    db.select<Record<string, unknown>>('SELECT * FROM topics WHERE course_id = $1', [courseId]),
    db.select<Record<string, unknown>>(
      'SELECT w.* FROM topic_weights w JOIN topics t ON t.id = w.topic_id WHERE t.course_id = $1',
      [courseId],
    ),
    db.select<Record<string, unknown>>(
      'SELECT * FROM exam_scope_rules WHERE course_id = $1',
      [courseId],
    ),
    loadLatestRoadmap(db, courseId),
    db.select<Record<string, unknown>>(
      `SELECT u.* FROM user_progress u
       JOIN topics t ON t.id = u.topic_id WHERE t.course_id = $1`,
      [courseId],
    ),
    db.select<Record<string, unknown>>(
      `SELECT l.* FROM lessons l
       JOIN topics t ON t.id = l.topic_id
       WHERE t.course_id = $1 AND l.scope = 'course'`,
      [courseId],
    ),
    db.select<Record<string, unknown>>(
      `SELECT r.* FROM lesson_reports r
       JOIN topics t ON t.id = r.topic_id WHERE t.course_id = $1`,
      [courseId],
    ),
  ]);
  const pages = await db.select<Record<string, unknown>>(
    `SELECT page_number, text, extraction_method, confidence, low_confidence
     FROM material_pages p JOIN materials m ON m.id = p.material_id
     WHERE m.course_id = $1 ORDER BY p.material_id, p.page_number`,
    [courseId],
  );
  const edges = await db.select<Record<string, unknown>>(
    'SELECT * FROM topic_edges WHERE course_id = $1',
    [courseId],
  );
  const [studySettings, questions, questionTopics, attempts, lessonDocuments] = await Promise.all([
    db.select<Record<string, unknown>>(
      'SELECT * FROM course_study_settings WHERE course_id = $1',
      [courseId],
    ),
    db.select<Record<string, unknown>>(
      'SELECT * FROM exam_questions WHERE course_id = $1 ORDER BY year DESC, question_number',
      [courseId],
    ),
    db.select<Record<string, unknown>>(
      `SELECT q.* FROM exam_question_topics q
       JOIN exam_questions e ON e.id = q.question_id WHERE e.course_id = $1`,
      [courseId],
    ),
    db.select<Record<string, unknown>>(
      'SELECT * FROM study_attempts WHERE course_id = $1 ORDER BY completed_at DESC',
      [courseId],
    ),
    db.select<Record<string, unknown>>(
      `SELECT d.* FROM lesson_documents d
       JOIN lessons l ON l.id = d.lesson_id WHERE l.course_id = $1`,
      [courseId],
    ),
  ]);
  return {
    format: 'axiom-course-export/2',
    exportedAt: new Date().toISOString(),
    course: course[0] ?? null,
    materials,
    pages,
    topics,
    weights,
    examScopeRules: scopeRules,
    edges,
    roadmap,
    progress: progressRows,
    lessons: lessonRows,
    lessonReports: reports,
    studySettings,
    questions,
    questionTopics,
    attempts,
    lessonDocuments,
  };
}
