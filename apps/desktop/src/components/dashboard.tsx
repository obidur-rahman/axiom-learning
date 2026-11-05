'use client';

/**
 * Dashboard: the app's home. Real counts from the local database, a next-exam
 * countdown, per-course progress and a continue list that deep-links into the
 * course. Display switches (percentages, countdown) come from Settings.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  courseSummaries,
  recentMaterials,
  type CourseSummary,
  type RecentMaterial,
} from '@axiom/data';
import { getDb, isDesktopRuntime } from '../lib/db';
import { usePrefs } from '../lib/prefs';
import { ProgressBar } from './progress-bar';
import { TodayPlan } from './today-plan';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'browser' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; summaries: CourseSummary[]; recent: RecentMaterial[] };

const MATERIAL_KIND_LABEL: Record<string, string> = {
  syllabus: 'Syllabus',
  notes: 'Notes',
  past_questions: 'Past paper',
  textbook: 'Textbook',
  suggestions: 'Suggestions',
  other: 'Material',
};

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function daysUntil(iso: string): number | null {
  const parts = iso.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const exam = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((exam.getTime() - today.getTime()) / 86_400_000);
}

function examText(iso: string, withCountdown: boolean): string {
  if (!withCountdown) {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  const days = daysUntil(iso);
  if (days === null) return iso;
  if (days === 0) return 'Today';
  if (days < 0) return `${Math.abs(days)}d ago`;
  return `in ${days}d`;
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === 'ready'
      ? 'var(--color-known)'
      : status === 'failed'
        ? 'var(--color-danger)'
        : status === 'reading'
          ? 'var(--color-core)'
          : 'var(--color-warning)';
  return <span aria-hidden className="size-1.5 rounded-full" style={{ background: tone }} />;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-4">
      <p className="stat-value">{value}</p>
      <p className="stat-label">{label}</p>
      <p className="mt-1.5 text-[12.5px] leading-snug text-text-muted/90">{hint}</p>
    </div>
  );
}

export function Dashboard() {
  const prefs = usePrefs();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [greeting, setGreeting] = useState('Welcome back');

  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

  const load = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setState({ kind: 'browser' });
      return;
    }
    try {
      const db = await getDb();
      const [summaries, recent] = await Promise.all([
        courseSummaries(db.driver),
        recentMaterials(db.driver),
      ]);
      setState({ kind: 'ready', summaries, recent });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summaries = state.kind === 'ready' ? state.summaries : [];
  const recent = state.kind === 'ready' ? state.recent : [];
  const name = prefs.displayName.trim();
  const planned = summaries.reduce((total, entry) => total + entry.planned, 0);
  const finished = summaries.reduce((total, entry) => total + entry.finished, 0);
  const pages = summaries.reduce((total, entry) => total + entry.pages, 0);
  const nextExam = summaries
    .filter((entry) => entry.course.examDate !== null)
    .sort((a, b) => (a.course.examDate ?? '').localeCompare(b.course.examDate ?? ''))[0];
  const focusCourse =
    nextExam ?? summaries.filter((entry) => entry.topics > 0).sort((a, b) => b.finished - a.finished)[0];
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">
            {greeting}
            {name === '' ? '' : `, ${name}`}
          </h1>
          <p className="page-sub">
            {today} · Where your courses stand, and what to study next.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/courses#new" className="btn btn-primary">
            New course
          </Link>
          <Link href="/settings" className="btn btn-ghost">
            Settings
          </Link>
        </div>
      </header>

      {state.kind === 'loading' && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-live="polite" aria-label="Loading dashboard">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="card p-4">
              <div className="skeleton h-7 w-16" />
              <div className="skeleton mt-2.5 h-3 w-24" />
            </div>
          ))}
        </div>
      )}

      {state.kind === 'browser' && (
        <div className="card p-5 text-sm text-text-muted">
          The dashboard reads your local study database, which runs inside the
          desktop app. Start it with{' '}
          <code className="rounded-[2px] border border-border bg-surface px-1.5 py-0.5 text-text">npm run tauri dev</code>{' '}
          and your courses, roadmap progress and exams appear here.
        </div>
      )}

      {state.kind === 'error' && (
        <div className="card border-danger/50 p-5 text-sm">
          <p className="font-medium text-danger">The dashboard could not load.</p>
          <p className="mt-1 text-text-muted">{state.message}</p>
          <button type="button" onClick={() => void load()} className="btn btn-ghost btn-sm mt-3">
            Try again
          </button>
        </div>
      )}

      {state.kind === 'ready' && summaries.length === 0 && (
        <section className="card overflow-hidden">
          <div className="border-b border-border px-5 py-5">
            <h2 className="text-lg font-semibold tracking-tight">Three steps to your first study plan</h2>
            <p className="mt-1 max-w-2xl text-sm text-text-muted">
              Axiom reads your own syllabus, notes and past papers, then keeps
              only the topics your exam needs.
            </p>
          </div>
          <ol className="grid gap-4 p-5 md:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Create a course',
                body: 'Name the subject, set the level, language and exam date.',
                href: '/courses#new',
                action: 'Create a course',
              },
              {
                step: '2',
                title: 'Connect a model',
                body: 'Point Axiom at a local endpoint or any OpenAI-compatible API.',
                href: '/settings#provider',
                action: 'Open provider settings',
              },
              {
                step: '3',
                title: 'Study the roadmap',
                body: 'Add material, review the pruned plan, then read and practice.',
                href: '/courses',
                action: 'Open courses',
              },
            ].map((entry) => (
              <li key={entry.step} className="row flex flex-col gap-1.5 first:border-0 md:border-t-0 md:pt-0">
                <span className="chip w-fit">Step {entry.step}</span>
                <p className="text-[14.5px] font-medium">{entry.title}</p>
                <p className="text-[12.5px] leading-relaxed text-text-muted">{entry.body}</p>
                <Link href={entry.href} className="mt-2 text-[12.5px] font-medium text-text underline-offset-4 hover:underline">
                  {entry.action} →
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {state.kind === 'ready' && summaries.length > 0 && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Study summary">
            <StatCard
              label="Courses"
              value={String(summaries.length)}
              hint={`${summaries.filter((entry) => entry.planned > 0).length} with a roadmap`}
            />
            <StatCard
              label="Topics finished"
              value={planned === 0 ? '—' : `${finished}/${planned}`}
              hint={planned === 0 ? 'Build a roadmap to track this' : 'Core and bridge topics done or known'}
            />
            <StatCard
              label="Readable pages"
              value={String(pages)}
              hint="Pages the tutor and lessons can cite"
            />
            <StatCard
              label="Next exam"
              value={
                nextExam === undefined || nextExam.course.examDate === null
                  ? '—'
                  : examText(nextExam.course.examDate, prefs.showCountdown)
              }
              hint={nextExam === undefined ? 'No exam date set' : nextExam.course.title}
            />
          </section>

          {focusCourse !== undefined && (
            <TodayPlan
              courseId={focusCourse.course.id}
              courseTitle={focusCourse.course.title}
              examDate={focusCourse.course.examDate}
            />
          )}

          <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
            <section className="card p-5" aria-labelledby="continue-heading">
              <div className="flex items-center justify-between gap-2">
                <h2 id="continue-heading" className="section-title">
                  Continue studying
                </h2>
                <Link href="/courses" className="text-[12.5px] text-text-muted no-underline hover:text-text">
                  All courses →
                </Link>
              </div>

              <ul className="mt-2">
                {summaries.map((entry) => {
                  const percent = entry.planned === 0 ? 0 : Math.round((entry.finished / entry.planned) * 100);
                  return (
                    <li key={entry.course.id} className="row">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/course?id=${entry.course.id}`}
                            className="block truncate text-[14.5px] font-medium no-underline hover:underline"
                          >
                            {entry.course.title}
                          </Link>
                          <p className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="chip">{entry.course.level}</span>
                            <span className="chip">
                              {entry.course.language === 'mixed' ? 'Bangla + English' : entry.course.language === 'bn' ? 'Bangla' : 'English'}
                            </span>
                            {entry.course.examDate !== null && (
                              <span className="chip">Exam {examText(entry.course.examDate, prefs.showCountdown)}</span>
                            )}
                          </p>
                        </div>
                        <Link
                          href={`/course?id=${entry.course.id}&tab=study`}
                          className="btn btn-ghost btn-sm shrink-0"
                        >
                          {entry.planned === 0 ? 'Add material' : 'Resume'}
                        </Link>
                      </div>

                      <div className="mt-3 flex items-center gap-3">
                        <ProgressBar
                          label={`${entry.course.title} progress`}
                          value={percent}
                          className="flex-1"
                        />
                        {prefs.showPercent && (
                          <span className="num w-8 text-right text-[12.5px] text-text-muted">{percent}%</span>
                        )}
                      </div>

                      <p className="mt-2 truncate text-[12.5px] text-text-muted">
                        {entry.nextTopicTitle === null
                          ? entry.topics === 0
                            ? 'No topics yet - add the syllabus to build the roadmap.'
                            : 'Every planned topic is finished. Review or practice next.'
                          : `Next: ${entry.nextTopicTitle}`}
                        {' · '}
                        {entry.materials} material{entry.materials === 1 ? '' : 's'}
                        {' · '}
                        {entry.pages} page{entry.pages === 1 ? '' : 's'} read
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>

            <div className="flex flex-col gap-4">
              <section className="card p-5" aria-labelledby="exam-heading">
                <h2 id="exam-heading" className="section-title">
                  Upcoming exam
                </h2>
                {nextExam === undefined || nextExam.course.examDate === null ? (
                  <p className="mt-3 text-sm text-text-muted">
                    No exam date set. Add one in the course&apos;s Progress tab to see
                    a countdown here.
                  </p>
                ) : (
                  <div className="mt-3">
                    <p className="text-[30px] font-semibold tracking-tight">
                      {examText(nextExam.course.examDate, prefs.showCountdown)}
                    </p>
                    <p className="mt-1 text-sm text-text-muted">{nextExam.course.title}</p>
                    <p className="mt-1 text-[12px] text-text-muted">
                      {new Date(nextExam.course.examDate).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                    <Link
                      href={`/course?id=${nextExam.course.id}&tab=progress`}
                      className="btn btn-ghost btn-sm mt-3"
                    >
                      Open study plan
                    </Link>
                  </div>
                )}
              </section>

              <section className="card p-5" aria-labelledby="recent-heading">
                <div className="flex items-center justify-between">
                  <h2 id="recent-heading" className="section-title">
                    Recent material
                  </h2>
                  <span className="chip">{recent.length}</span>
                </div>
                {recent.length === 0 ? (
                  <p className="mt-3 text-sm text-text-muted">
                    Nothing uploaded yet. Open a course and add the syllabus first.
                  </p>
                ) : (
                  <ul className="mt-2">
                    {recent.map((item) => (
                      <li key={item.id} className="row flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px]">
                            {MATERIAL_KIND_LABEL[item.kind] ?? 'Material'}
                            {item.pageCount !== null ? ` · ${item.pageCount}p` : ''}
                          </p>
                          <Link
                            href={`/course?id=${item.courseId}&tab=material`}
                            className="block truncate text-[12.5px] text-text-muted no-underline hover:text-text"
                          >
                            {item.courseTitle}
                          </Link>
                        </div>
                        <span className="chip shrink-0">
                          <StatusDot status={item.status} />
                          {item.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
