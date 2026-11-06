'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCourse, resetCourse, type Course } from '@axiom/data';
import { UploadPanel } from './upload-panel';
import { StudyPanel } from './study-panel';
import { TopicsPanel } from './topics-panel';
import { RoadmapPanel } from './roadmap-panel';
import { LessonsPanel } from './lessons-panel';
import { TutorPanel } from './tutor-panel';
import { PracticePanel } from './practice-panel';
import { ProgressPanel } from './progress-panel';
import { getDb } from '../lib/db';
import { cancelRunningJob, runningJobId } from '../lib/job-control';
import { loadPrefs, type CourseTab } from '../lib/prefs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const TABS: { kind: CourseTab; label: string; hint: string }[] = [
  { kind: 'material', label: 'Material', hint: 'Upload and read the syllabus, notes and past papers' },
  { kind: 'study', label: 'Study', hint: 'Today’s plan, the question ladder and question coverage' },
  { kind: 'topics', label: 'Topics & scope', hint: 'Edit topics and what the exam covers' },
  { kind: 'roadmap', label: 'Roadmap', hint: 'The pruned dependency graph and study order' },
  { kind: 'lessons', label: 'Lessons', hint: 'Read a lesson with citations and check questions' },
  { kind: 'tutor', label: 'Tutor', hint: 'Ask questions grounded in your material' },
  { kind: 'practice', label: 'Practice', hint: 'Multiple choice and a scored written answer' },
  { kind: 'progress', label: 'Progress', hint: 'Study plan, status and exam date' },
];

export function CourseScreen() {
  return (
    <Suspense
      fallback={
        <div className="card p-8" aria-live="polite">
          <div className="skeleton h-6 w-56" />
          <div className="skeleton mt-3 h-3 w-32" />
        </div>
      }
    >
      <CourseTabs />
    </Suspense>
  );
}

function CourseTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const courseId = params.get('id') ?? '';
  const [course, setCourse] = useState<Course | null>(null);
  const [missing, setMissing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [tab, setTab] = useState<CourseTab>(() => {
    const requested = params.get('tab');
    return TABS.some((entry) => entry.kind === requested) ? (requested as CourseTab) : 'material';
  });

  // The URL is the source of truth: links from Study, dashboard and lessons
  // must land on the tab they name, even when this screen is already open.
  useEffect(() => {
    const requested = params.get('tab');
    if (requested !== null) {
      if (requested !== tab && TABS.some((entry) => entry.kind === requested)) {
        setTab(requested as CourseTab);
      }
      return;
    }
    const preferred = loadPrefs().defaultCourseTab;
    if (tab === 'material' && TABS.some((entry) => entry.kind === preferred)) setTab(preferred);
  }, [params, tab]);

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

  /**
   * Wipes the course's material and everything generated from it, but keeps
   * the course row itself. The worker is stopped first if it is working on
   * this course, otherwise it could finish a step against deleted rows.
   */
  const handleReset = useCallback(async () => {
    if (resetting) return;
    const confirmed = window.confirm(
      `Reset "${course?.title ?? 'this course'}"?\n\n` +
        'Every material, page, topic, roadmap, lesson, practice question, attempt and progress record ' +
        'in this course will be deleted. The course itself stays, with its title, exam date and study settings.\n\n' +
        'This cannot be undone.',
    );
    if (!confirmed) return;
    setResetting(true);
    setResetError('');
    try {
      const db = await getDb();
      const running = runningJobId();
      if (running !== null) {
        const rows = await db.driver.select<{ course_id: string | null }>(
          'SELECT course_id FROM jobs WHERE id = $1',
          [running],
        );
        if (rows[0]?.course_id === courseId) cancelRunningJob(running);
      }
      await resetCourse(db.driver, courseId);
      // A full navigation, not a tab switch: every tab keeps mounted state and
      // must not keep showing material that no longer exists.
      window.location.assign(`/course?id=${courseId}&tab=material`);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error));
      setResetting(false);
    }
  }, [course?.title, courseId, resetting]);

  if (missing) {
    return (
      <div className="card mx-auto w-full max-w-2xl p-8">
        <p className="text-sm text-text-muted">Course not found.</p>
        <a href="/courses" className="btn btn-ghost btn-sm mt-3">
          Back to courses
        </a>
      </div>
    );
  }
  if (course === null) {
    return (
      <div className="card w-full p-8" aria-live="polite">
        <div className="skeleton h-6 w-56" />
        <div className="skeleton mt-3 h-3 w-32" />
      </div>
    );
  }

  const active = TABS.find((entry) => entry.kind === tab) ?? TABS[0]!;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href="/courses"
          className="text-[11.5px] uppercase tracking-[0.12em] text-text-muted no-underline hover:text-text"
        >
          ← All courses
        </a>
        <p className="chip">{active.hint}</p>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Level, language and status were settled when the course was
              created; repeating them here tells the learner nothing new. The
              exam date stays because it is a deadline, not a setting. */}
          <h1 className="page-title">{course.title}</h1>
          {course.examDate !== null && (
            <p className="mt-2">
              <span className="chip">Exam {course.examDate.slice(0, 10)}</span>
            </p>
          )}
          {resetError !== '' && (
            <p className="mt-2 text-sm text-danger" role="alert">{resetError}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleReset()}
          disabled={resetting}
          aria-busy={resetting}
          className="btn btn-danger btn-sm shrink-0"
          title="Delete this course's material, roadmap, lessons, practice and progress. The course itself stays."
        >
          {resetting ? 'Resetting...' : 'Reset course'}
        </button>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = value as CourseTab;
          setTab(next);
          // Keep the URL in step with the visible tab, so a later link to this
          // screen can always tell which tab it is coming from.
          const query = new URLSearchParams(params.toString());
          query.set('tab', next);
          router.replace(`/course?${query.toString()}`, { scroll: false });
        }}
      >
        <TabsList aria-label="Course sections" className="w-full justify-start overflow-x-auto">
          {TABS.map((entry) => (
            <TabsTrigger key={entry.kind} value={entry.kind} className="flex-none px-3.5 text-[13px]">
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* keepMounted: a running lesson, a tutor thread and a practice set
            survive a trip to another tab and come back exactly as they were.
            No card wrapper: the section belongs to the page after the tab bar,
            and nesting it inside another panel put every list two levels in. */}
        <TabsContent value="material" keepMounted className="mt-4">
          <UploadPanel courseId={courseId} />
        </TabsContent>
        <TabsContent value="study" keepMounted className="mt-4">
          <StudyPanel courseId={courseId} examDate={course.examDate} />
        </TabsContent>
        <TabsContent value="topics" keepMounted className="mt-4">
          <TopicsPanel courseId={courseId} />
        </TabsContent>
        <TabsContent value="roadmap" keepMounted className="mt-4">
          <RoadmapPanel courseId={courseId} />
        </TabsContent>
        <TabsContent value="lessons" keepMounted className="mt-4">
          <LessonsPanel courseId={courseId} />
        </TabsContent>
        <TabsContent value="tutor" keepMounted className="mt-4">
          <TutorPanel courseId={courseId} />
        </TabsContent>
        <TabsContent value="practice" keepMounted className="mt-4">
          <PracticePanel courseId={courseId} />
        </TabsContent>
        <TabsContent value="progress" keepMounted className="mt-4">
          <ProgressPanel courseId={courseId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
