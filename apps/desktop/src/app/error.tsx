'use client';

import Link from 'next/link';
import { RotateCcw } from 'lucide-react';

/**
 * Route-level safety net: a rendering error must not leave an empty window.
 * The data lives in the local database, so the message and a retry are enough
 * to get back to work - nothing is lost by reloading the screen.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-lg p-6">
        <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Something broke</p>
        <h1 className="page-title mt-1">This screen stopped rendering</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
          Your courses, notes and lessons are stored on this device and are not affected. Try the
          screen again; if it keeps happening, the message below is what to report.
        </p>
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--radius)] border border-border bg-surface p-3 text-[12px] text-danger">
          {error.message}
          {error.digest === undefined ? '' : `\n\nDigest: ${error.digest}`}
        </pre>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={reset} className="btn btn-primary btn-sm">
            <RotateCcw className="size-3.5" aria-hidden />
            Try again
          </button>
          <Link href="/" className="btn btn-ghost btn-sm">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
