'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  makePractice,
  scoreWrittenAnswer,
  type McqItem,
  type WrittenItem,
  type WrittenScore,
} from '@axiom/pipeline';
import { setProgress, type DbDriver } from '@axiom/data';
import { getDb } from '../lib/db';
import { loadConfig } from '../lib/provider';
import { usePrefs } from '../lib/prefs';
import { Markdown } from './markdown';

function listTopics(db: DbDriver, courseId: string): Promise<{ id: string; title: string }[]> {
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
    return rows.map((row) => ({ id: String(row['id']), title: String(row['title']) }));
  })();
}

/**
 * Practice screen (FR-064..FR-069): multiple choice with instant feedback,
 * then one written answer scored on the three-part rubric (correctness,
 * completeness, structure). Marking a topic done feeds the Progress screen.
 */
export function PracticePanel({ courseId }: { courseId: string }) {
  const prefs = usePrefs();
  const [topics, setTopics] = useState<{ id: string; title: string }[]>([]);
  const [autoKnownNote, setAutoKnownNote] = useState('');
  const [topicId, setTopicId] = useState('');
  const [loading, setLoading] = useState(false);
  const [mcq, setMcq] = useState<McqItem | null>(null);
  const [written, setWritten] = useState<WrittenItem | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [writtenText, setWrittenText] = useState('');
  const [score, setScore] = useState<WrittenScore | null>(null);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const db = await getDb();
      const options = await listTopics(db.driver, courseId);
      setTopics(options);
      setTopicId(options[0]?.id ?? '');
    })();
  }, [courseId]);

  const generate = useCallback(async () => {
    if (topicId === '' || loading) return;
    setLoading(true);
    setError('');
    setMcq(null);
    setWritten(null);
    setScore(null);
    setChoice(null);
    try {
      const db = await getDb();
      const config = await loadConfig();
      if (config === null) {
        setError('No provider configured. Set it in Settings first.');
        return;
      }
      const practice = await makePractice(db.driver, courseId, topicId, loadConfig);
      setMcq(practice.mcq[0] ?? null);
      setWritten(practice.written[0] ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [courseId, topicId, loading]);

  const submitWritten = useCallback(async () => {
    if (written === null || writtenText.trim() === '' || scoring) return;
    setScoring(true);
    setError('');
    try {
      const score1 = await scoreWrittenAnswer(writtenText.trim(), written, loadConfig);
      setScore(score1);
      if (prefs.autoKnownOnStrongScore) {
        const total = score1.correctness + score1.completeness + score1.structure;
        if (total >= 5) {
          const db = await getDb();
          await setProgress(db.driver, courseId, topicId, 'known');
          setAutoKnownNote('Strong score - this topic is now marked known.');
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setScoring(false);
    }
  }, [written, writtenText, scoring, prefs.autoKnownOnStrongScore, courseId, topicId]);

  const markDone = useCallback(async () => {
    if (topicId === '') return;
    const db = await getDb();
    await setProgress(db.driver, courseId, topicId, 'known');
  }, [courseId, topicId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={topicId}
          onChange={(event) => setTopicId(event.target.value)}
          className="flex-1 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm"
        >
          {topics.length === 0 && <option value="">No topics yet</option>}
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.title}
            </option>
          ))}
        </select>
        <button
          onClick={() => void generate()}
          disabled={topicId === '' || loading}
          className="rounded-[var(--radius)] bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Making...' : 'New practice set'}
        </button>
      </div>

      {error !== '' && <p className="rounded-[var(--radius)] border border-danger/40 bg-surface px-3 py-2 text-sm text-danger">{error}</p>}
      {loading && <p className="text-sm text-text-muted" aria-live="polite">Building a question pair...</p>}

      {mcq !== null && (
        <section className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface p-3">
          <p className="text-xs text-text-muted">Multiple choice</p>
          <Markdown content={mcq.prompt} compact className="font-medium" />
          <div className="flex flex-col gap-1">
            {mcq.options.map((option, index) => {
              const chosen = choice === index;
              const correct = index === mcq.correct;
              const answered = choice !== null;
              const style = answered && chosen
                ? correct
                  ? 'border border-known px-3 py-2 text-sm rounded-[var(--radius)]'
                  : 'border border-danger px-3 py-2 text-sm rounded-[var(--radius)]'
                : 'border border-border px-3 py-2 text-sm rounded-[var(--radius)] hover:border-accent';
              return (
                <button
                  key={index}
                  disabled={answered}
                  onClick={() => setChoice(index)}
                  className={`${style} text-left`}
                >
                  <Markdown content={option} compact inline />
                  {answered && correct && <span className="ml-2 text-xs text-known">correct</span>}
                </button>
              );
            })}
          </div>
          {choice !== null && (
            <div className="text-sm text-text-muted">
              <p>{choice === mcq.correct ? 'Right.' : 'Not quite.'}</p>
              <Markdown content={mcq.explanation} compact />
            </div>
          )}
        </section>
      )}

      {written !== null && (
        <section className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface p-3">
          <p className="text-xs text-text-muted">Written answer</p>
          <Markdown content={written.prompt} compact className="font-medium" />
          <textarea
            rows={4}
            value={writtenText}
            onChange={(event) => setWrittenText(event.target.value)}
            placeholder="Write your answer..."
            className="w-full rounded-[var(--radius)] border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={() => void submitWritten()}
            disabled={scoring || writtenText.trim() === ''}
            className="self-start rounded-[var(--radius)] bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-40"
          >
            {scoring ? 'Scoring...' : 'Score my answer'}
          </button>
          {score !== null && (
            <div className="rounded-[var(--radius)] border border-border bg-bg p-3 text-sm">
              <p className="font-medium">
                Score: {score.correctness + score.completeness + score.structure}/6
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-text-muted">
                <li>Correctness {score.correctness}/2</li>
                <li>Completeness {score.completeness}/2</li>
                <li>Structure {score.structure}/2</li>
              </ul>
              <Markdown content={score.feedback} compact className="mt-2" />
              {autoKnownNote !== '' && <p className="mt-2 text-xs text-known">{autoKnownNote}</p>}
            </div>
          )}
          {choice !== null && score !== null && (
            <button
              onClick={() => void markDone()}
              className="self-start rounded-[var(--radius)] border border-known px-3 py-1.5 text-xs text-known hover:opacity-90"
            >
              I am done with this topic (mark known)
            </button>
          )}
        </section>
      )}

      {mcq === null && written === null && !loading && error === '' && (
        <p className="rounded-[var(--radius)] border border-border bg-surface p-4 text-sm text-text-muted">
          Pick a topic and press New practice set. The written part is returned
          with a suggested model answer after scoring.
        </p>
      )}
    </div>
  );
}
