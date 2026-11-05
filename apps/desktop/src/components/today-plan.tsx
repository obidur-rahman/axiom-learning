'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { StudyItem } from '@axiom/engine';
import { getDb } from '../lib/db';
import { loadStudyPlan } from '../lib/study-plan';

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
      const { plan } = await loadStudyPlan(db.driver, courseId, examDate);
      if (cancelled) return;
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
