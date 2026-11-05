'use client';

/**
 * One place that turns the local database into a study plan. The dashboard card
 * and the Study tab used to assemble this separately and could disagree.
 */
import {
  ensureStudySettings,
  listAttempts,
  listProgress,
  listQuestions,
  loadLatestRoadmap,
  type CourseStudySettings,
  type DbDriver,
  type ExamQuestion,
} from '@axiom/data';
import {
  buildStudyPlan,
  type PlanAttempt,
  type PlanQuestion,
  type PlanTopic,
  type StudyPlan,
} from '@axiom/engine';

export interface StudyPlanData {
  settings: CourseStudySettings;
  plan: StudyPlan;
  questions: ExamQuestion[];
  topics: { id: string; title: string }[];
}

export async function loadStudyPlan(
  db: DbDriver,
  courseId: string,
  examDate: string | null,
): Promise<StudyPlanData> {
  const [settings, questions, roadmap, progress, attempts, lessons, topicRows] = await Promise.all([
    ensureStudySettings(db, courseId),
    listQuestions(db, courseId),
    loadLatestRoadmap(db, courseId),
    listProgress(db, courseId),
    listAttempts(db, courseId),
    db.select<{ topic_id: string | null; id: string }>(
      `SELECT topic_id, id FROM lessons
       WHERE course_id = $1 AND status = 'active' AND language = 'mixed'
       ORDER BY CASE depth WHEN 'core' THEN 0 ELSE 1 END, created_at DESC`,
      [courseId],
    ),
    db.select<{ id: string; title: string; syllabus_order: number | null }>(
      'SELECT id, title, syllabus_order FROM topics WHERE course_id = $1 ORDER BY COALESCE(syllabus_order, 999999), created_at',
      [courseId],
    ),
  ]);

  const activeLessons = new Map<string, string>();
  for (const row of lessons) {
    if (row.topic_id !== null && !activeLessons.has(row.topic_id)) activeLessons.set(row.topic_id, row.id);
  }
  const progressMap = new Map(progress.map((row) => [row.topicId, row.status]));
  const nodeByTopic = new Map(roadmap?.roadmap.nodes.map((node) => [node.id, node]) ?? []);

  const topics: PlanTopic[] = topicRows.map((row, index) => {
    const node = nodeByTopic.get(row.id);
    const status = progressMap.get(row.id) ?? 'not_started';
    return {
      id: row.id,
      title: row.title,
      weight: node?.weight ?? 0.05,
      order: node?.order ?? row.syllabus_order ?? index,
      type: node?.type ?? 'core',
      progress:
        status === 'known' ? 'known' : status === 'done' ? 'done' : status === 'in_progress' ? 'in_progress' : 'not_started',
      lessonId: activeLessons.get(row.id) ?? null,
    };
  });

  const planQuestions: PlanQuestion[] = questions
    .filter((question) => question.status === 'confirmed')
    .map((question) => ({
      id: question.id,
      topicIds: question.topicIds.length > 0 ? question.topicIds : question.topicId === null ? [] : [question.topicId],
      source: question.source,
      difficulty: question.difficulty,
      year: question.year,
      marks: question.marks,
      status: question.status,
    }));

  const planAttempts: PlanAttempt[] = attempts.map((row) => ({
    questionId: row.questionId,
    topicId: row.topicId,
    itemKind: row.itemKind,
    result: row.result,
    score: row.score,
    completedAt: row.completedAt,
  }));

  const plan = buildStudyPlan({
    profile: settings.profile,
    dailyMinutes: settings.dailyMinutes,
    examDate,
    topics,
    questions: planQuestions,
    attempts: planAttempts,
    now: new Date().toISOString(),
  });

  return {
    settings,
    plan,
    questions,
    topics: topicRows.map((row) => ({ id: row.id, title: row.title })),
  };
}
