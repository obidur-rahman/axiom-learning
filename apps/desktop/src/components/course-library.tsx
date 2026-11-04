'use client';

/**
 * Course library: every course as a card with its real progress, material
 * count and exam date. Create, search, open and remove courses here.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  createCourse,
  deleteCourse,
  courseSummaries,
  type CourseLevel,
  type CourseSummary,
  type CourseLanguage,
} from '@axiom/data';
import { getDb, isDesktopRuntime } from '../lib/db';
import { usePrefs } from '../lib/prefs';
import { ProgressBar } from './progress-bar';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'browser' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; summaries: CourseSummary[] };

const LEVEL_LABEL: Record<CourseLevel, string> = {
  school: 'School',
  university: 'University',
  general: 'General',
};

const LANGUAGE_LABEL: Record<CourseLanguage, string> = {
  en: 'English',
  bn: 'Bangla',
  mixed: 'Bangla + English',
};

export function CourseLibrary() {
  const router = useRouter();
  const prefs = usePrefs();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState<CourseLevel>('university');
  const [language, setLanguage] = useState<CourseLanguage>(prefs.language);
  const [examDate, setExamDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setState({ kind: 'browser' });
      return;
    }
    try {
      const db = await getDb();
      setState({ kind: 'ready', summaries: await courseSummaries(db.driver) });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(async () => {
    if (title.trim() === '' || busy) return;
    setBusy(true);
    setFormError('');
    try {
      const db = await getDb();
      const course = await createCourse(db.driver, {
        title: title.trim(),
        level,
        language,
        examDate: examDate === '' ? null : examDate,
        bridgeDepth: prefs.defaultBridgeDepth,
      });
      setTitle('');
      setExamDate('');
      setFormOpen(false);
      router.push(`/course?id=${course.id}&tab=material`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [title, level, language, examDate, busy, router, prefs.defaultBridgeDepth]);

  const handleDelete = useCallback(
    async (summary: CourseSummary) => {
      if (prefs.confirmDelete) {
        const confirmed = window.confirm(
          `Delete "${summary.course.title}"? Its material, roadmap, lessons and progress are removed from this device.`,
        );
        if (!confirmed) return;
      }
      const db = await getDb();
      await deleteCourse(db.driver, summary.course.id);
      await load();
    },
    [load, prefs.confirmDelete],
  );

  const summaries = state.kind === 'ready' ? state.summaries : [];
  const needle = query.trim().toLowerCase();
  const visible = needle === '' ? summaries : summaries.filter((entry) => entry.course.title.toLowerCase().includes(needle));
  const empty = state.kind === 'ready' && summaries.length === 0;
  const showForm = formOpen || empty;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Courses</h1>
          <p className="page-sub">
            {empty
              ? 'One subject, one goal, one exam.'
              : `${summaries.length} course${summaries.length === 1 ? '' : 's'} on this device.`}
          </p>
        </div>
        {state.kind === 'ready' && !empty && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setFormOpen((open) => !open)}
            aria-expanded={showForm}
          >
            {formOpen ? 'Close form' : 'New course'}
          </button>
        )}
      </header>

      {state.kind === 'loading' && (
        <div className="grid gap-3 md:grid-cols-2" aria-live="polite">
          {[0, 1].map((key) => (
            <div key={key} className="card p-5">
              <div className="skeleton h-5 w-40" />
              <div className="skeleton mt-3 h-3 w-24" />
              <div className="skeleton mt-4 h-2 w-full" />
            </div>
          ))}
        </div>
      )}

      {state.kind === 'browser' && (
        <div className="card p-5 text-sm text-text-muted">
          Courses live in the desktop app&apos;s local database. Run{' '}
          <code className="rounded-md bg-surface px-1.5 py-0.5 text-text">npm run tauri dev</code>{' '}
          to use the library.
        </div>
      )}

      {state.kind === 'error' && (
        <div className="card border-danger/50 p-5 text-sm">
          <p className="text-danger">{state.message}</p>
          <button type="button" onClick={() => void load()} className="btn btn-ghost btn-sm mt-3">
            Try again
          </button>
        </div>
      )}

      {showForm && (
        <section id="new" className="card anchor-target p-5" aria-labelledby="new-course-heading">
          <h2 id="new-course-heading" className="section-title">
            New course
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            You can change all of this later. The exam date powers the countdown.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="field sm:col-span-2">
              Course title
              <input
                value={title}
                autoFocus={formOpen}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreate();
                }}
                placeholder="e.g. Introduction to Cell Biology"
                className="input"
              />
            </label>
            <label className="field">
              Level
              <select value={level} onChange={(event) => setLevel(event.target.value as CourseLevel)} className="input">
                {(Object.keys(LEVEL_LABEL) as CourseLevel[]).map((value) => (
                  <option key={value} value={value}>
                    {LEVEL_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Language
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as CourseLanguage)}
                className="input"
              >
                {(Object.keys(LANGUAGE_LABEL) as CourseLanguage[]).map((value) => (
                  <option key={value} value={value}>
                    {LANGUAGE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Exam date (optional)
              <input
                type="date"
                value={examDate}
                onChange={(event) => setExamDate(event.target.value)}
                className="input"
              />
            </label>
            <div className="flex items-end justify-end gap-2">
              {!empty && (
                <button type="button" className="btn btn-quiet" onClick={() => setFormOpen(false)}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || title.trim() === ''}
                onClick={() => void handleCreate()}
              >
                {busy ? 'Creating...' : 'Create and add material'}
              </button>
            </div>
          </div>
          {formError !== '' && <p className="mt-2 text-sm text-danger">{formError}</p>}
        </section>
      )}

      {state.kind === 'ready' && summaries.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search courses..."
              className="input max-w-xs"
              aria-label="Search courses"
            />
            {needle !== '' && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setQuery('')}>
                Clear
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="card p-5 text-sm text-text-muted">
              No course matches “{query.trim()}”.
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {visible.map((entry) => {
                const percent = entry.planned === 0 ? 0 : Math.round((entry.finished / entry.planned) * 100);
                return (
                  <li key={entry.course.id} className="card flex flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/course?id=${entry.course.id}`}
                          className="block truncate text-[16.5px] font-semibold tracking-tight no-underline hover:underline"
                        >
                          {entry.course.title}
                        </Link>
                        <p className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="chip">{LEVEL_LABEL[entry.course.level]}</span>
                          <span className="chip">{LANGUAGE_LABEL[entry.course.language]}</span>
                          <span className="chip">{entry.course.status}</span>
                          {entry.course.examDate !== null && (
                            <span className="chip">Exam {entry.course.examDate.slice(0, 10)}</span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry)}
                        className="btn btn-danger btn-sm shrink-0"
                        aria-label={`Delete ${entry.course.title}`}
                      >
                        Delete
                      </button>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <ProgressBar
                        label={`${entry.course.title} progress`}
                        value={percent}
                        className="flex-1"
                      />
                      <span className="num text-[11.5px] text-text-muted">
                        {entry.planned === 0
                          ? 'No roadmap'
                          : prefs.showPercent
                            ? `${percent}%`
                            : `${entry.finished}/${entry.planned}`}
                      </span>
                    </div>

                    <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                      <div>
                        <dt className="text-[10.5px] uppercase tracking-wide text-text-muted">Material</dt>
                        <dd className="text-[15px] font-medium">{entry.materials}</dd>
                      </div>
                      <div>
                        <dt className="text-[10.5px] uppercase tracking-wide text-text-muted">Pages</dt>
                        <dd className="text-[15px] font-medium">{entry.pages}</dd>
                      </div>
                      <div>
                        <dt className="text-[10.5px] uppercase tracking-wide text-text-muted">Topics</dt>
                        <dd className="text-[15px] font-medium">{entry.topics}</dd>
                      </div>
                    </dl>

                    <p className="mt-3 truncate text-[12.5px] text-text-muted">
                      {entry.nextTopicTitle === null
                        ? 'Add material to build the roadmap.'
                        : `Next: ${entry.nextTopicTitle}`}
                    </p>

                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      <Link
                        href={`/course?id=${entry.course.id}&tab=${prefs.defaultCourseTab}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Open course
                      </Link>
                      <Link
                        href={`/course?id=${entry.course.id}&tab=material`}
                        className="btn btn-quiet btn-sm"
                      >
                        Material
                      </Link>
                      <Link
                        href={`/course?id=${entry.course.id}&tab=progress`}
                        className="btn btn-quiet btn-sm"
                      >
                        Progress
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
