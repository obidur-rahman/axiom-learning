'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buildStudyPlan, type PlanAttempt, type PlanQuestion, type PlanTopic, type StudyItem } from '@axiom/engine';
import {
  ensureStudySettings,
  listAttempts,
  listProgress,
  listQuestions,
  loadLatestRoadmap,
} from '@axiom/data';
import { getDb } from '../lib/db';

/**
 * The dashboard's "today" card: the next three deterministic study items for
 * the course closest to its exam. Plan rules live in the engine, not here.
 */
export function TodayPlan({
  courseId,
  courseTitle,
  examDate,
}: {
  courseId: string;
  courseTitle: string;
  examDate: string | null;
}) {
  const [items, setItems] = useState<StudyItem[] | null>(null);
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = await getDb();
      const [settings, questions, roadmap, progress, attempts, lessons, topics] = await Promise.all([
        ensureStudySettings(db.driver, courseId),
        listQuestions(db.driver, courseId),
        loadLatestRoadmap(db.driver, courseId),
        listProgress(db.driver, courseId),
        listAttempts(db.driver, courseId),
        db.driver.select<{ topic_id: string | null; id: string }>(
          "SELECT topic_id, id FROM lessons WHERE course_id = $1 AND status = 'active' AND language = 'mixed' ORDER BY created_at DESC",
          [courseId],
        ),
        db.driver.select<{ id: string; title: string; syllabus_order: number | null }>(
          'SELECT id, title, syllabus_order FROM topics WHERE course_id = $1 ORDER BY COALESCE(syllabus_order, 999999)',
          [courseId],
        ),
      ]);
      if (cancelled) return;
      const activeLessons = new Map<string, string>();
      for (const row of lessons) {
        if (row.topic_id !== null && !activeLessons.has(row.topic_id)) activeLessons.set(row.topic_id, row.id);
      }
      const progressMap = new Map(progress.map((row) => [row.topicId, row.status]));
      const nodeByTopic = new Map(roadmap?.roadmap.nodes.map((node) => [node.id, node]) ?? []);
      const planTopics: PlanTopic[] = topics.map((topic, index) => {
        const node = nodeByTopic.get(topic.id);
        const status = progressMap.get(topic.id) ?? 'not_started';
        return {
          id: topic.id,
          title: topic.title,
          weight: node?.weight ?? 0.05,
          order: node?.order ?? topic.syllabus_order ?? index,
          type: node?.type ?? 'core',
          progress:
            status === 'known' ? 'known' : status === 'done' ? 'done' : status === 'in_progress' ? 'in_progress' : 'not_started',
          lessonId: activeLessons.get(topic.id) ?? null,
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
        topics: planTopics,
        questions: planQuestions,
        attempts: planAttempts,
        now: new Date().toISOString(),
      });
      setItems(plan.items.slice(0, 3));
      setDays(plan.daysUntilExam);
    })().catch(() => setItems([]));
    return () => {
      cancelled = true;
    };
  }, [courseId, examDate]);

  return (
    <section className="card p-5" aria-labelledby="today-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="today-heading" className="section-title">
            Today’s plan
          </h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            {courseTitle}
            {days === null ? '' : ` · ${days === 0 ? 'exam today' : `${days} days to the exam`}`}
          </p>
        </div>
        <Link href={`/course?id=${courseId}&tab=study`} className="btn btn-primary btn-sm">
          Start studying
        </Link>
      </div>
      {items === null ? (
        <div className="mt-3 skeleton h-16 w-full" />
      ) : items.length === 0 ? (
        <p className="mt-3 text-[13px] text-text-muted">
          No study items yet. Open the Study tab to add notes or extract past questions.
        </p>
      ) : (
        <ol className="mt-2">
          {items.map((item) => (
            <li key={item.id} className="row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[12px] text-text-muted">
                    {item.reason} · {item.estimatedMinutes} min
                  </p>
                </div>
                <Link href={`/course?id=${courseId}&tab=study`} className="btn btn-quiet btn-sm shrink-0">
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
