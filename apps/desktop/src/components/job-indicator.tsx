'use client';

import { useEffect, useState } from 'react';
import { onAppEvent } from '../lib/events';
import { ProgressBar } from './progress-bar';

const JOB_LABEL: Record<string, string> = {
  build_topics: 'Extracting topics',
  build_roadmap: 'Building roadmap',
  build_lesson: 'Writing lesson',
};

/** Live in-process job state, so long builds are visible from any screen. */
export function JobIndicator() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.kind !== 'job-updated') return;
        if (event.status === 'running') {
          setLabel(JOB_LABEL[event.jobKind] ?? 'Working');
        } else {
          setLabel(null);
        }
      }),
    [],
  );

  if (label === null) return null;

  return (
    <div className="activity" role="status" aria-live="polite">
      <span className="activity-head">
        <span aria-hidden className="activity-dot" />
        <span className="truncate">{label}...</span>
      </span>
      <ProgressBar indeterminate label={label} />
    </div>
  );
}
