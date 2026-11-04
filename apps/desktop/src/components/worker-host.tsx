'use client';

import { useEffect } from 'react';
import { isDesktopRuntime } from '../lib/db';
import { startWorker } from '../lib/worker';

/**
 * Runs the in-process job queue for the whole app, not just the course
 * screen: uploads, roadmap rebuilds and lesson jobs keep moving while the
 * learner sits on the Dashboard or Settings.
 */
export function WorkerHost() {
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    startWorker();
  }, []);
  return null;
}
