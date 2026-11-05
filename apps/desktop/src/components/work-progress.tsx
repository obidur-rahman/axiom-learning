'use client';

import { useEffect, useState } from 'react';
import { ProgressBar } from './progress-bar';

export interface WorkState {
  /** What is being worked on, e.g. the file name. */
  label: string;
  /** The step inside the work, e.g. "OCR page 4 of 12". */
  detail: string;
  /** 0..100, or null while the amount of work is unknown. */
  percent: number | null;
  tone: 'busy' | 'error' | 'done';
}

function elapsedLabel(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * Progress card for work that runs in the page itself: files are read and
 * OCRed in the webview, so the global job indicator cannot see them. Shows the
 * step, a percent, an elapsed clock and, on failure, the message stays put.
 */
export function WorkProgress({ work, onDismiss }: { work: WorkState; onDismiss?: () => void }) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);

  // A new piece of work starts its own clock.
  useEffect(() => {
    if (work.tone === 'busy') {
      setStartedAt(Date.now());
      setNow(Date.now());
    }
  }, [work.tone, work.label]);

  useEffect(() => {
    if (work.tone !== 'busy') return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [work.tone]);

  return (
    <section className="work-card" data-tone={work.tone} role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        {work.tone === 'busy' ? (
          <span aria-hidden className="spinner" />
        ) : (
          <span
            aria-hidden
            className={work.tone === 'done' ? 'text-known' : 'text-danger'}
            style={{ fontWeight: 700 }}
          >
            {work.tone === 'done' ? '✓' : '!'}
          </span>
        )}
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{work.label}</p>
        {work.tone === 'busy' && (
          <span className="num text-[12px] text-text-muted">{elapsedLabel(startedAt, now)}</span>
        )}
        {work.percent !== null && (
          <span className="num text-[12px] text-text-muted">{Math.round(work.percent)}%</span>
        )}
        {work.tone !== 'busy' && onDismiss !== undefined && (
          <button type="button" onClick={onDismiss} className="btn btn-quiet btn-sm">
            Dismiss
          </button>
        )}
      </div>
      {work.tone === 'busy' && (
        <ProgressBar
          className="mt-2"
          label={work.label}
          value={work.percent ?? 0}
          indeterminate={work.percent === null}
        />
      )}
      <p
        className={
          work.tone === 'error'
            ? 'mt-1.5 text-[12.5px] leading-relaxed text-danger'
            : 'mt-1.5 text-[12.5px] leading-relaxed text-text-muted'
        }
      >
        {work.detail}
      </p>
    </section>
  );
}
