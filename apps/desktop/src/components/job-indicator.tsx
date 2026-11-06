'use client';

import { useCallback, useEffect, useState } from 'react';
import { pendingJobCount } from '@axiom/data';
import { onAppEvent } from '../lib/events';
import { getDb, isDesktopRuntime } from '../lib/db';
import { cancelRunningJob } from '../lib/job-control';
import { ProgressBar } from './progress-bar';

export const JOB_LABEL: Record<string, string> = {
  read_material: 'Reading material',
  build_topics: 'Extracting topics',
  find_prerequisites: 'Finding prerequisites',
  build_roadmap: 'Building roadmap',
  build_lesson: 'Writing lesson',
  make_practice: 'Writing practice',
  extract_past_questions: 'Reading past questions',
  generate_questions: 'Generating questions',
};

interface Live {
  jobId: string;
  kind: string;
  percent: number | null;
  message: string;
  startedAt: number;
}

/**
 * Live in-process job state, so long builds are visible from any screen: the
 * running step, its percent, how long it has run and how much is still queued.
 */
export function JobIndicator() {
  const [live, setLive] = useState<Live | null>(null);
  const [queued, setQueued] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const refreshQueue = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    try {
      const db = await getDb();
      setQueued(await pendingJobCount(db.driver));
    } catch {
      // The db handle is gone while the window tears down: keep the last count.
    }
  }, []);

  useEffect(() => {
    void refreshQueue();
    // Queued work is real work even when no event reaches this screen: poll the
    // queue so the rail never sits empty while the worker grinds through a
    // backlog, and so a job waiting on a retry stays visible.
    const poll = setInterval(() => void refreshQueue(), 2_000);
    const unsubscribe = onAppEvent((event) => {
      if (event.kind === 'job-progress') {
        setLive((current) =>
          current !== null && current.jobId === event.jobId
            ? { ...current, percent: event.percent, message: event.message }
            : {
                jobId: event.jobId,
                kind: event.jobKind,
                percent: event.percent,
                message: event.message,
                startedAt: Date.now(),
              },
        );
        return;
      }
      if (event.kind !== 'job-updated') return;
      if (event.status === 'queued' || event.status === 'running') {
        const queuedMessage = event.error ?? 'Queued';
        const message = event.status === 'queued' ? queuedMessage : 'Starting';
        setLive((current) =>
          current !== null && current.jobId === event.jobId
            ? {
                ...current,
                percent: event.status === 'queued' ? null : current.percent,
                message: event.status === 'queued' ? queuedMessage : current.message,
              }
            : {
                jobId: event.jobId,
                kind: event.jobKind,
                percent: null,
                message,
                startedAt: Date.now(),
              },
        );
      } else {
        setLive((current) => (current !== null && current.jobId === event.jobId ? null : current));
      }
      void refreshQueue();
    });
    return () => {
      clearInterval(poll);
      unsubscribe();
    };
  }, [refreshQueue]);

  useEffect(() => {
    if (live === null) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [live]);

  if (live === null && queued === 0) return null;

  const label = live === null ? 'Waiting for the worker' : JOB_LABEL[live.kind] ?? 'Working';
  const seconds = live === null ? 0 : Math.max(0, Math.round((now - live.startedAt) / 1000));

  return (
    <div className="activity" role="status" aria-live="polite">
      <span className="activity-head">
        <span aria-hidden className="activity-dot" />
        <span className="truncate">{live === null ? label : `${label}...`}</span>
        <span className="ml-auto flex flex-none items-center gap-2">
          {live !== null && live.percent !== null && (
            <span className="num text-[10.5px] text-text-muted">{Math.round(live.percent)}%</span>
          )}
          {live !== null && (
            <button
              type="button"
              onClick={() => cancelRunningJob(live.jobId)}
              className="text-[10.5px] text-rail-text underline decoration-dotted underline-offset-2 hover:text-danger"
              title="Stop this step"
            >
              Stop
            </button>
          )}
        </span>
      </span>
      <ProgressBar
        indeterminate={live === null || live.percent === null}
        value={live?.percent ?? 0}
        label={label}
      />
      {live !== null ? (
        <span className="flex items-center justify-between gap-2 text-[10px] text-text-muted">
          <span className="truncate">{live.message}</span>
          <span className="num flex-none">{seconds}s</span>
        </span>
      ) : (
        <span className="text-[10px] text-text-muted">A build is queued and starts in a moment.</span>
      )}
      {queued > 1 && (
        <span className="text-[10px] text-text-muted">+{queued - 1} more in the queue</span>
      )}
    </div>
  );
}
