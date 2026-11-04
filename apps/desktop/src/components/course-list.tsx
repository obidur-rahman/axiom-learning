'use client';

import { useCallback, useEffect, useState } from 'react';
import { getProviderSettings, type Course } from '@axiom/data';
import { getDb, isDesktopRuntime } from '../lib/db';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'browser' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; courses: Course[] };

/**
 * Course list + create (FR-010, FR-011), restyled after the floating-panel
 * reference: one big heading, a quiet subtitle, and courses as a grouped
 * card with count chips. The one main action is "New course".
 */
export function CourseList() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [providerReady, setProviderReady] = useState(false);
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState<'school' | 'university' | 'general'>('university');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setState({ kind: 'browser' });
      return;
    }
    try {
      const db = await getDb();
      const [courses, providerDraft] = await Promise.all([
        db.courses.listCourses(db.driver),
        getProviderSettings(db.driver),
      ]);
      setState({ kind: 'ready', courses });
      setProviderReady(providerDraft !== null);
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const db = await getDb();
      await db.courses.createCourse(db.driver, { title: title.trim(), level });
      setTitle('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [title, level, load]);

  const handleDelete = useCallback(
    async (courseId: string) => {
      const db = await getDb();
      await db.courses.deleteCourse(db.driver, courseId);
      await load();
    },
    [load],
  );

  const courses = state.kind === 'ready' ? state.courses : [];
  const showOnboarding = state.kind === 'ready' && courses.length === 0 && !providerReady;

  return (
    <section className="w-full max-w-3xl">
      <header>
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Courses</h1>
        <p className="mt-1 text-sm text-text-muted">One subject, one goal, one exam.</p>
      </header>

      {showOnboarding && (
        <section className="mt-6 flex flex-col gap-3 rounded-[14px] border border-border bg-panel-raised p-5" aria-label="First-run setup">
          <p className="text-xs tracking-wide text-text-muted uppercase">Set up in two steps</p>
          <ol className="flex flex-col gap-2 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span>
                1. Point the app at a model provider — Ollama/LM Studio are
                auto-detected, or paste any OpenAI-compatible endpoint.
              </span>
              <a
                href="/settings"
                className="chip shrink-0 no-underline hover:text-text"
              >
                Open settings
              </a>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span>2. Create a course below, then add your syllabus and notes in it.</span>
              <span className="chip shrink-0" aria-hidden>
                ↓ Courses
              </span>
            </li>
          </ol>
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleCreate();
          }}
          placeholder="New course title"
          className="min-w-0 flex-1 rounded-[14px] border border-border bg-panel-raised px-4 py-2.5 text-sm outline-none transition-colors duration-200 focus:border-text-muted/60"
        />
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value as typeof level)}
          className="rounded-[14px] border border-border bg-panel-raised px-3 py-2.5 text-sm text-text-muted"
        >
          <option value="school">School</option>
          <option value="university">University</option>
          <option value="general">General</option>
        </select>
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => void handleCreate()}
          className="rounded-[14px] bg-accent px-5 py-2.5 text-sm font-medium text-accent-contrast transition-opacity duration-200 hover:opacity-85 disabled:opacity-40"
        >
          New course
        </button>
      </div>

      <div className="mt-6" aria-live="polite">
        {state.kind === 'loading' && <p className="text-sm text-text-muted">Loading…</p>}
        {state.kind === 'browser' && (
          <p className="rounded-[14px] border border-border bg-panel-raised p-5 text-sm text-text-muted">
            The local database runs inside the desktop app. Start it with
            <code className="mx-1 rounded-md bg-border px-1.5 py-0.5 text-text">npm run tauri dev</code>
            and this screen lists your courses.
          </p>
        )}
        {state.kind === 'error' && (
          <p className="rounded-[14px] border border-danger bg-panel-raised p-5 text-sm">
            {state.message}
          </p>
        )}
        {state.kind === 'ready' && courses.length === 0 && (
          <p className="rounded-[14px] border border-border bg-panel-raised p-5 text-sm text-text-muted">
            No course yet. Add your syllabus, notes, and past questions; Axiom
            builds a roadmap of only the topics that your exam needs.
          </p>
        )}
        {state.kind === 'ready' && courses.length > 0 && (
          <ul className="rounded-[16px] border border-border bg-panel-raised">
            {courses.map((course) => (
              <li
                key={course.id}
                className="group flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <a
                    href={`/course?id=${course.id}`}
                    className="block truncate text-sm font-medium transition-colors duration-200 hover:text-text"
                  >
                    {course.title}
                  </a>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                    <span aria-hidden className="text-[10px]">▣</span>
                    {course.level}
                    {course.examDate !== null && (
                      <span className="chip">exam {course.examDate.slice(0, 10)}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:transition-opacity md:duration-200 md:group-hover:opacity-100">
                  <a
                    href={`/course?id=${course.id}`}
                    className="rounded-full px-3 py-1.5 text-xs text-text-muted transition-colors duration-200 hover:bg-surface hover:text-text"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleDelete(course.id)}
                    className="rounded-full px-3 py-1.5 text-xs text-danger transition-colors duration-200 hover:bg-surface"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
