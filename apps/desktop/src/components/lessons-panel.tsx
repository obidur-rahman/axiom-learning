'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  enqueue,
  flagLesson,
  getActiveLesson,
  type DbDriver,
  type Lesson,
} from '@axiom/data';
import { getDb } from '../lib/db';
import { onAppEvent } from '../lib/events';

/** One topic option in the lesson picker. */
interface TopicOption {
  id: string;
  title: string;
  nodeType: string;
}

function listTopics(db: DbDriver, courseId: string): Promise<TopicOption[]> {
  return (async () => {
    const rows = await db.select<Record<string, unknown>>(
      `SELECT t.id, t.title, COALESCE(n.node_type, 'core') AS node_type
       FROM topics t
       LEFT JOIN roadmap_nodes n
         ON n.topic_id = t.id
         AND n.roadmap_version_id = (SELECT id FROM roadmap_versions WHERE course_id = $1 ORDER BY version DESC LIMIT 1)
       WHERE t.course_id = $1 AND COALESCE(n.node_type, 'core') <> 'skipped'
       ORDER BY COALESCE(n.order_index, 999999), t.created_at`,
      [courseId],
    );
    return rows.map((row) => ({
      id: String(row['id']),
      title: String(row['title']),
      nodeType: String(row['node_type']),
    }));
  })();
}

/**
 * Lessons + diagnostic (FR-040..FR-057): one topic at a time, lesson text
 * with page citations, three check questions as the self-diagnostic, and a
 * "this is wrong" flag rule for general-content lessons.
 */
export function LessonsPanel({ courseId }: { courseId: string }) {
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [topicId, setTopicId] = useState('');
  const [depth, setDepth] = useState<'core' | 'bridge'>('core');
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [shown, setShown] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadLesson = useCallback(async (target: string, forDepth: string) => {
    if (target === '') return;
    const db = await getDb();
    setLesson(await getActiveLesson(db.driver, target, 'mixed', forDepth));
  }, []);

  useEffect(() => {
    void (async () => {
      const db = await getDb();
      const options = await listTopics(db.driver, courseId);
      setTopics(options);
      const first = options[0]?.id ?? '';
      setTopicId(first);
      await loadLesson(first, 'core');
    })();
  }, [courseId, loadLesson]);

  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.kind === 'lesson-ready' && event.courseId === courseId && event.topicId === topicId) {
          void loadLesson(topicId, depth);
        }
        if (event.kind === 'job-updated' && event.jobKind === 'build_lesson' && event.status === 'queued') {
          setMessage(`Lesson failed: ${event.error ?? 'unknown error'}`);
          setBusy(false);
        }
      }),
    [courseId, topicId, depth, loadLesson],
  );

  const generate = useCallback(async () => {
    if (topicId === '' || busy) return;
    setBusy(true);
    setMessage('Building the lesson...');
    try {
      const db = await getDb();
      await enqueue(db.driver, 'build_lesson', { courseId, payload: { topicId, depth } });
    } finally {
      setBusy(false);
    }
  }, [courseId, topicId, depth, busy]);

  const flag = useCallback(async () => {
    if (lesson === null) return;
    const db = await getDb();
    await flagLesson(db.driver, lesson.id, 'user-flagged');
    setLesson(null);
    setMessage('Lesson flagged and hidden. Generate a new one.');
  }, [lesson]);

  const questions = lesson === null ? [] : parseQuestions(lesson.contentMd);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={topicId}
          onChange={(event) => {
            setTopicId(event.target.value);
            void loadLesson(event.target.value, depth);
          }}
          className="flex-1 rounded-[10px] border border-border bg-surface px-3 py-2 text-sm"
        >
          {topics.length === 0 && <option value="">No topics yet</option>}
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.title}
            </option>
          ))}
        </select>
        <select
          value={depth}
          onChange={(event) => {
            const next = event.target.value as 'core' | 'bridge';
            setDepth(next);
            void loadLesson(topicId, next);
          }}
          title="Lesson depth"
          className="rounded-[10px] border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="core">Full depth</option>
          <option value="bridge">Quick recap</option>
        </select>
        <button
          onClick={() => void generate()}
          disabled={topicId === '' || busy}
          className="rounded-[10px] bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Building...' : lesson === null ? 'Generate lesson' : 'Regenerate'}
        </button>
      </div>

      {message !== '' && <p className="text-sm text-text-muted" aria-live="polite">{message}</p>}

      {lesson !== null && (
        <div className="flex flex-col gap-4">
          {lesson.isGeneralContent && (
            <p className="rounded-[10px] border border-warning/40 bg-surface px-3 py-2 text-sm text-warning">
              This lesson uses general knowledge - not grounded in your uploaded material.
            </p>
          )}
          <article className="rounded-[10px] border border-border bg-surface p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {lesson.contentMd}
          </article>
          {lesson.citations !== null && lesson.citations.length > 0 && (
            <p className="text-xs text-text-muted">
              Sources: pages {(lesson.citations as { page?: number }[]).map((cit) => cit.page).join(', ')}
            </p>
          )}

          <section className="flex flex-col gap-2" aria-label="Self-diagnostic">
            <p className="text-sm font-medium">Check yourself (3 questions)</p>
            {questions.map((question, index) => (
              <div key={index} className="rounded-[10px] border border-border bg-surface p-3">
                <p className="text-sm">{question.prompt}</p>
                <textarea
                  rows={2}
                  value={answers[index] ?? ''}
                  onChange={(event) =>
                    setAnswers((current) => current.map((value, i) => (i === index ? event.target.value : value)))
                  }
                  placeholder="Your answer..."
                  className="mt-2 w-full rounded-[10px] border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                />
                {shown.includes(index) && (
                  <p className="mt-2 rounded-[10px] bg-surface px-2 py-1 text-sm text-text-muted">
                    Answer: {question.answer}
                  </p>
                )}
                <button
                  onClick={() => setShown((current) => (current.includes(index) ? current : [...current, index]))}
                  className="mt-2 text-xs text-accent underline-offset-4 hover:underline"
                >
                  Show answer
                </button>
              </div>
            ))}
            <p className="text-xs text-text-muted">
              Mark a topic "known" in Progress when you can answer all three without looking.
            </p>
          </section>

          <button
            onClick={() => void flag()}
            className="self-start rounded-[10px] border border-border px-3 py-1.5 text-xs hover:border-danger hover:text-danger"
          >
            This lesson is wrong (flag it)
          </button>
        </div>
      )}

      {lesson === null && topics.length > 0 && message === '' && (
        <p className="rounded-[10px] border border-border bg-surface p-4 text-sm text-text-muted">
          No lesson for this topic yet. Press Generate; the first build takes a few seconds.
        </p>
      )}
    </div>
  );
}

/** Reads the `## Check yourself` block: `1. question (Answer: answer)`. */
function parseQuestions(contentMd: string): { prompt: string; answer: string }[] {
  const found: { prompt: string; answer: string }[] = [];
  for (const line of contentMd.split('\n')) {
    const match = /^\d+\.\s*(.+?)\s*\(Answer: (.*?)\)\s*$/.exec(line);
    if (match !== null) found.push({ prompt: match[1] ?? '', answer: match[2] ?? '' });
  }
  return found.slice(0, 3);
}
