'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCourse, type Course } from '@axiom/data';
import { UploadPanel } from './upload-panel';
import { StudyPanel } from './study-panel';
import { TopicsPanel } from './topics-panel';
import { RoadmapPanel } from './roadmap-panel';
import { LessonsPanel } from './lessons-panel';
import { TutorPanel } from './tutor-panel';
import { PracticePanel } from './practice-panel';
import { ProgressPanel } from './progress-panel';
import { getDb } from '../lib/db';
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

      <header>
        <h1 className="page-title">{course.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-1">
          <span className="chip">{course.level}</span>
          <span className="chip">
            {course.language === 'mixed' ? 'Bangla + English' : course.language === 'bn' ? 'Bangla' : 'English'}
          </span>
          <span className="chip">{course.status}</span>
          {course.examDate !== null && (
            <span className="chip">Exam {course.examDate.slice(0, 10)}</span>
          )}
        </p>
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
            survive a trip to another tab and come back exactly as they were. */}
        <TabsContent value="material" keepMounted className="mt-3">
          <div className="card p-5"><UploadPanel courseId={courseId} /></div>
        </TabsContent>
        <TabsContent value="study" keepMounted className="mt-3">
          <div className="card p-4 sm:p-5"><StudyPanel courseId={courseId} examDate={course.examDate} /></div>
        </TabsContent>
        <TabsContent value="topics" keepMounted className="mt-3">
          <div className="card p-5"><TopicsPanel courseId={courseId} /></div>
        </TabsContent>
        <TabsContent value="roadmap" keepMounted className="mt-3">
          <div className="card p-5"><RoadmapPanel courseId={courseId} /></div>
        </TabsContent>
        <TabsContent value="lessons" keepMounted className="mt-3">
          <div className="card p-4 sm:p-5"><LessonsPanel courseId={courseId} /></div>
        </TabsContent>
        <TabsContent value="tutor" keepMounted className="mt-3">
          <div className="card p-5"><TutorPanel courseId={courseId} /></div>
        </TabsContent>
        <TabsContent value="practice" keepMounted className="mt-3">
          <div className="card p-5"><PracticePanel courseId={courseId} /></div>
        </TabsContent>
        <TabsContent value="progress" keepMounted className="mt-3">
          <div className="card p-5"><ProgressPanel courseId={courseId} /></div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
