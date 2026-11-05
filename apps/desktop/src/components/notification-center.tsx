'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  discardAllJobs,
  discardFinishedJobs,
  discardJob,
  enqueue,
  listRecentJobs,
  type JobNotification,
} from '@axiom/data';
import { getDb, isDesktopRuntime } from '../lib/db';
import { onAppEvent } from '../lib/events';
import { JOB_LABEL } from './job-indicator';

const JOB_TAB: Record<string, string> = {
  build_topics: 'topics',
  find_prerequisites: 'roadmap',
  build_roadmap: 'roadmap',
  build_lesson: 'lessons',
  extract_past_questions: 'study',
  generate_questions: 'study',
  make_practice: 'practice',
  read_material: 'material',
};

function timeLabel(iso: string | null): string {
  if (iso === null) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * One place for every background result and error. The bell carries the
 * failure count; the panel keeps the full message with Try again and Dismiss,
 * instead of banners stacking over the page.
 */
export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<JobNotification[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);

  const refresh = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    try {
      const db = await getDb();
      setRows(await listRecentJobs(db.driver, 12));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAppEvent((event) => {
      if (event.kind === 'job-updated' && event.status !== 'running') void refresh();
    });
  }, [refresh]);

  // Opening moves focus into the panel; closing hands it back to the bell, so
  // the list is usable from the keyboard and focus never lands nowhere.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      panel.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (root.current !== null && root.current.contains(target)) return;
      if (panel.current !== null && panel.current.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const retry = useCallback(
    async (job: JobNotification) => {
      setBusyId(job.id);
      try {
        const db = await getDb();
        await discardJob(db.driver, job.id);
        await enqueue(db.driver, job.jobType, { courseId: job.courseId, payload: job.payload });
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const dismiss = useCallback(
    async (job: JobNotification) => {
      setBusyId(job.id);
      try {
        const db = await getDb();
        await discardJob(db.driver, job.id);
        await refresh();
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const clearFinished = useCallback(async () => {
    const db = await getDb();
    await discardFinishedJobs(db.driver);
    await refresh();
  }, [refresh]);

  const clearAll = useCallback(async () => {
    setBusyId('all');
    try {
      const db = await getDb();
      await discardAllJobs(db.driver);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const failures = rows.filter((row) => row.status === 'failed').length;
  const hasFinished = rows.some((row) => row.status === 'done');

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) void refresh();
        }}
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-label={
          failures > 0
            ? `Notifications, ${failures} failed build${failures === 1 ? '' : 's'}`
            : 'Notifications'
        }
        className="notif-trigger flex size-9 items-center justify-center rounded-[var(--radius)] text-rail-icon transition-colors duration-150 hover:bg-rail-active hover:text-rail-text"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
          <path d="M10.3 20a2 2 0 0 0 3.4 0" />
        </svg>
        {failures > 0 && (
          <span aria-hidden className="notif-badge">
            {failures > 9 ? '9+' : failures}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={panel}
            id="notification-panel"
            className="notif-panel"
            role="dialog"
            aria-label="Notifications"
            tabIndex={-1}
          >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-[13px] font-semibold">Notifications</p>
            <div className="flex gap-1">
              {hasFinished && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => void clearFinished()}>
                  Clear finished
                </button>
              )}
              {rows.length > 0 && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => void clearAll()}
                  disabled={busyId === 'all'}
                  aria-busy={busyId === 'all'}
                  title="Remove every notification, including failures"
                >
                  Clear all
                </button>
              )}
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="px-3 py-5 text-[12.5px] text-text-muted">
              Nothing yet. Build results and errors collect here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => {
                const failed = row.status === 'failed';
                return (
                  <li key={row.id} className="notif-row">
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 flex-none rounded-full"
                        style={{
                          background: failed ? 'var(--color-danger)' : 'var(--color-known)',
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium">
                          {JOB_LABEL[row.jobType] ?? row.jobType}
                          <span
                            className={`ml-1.5 text-[11px] font-normal ${failed ? 'text-danger' : 'text-known'}`}
                          >
                            {failed ? 'failed' : 'done'}
                          </span>
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-muted">
                          {row.courseTitle !== null && (
                            <Link
                              href={`/course?id=${row.courseId ?? ''}&tab=${JOB_TAB[row.jobType] ?? 'material'}`}
                              className="text-accent no-underline hover:underline"
                            >
                              {row.courseTitle}
                            </Link>
                          )}
                          <span>{timeLabel(row.finishedAt ?? row.createdAt)}</span>
                        </p>
                        {failed && row.lastError !== null && (
                          <p className="notif-error">{row.lastError}</p>
                        )}
                        <div className="mt-1 flex gap-1">
                          {failed && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busyId === row.id}
                              aria-busy={busyId === row.id}
                              onClick={() => void retry(row)}
                            >
                              Try again
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-quiet btn-sm"
                            disabled={busyId === row.id}
                            onClick={() => void dismiss(row)}
                          >
                            {failed ? 'Dismiss' : 'Clear'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          </div>,
          document.body,
        )}
    </div>
  );
}
