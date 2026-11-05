/** Minimal pub/sub so the background worker can push updates into React. */

export type AppEvent =
  | { kind: 'job-updated'; jobId: string; courseId: string; jobKind: string; status: string; error?: string }
  | {
      kind: 'job-progress';
      jobId: string;
      courseId: string;
      jobKind: string;
      /** 0..100 for the current job. */
      percent: number;
      message: string;
    }
  | { kind: 'lesson-ready'; courseId: string; topicId: string; lessonId: string }
  | { kind: 'worker-tick'; at: number };

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();

export function onAppEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitAppEvent(event: AppEvent): void {
  for (const listener of listeners) listener(event);
}
