'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getCourse, type Course } from '@axiom/data';
import { UploadPanel } from './upload-panel';
import { TopicsPanel } from './topics-panel';
import { RoadmapPanel } from './roadmap-panel';
import { LessonsPanel } from './lessons-panel';
import { TutorPanel } from './tutor-panel';
import { PracticePanel } from './practice-panel';
import { ProgressPanel } from './progress-panel';
import { getDb, isDesktopRuntime } from '../lib/db';
import { startWorker, stopWorker } from '../lib/worker';

type TabKind = 'material' | 'topics' | 'roadmap' | 'lessons' | 'tutor' | 'practice' | 'progress';

const TABS: { kind: TabKind; label: string }[] = [
  { kind: 'material', label: 'Material' },
  { kind: 'topics', label: 'Topics & scope' },
  { kind: 'roadmap', label: 'Roadmap' },
  { kind: 'lessons', label: 'Lessons' },
  { kind: 'tutor', label: 'Tutor' },
  { kind: 'practice', label: 'Practice' },
  { kind: 'progress', label: 'Progress' },
];

export function CourseScreen() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-text-muted">Loading course...</p>}>
      <CourseTabs />
    </Suspense>
  );
}

function CourseTabs() {
  const params = useSearchParams();
  const courseId = params.get('id') ?? '';
  const [course, setCourse] = useState<Course | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<TabKind>(() => {
    const requested = params.get('tab');
    return TABS.some((entry) => entry.kind === requested) ? (requested as TabKind) : 'material';
  });

  const load = useCallback(async () => {
    if (courseId === '') {
      setMissing(true);
      return;
    }
    const db = await getDb();
    const loaded = await getCourse(db.driver, courseId);
    if (loaded === null) setMissing(true);
    else setCourse(loaded);
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // One worker instance serves the whole webview.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    startWorker();
    return () => stopWorker();
  }, []);

  if (missing) {
    return (
      <main className="panel mx-auto w-full max-w-2xl p-8">
        <p className="text-sm text-text-muted">Course not found.</p>
        <a href="/" className="mt-3 inline-block text-xs tracking-wide text-text-muted uppercase no-underline hover:text-text">
          Back to courses
        </a>
      </main>
    );
  }
  if (course === null) {
    return (
      <main className="panel mx-auto w-full max-w-3xl p-10 text-sm text-text-muted">Loading course...</main>
    );
  }

  return (
    <main className="panel mx-auto w-full max-w-3xl p-6 md:p-10">
      <a href="/" className="text-xs tracking-wide text-text-muted uppercase no-underline hover:text-text">
        &larr; Courses
      </a>
      <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-tight">{course.title}</h1>

      <nav className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-b border-border pb-2" aria-label="Course sections">
        {TABS.map((entry) => (
          <button
            key={entry.kind}
            onClick={() => setTab(entry.kind)}
            aria-current={tab === entry.kind ? 'page' : undefined}
            className={
              tab === entry.kind
                ? 'border-b-2 border-text pb-2 -mb-2.5 text-sm font-medium text-text'
                : '-mb-2.5 border-b-2 border-transparent pb-2 text-sm text-text-muted transition-colors duration-200 hover:text-text'
            }
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'material' && <UploadPanel courseId={courseId} />}
        {tab === 'topics' && <TopicsPanel courseId={courseId} />}
        {tab === 'roadmap' && <RoadmapPanel courseId={courseId} />}
        {tab === 'lessons' && <LessonsPanel courseId={courseId} />}
        {tab === 'tutor' && <TutorPanel courseId={courseId} />}
        {tab === 'practice' && <PracticePanel courseId={courseId} />}
        {tab === 'progress' && <ProgressPanel courseId={courseId} />}
      </div>
    </main>
  );
}
