'use client';

import { Progress } from './ui/progress';

interface ProgressBarProps {
  label: string;
  value?: number;
  indeterminate?: boolean;
  className?: string;
}

/** Accent progress bar built on the shadcn Progress primitive. */
export function ProgressBar({ label, value = 0, indeterminate = false, className }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <Progress
      aria-label={label}
      value={indeterminate ? null : percent}
      data-indeterminate={indeterminate ? 'true' : undefined}
      className={className === undefined ? 'block w-full' : `block w-full ${className}`}
    />
  );
}
