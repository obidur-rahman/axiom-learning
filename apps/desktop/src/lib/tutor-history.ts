/**
 * Tutor threads survive tab switches and restarts: one saved thread per
 * course, kept on this device. Restored when the Tutor tab opens again so a
 * learner never has to ask the same question twice.
 */
import type { TutorMessage } from '@axiom/pipeline';

const KEY_PREFIX = 'axiom.tutor.thread.';
const MAX_SAVED = 200;

function key(courseId: string): string {
  return `${KEY_PREFIX}${courseId}`;
}

export function loadTutorHistory(courseId: string): TutorMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key(courseId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is TutorMessage => {
        const value = entry as Partial<TutorMessage> | null;
        return (
          value !== null &&
          (value.role === 'user' || value.role === 'assistant') &&
          typeof value.content === 'string'
        );
      })
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
        citations: Array.isArray(entry.citations) ? entry.citations.filter((page) => typeof page === 'number') : [],
      }));
  } catch {
    return [];
  }
}

export function saveTutorHistory(courseId: string, messages: TutorMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key(courseId), JSON.stringify(messages.slice(-MAX_SAVED)));
  } catch {
    // Storage full or private mode: the thread still works for this session.
  }
}

export function clearTutorHistory(courseId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key(courseId));
  } catch {
    // Nothing to do.
  }
}
