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
      /** Set while a material is being read, so the page list can follow it. */
      materialId?: string;
      page?: {
        number: number;
        total: number;
        method: string;
        /** Letters and digits in the page text; 0 means it came back empty. */
        chars: number;
      };
    }
  | { kind: 'lesson-ready'; courseId: string; topicId: string; lessonId: string }
  | {
      kind: 'lesson-progress';
      courseId: string;
      topicId: string;
      lessonId: string;
      beatCount: number;
      totalBeats: number;
    }
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
