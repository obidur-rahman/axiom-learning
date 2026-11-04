'use client';

import { useCallback, useEffect, useState } from 'react';
import { onAppEvent } from '../lib/events';
import { loadPrefs } from '../lib/prefs';

interface ToastEntry {
  id: string;
  title: string;
  body: string;
  tone: 'ok' | 'error';
}

const DONE_COPY: Record<string, { title: string; body: string }> = {
  build_topics: { title: 'Topics extracted', body: 'Review them in Topics & scope, then rebuild the roadmap.' },
  build_roadmap: { title: 'Roadmap rebuilt', body: 'The new ordered plan is ready on the Roadmap tab.' },
  build_lesson: { title: 'Lesson ready', body: 'Open Lessons to read it with citations.' },
};

const DISMISS_MS = 6_000;

/** Surfaces finished and failed pipeline jobs; respects the Jobs toggle. */
export function ToastHost() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const unsubscribe = onAppEvent((event) => {
      if (event.kind !== 'job-updated') return;
      if (!loadPrefs().jobToasts) return;
      if (event.status !== 'done' && event.status !== 'failed') return;
      if (event.status === 'done' && DONE_COPY[event.jobKind] === undefined) return;

      const id = `${event.jobId}-${event.status}`;
      const entry: ToastEntry =
        event.status === 'failed'
          ? {
              id,
              tone: 'error',
              title: 'Build failed',
              body: event.error ?? 'The model did not finish this step. Open the tab to retry.',
            }
          : { id, tone: 'ok', ...DONE_COPY[event.jobKind]! };

      setToasts((current) => [...current.filter((toast) => toast.title !== entry.title), entry].slice(-3));
      const timer = setTimeout(() => dismiss(id), DISMISS_MS);
      const previous = timers.get(id);
      if (previous !== undefined) clearTimeout(previous);
      timers.set(id, timer);
    });

    return () => {
      unsubscribe();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-label="Build notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" role="status">
          <p className="toast-title">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: toast.tone === 'ok' ? 'var(--color-known)' : 'var(--color-danger)' }}
            />
            {toast.title}
          </p>
          <p className="toast-body">{toast.body}</p>
          <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <span aria-hidden className="toast-timer" />
        </div>
      ))}
    </div>
  );
}
