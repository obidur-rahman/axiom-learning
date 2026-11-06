/**
 * Cancellation for the job in flight. The worker registers the controller it
 * runs under and the UI aborts it. This lives apart from worker.ts so the
 * sidebar can import it without pulling the whole pipeline into its bundle.
 */
let current: { jobId: string; controller: AbortController } | null = null;

/** Registers the job about to run and hands back its abort controller. */
export function beginJob(jobId: string): AbortController {
  current = { jobId, controller: new AbortController() };
  return current.controller;
}

/** Drops the registration once the job has finished, failed or been stopped. */
export function endJob(jobId: string): void {
  if (current !== null && current.jobId === jobId) current = null;
}

/**
 * Stops the job in flight. Returns false when it already finished, or when a
 * different job is running than the caller expected.
 */
export function cancelRunningJob(jobId?: string): boolean {
  if (current === null) return false;
  if (jobId !== undefined && jobId !== current.jobId) return false;
  current.controller.abort();
  return true;
}

export function runningJobId(): string | null {
  return current?.jobId ?? null;
}
