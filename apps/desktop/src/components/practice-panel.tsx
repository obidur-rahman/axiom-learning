'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  makePractice,
  scoreWrittenAnswer,
  type McqItem,
  type WrittenItem,
  type WrittenScore,
} from '@axiom/pipeline';
import { setProgress } from '@axiom/data';
import { getDb } from '../lib/db';
import { loadConfig } from '../lib/provider';
import { listTopicOptions, type TopicOption } from '../lib/topics';
import { usePrefs } from '../lib/prefs';
import { Markdown } from './markdown';

/**
 * Practice screen (FR-064..FR-069): a set of multiple-choice questions that
 * covers the whole topic with instant feedback, then a few written answers
 * reserved for theory and derivations, scored on the three-part rubric
 * (correctness, completeness, structure). Marking a topic done feeds Progress.
 */
export function PracticePanel({ courseId }: { courseId: string }) {
  const prefs = usePrefs();
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [autoKnownNote, setAutoKnownNote] = useState('');
  const [topicId, setTopicId] = useState('');
  const [loading, setLoading] = useState(false);
  const [mcq, setMcq] = useState<McqItem[]>([]);
  const [written, setWritten] = useState<WrittenItem[]>([]);
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [writtenTexts, setWrittenTexts] = useState<Record<number, string>>({});
  const [scores, setScores] = useState<Record<number, WrittenScore>>({});
  const [scoringIndex, setScoringIndex] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const db = await getDb();
      const options = await listTopicOptions(db.driver, courseId);
      setTopics(options);
      setTopicId(options[0]?.id ?? '');
    })();
  }, [courseId]);

  const resetAnswers = useCallback(() => {
    setChoices({});
    setWrittenTexts({});
    setScores({});
    setAutoKnownNote('');
  }, []);

  const generate = useCallback(async () => {
    if (topicId === '' || loading) return;
    setLoading(true);
    setError('');
    setMcq([]);
    setWritten([]);
    resetAnswers();
    try {
      const db = await getDb();
      const config = await loadConfig();
      if (config === null) {
        setError('No provider configured. Set it in Settings first.');
        return;
      }
      const practice = await makePractice(db.driver, courseId, topicId, loadConfig);
      setMcq(practice.mcq);
      setWritten(practice.written.slice(0, 3));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [courseId, topicId, loading, resetAnswers]);

  const scoreWritten = useCallback(
    async (index: number) => {
      const item = written[index];
      const text = writtenTexts[index]?.trim() ?? '';
      if (item === undefined || text === '' || scoringIndex !== null) return;
      setScoringIndex(index);
      setError('');
      try {
        const result = await scoreWrittenAnswer(text, item, loadConfig);
        setScores((current) => ({ ...current, [index]: result }));
        if (prefs.autoKnownOnStrongScore) {
          const total = result.correctness + result.completeness + result.structure;
          if (total >= 5) {
            const db = await getDb();
            await setProgress(db.driver, courseId, topicId, 'known');
            setAutoKnownNote('Strong score - this topic is now marked known.');
          }
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setScoringIndex(null);
      }
    },
    [written, writtenTexts, scoringIndex, prefs.autoKnownOnStrongScore, courseId, topicId],
  );

  const markDone = useCallback(async () => {
    if (topicId === '') return;
    const db = await getDb();
    await setProgress(db.driver, courseId, topicId, 'known');
  }, [courseId, topicId]);

  const answered = Object.keys(choices).length;
  const correct = useMemo(
    () => mcq.filter((item, index) => choices[index] === item.correct).length,
    [mcq, choices],
  );
  const total = mcq.length + written.length;
  const done = answered + Object.keys(scores).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={topicId}
          onChange={(event) => setTopicId(event.target.value)}
          className="input flex-1"
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
          className="btn btn-primary"
        >
          {loading ? 'Making...' : 'New practice set'}
        </button>
      </div>

      {error !== '' && <p className="rounded-[var(--radius)] border border-danger/40 bg-surface px-3 py-2 text-sm text-danger">{error}</p>}

      {loading && (
        <div className="rounded-[var(--radius)] border border-border bg-surface p-4" aria-live="polite">
          <p className="text-sm text-text-muted">Writing a set of questions that covers the whole topic...</p>
          <div className="mt-2">
            <div className="deck-progress-track" role="progressbar" aria-label="Building practice set">
              <div className="deck-progress-fill animate-pulse" style={{ width: '45%' }} />
            </div>
          </div>
        </div>
      )}

      {mcq.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Multiple choice questions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="section-title">Multiple choice</p>
            <p className="text-[13px] text-text-muted">
              {answered} of {mcq.length} answered{answered > 0 ? ` · ${correct} correct` : ''}
            </p>
          </div>

          <ol className="flex flex-col gap-3">
            {mcq.map((item, questionIndex) => {
              const choice = choices[questionIndex];
              const answeredHere = choice !== undefined;
              return (
                <li
                  key={questionIndex}
                  className="rounded-[var(--radius)] border border-border bg-surface p-3.5"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="slide-nav-index mt-0.5 flex-none" aria-hidden>
                      {questionIndex + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Markdown content={item.prompt} className="font-medium" />
                      <div className="mt-2 flex flex-col gap-1.5">
                        {item.options.map((option, optionIndex) => {
                          const chosen = choice === optionIndex;
                          const isCorrect = optionIndex === item.correct;
                          const style = answeredHere
                            ? chosen
                              ? isCorrect
                                ? 'border-known bg-known/10'
                                : 'border-danger bg-danger/10'
                              : isCorrect
                                ? 'border-known/60'
                                : 'border-border'
                            : 'border-border hover:border-accent';
                          return (
                            <button
                              key={optionIndex}
                              disabled={answeredHere}
                              onClick={() =>
                                setChoices((current) => ({ ...current, [questionIndex]: optionIndex }))
                              }
                              className={`flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-left text-[14px] transition-colors ${style}`}
                            >
                              <span className="num flex-none text-text-muted">
                                {String.fromCharCode(65 + optionIndex)}.
                              </span>
                              <span className="min-w-0 flex-1">
                                <Markdown content={option} compact inline />
                              </span>
                              {answeredHere && isCorrect && (
                                <span className="flex-none text-[11.5px] font-medium text-known">correct</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {answeredHere && (
                        <div className="mt-2 rounded-[var(--radius)] border border-border bg-bg p-2.5 text-[13.5px]">
                          <p className={choice === item.correct ? 'text-known' : 'text-danger'}>
                            {choice === item.correct ? 'Right.' : 'Not quite.'}
                          </p>
                          <Markdown content={item.explanation} compact className="mt-1 text-text-muted" />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {written.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Written questions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="section-title">Written answers</p>
            <p className="text-[13px] text-text-muted">
              {Object.keys(scores).length} of {written.length} scored
            </p>
          </div>
          <p className="text-[12.5px] text-text-muted">
            Only the answers an exam makes you write by hand. For a calculation, just state
            the result and the key step - the checker verifies the maths.
          </p>

          {written.map((item, index) => {
            const score = scores[index];
            const busy = scoringIndex === index;
            return (
              <article
                key={index}
                className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface p-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <span className="slide-nav-index mt-0.5 flex-none" aria-hidden>
                    {index + 1}
                  </span>
                  <Markdown content={item.prompt} className="font-medium" />
                </div>
                <textarea
                  rows={4}
                  value={writtenTexts[index] ?? ''}
                  onChange={(event) =>
                    setWrittenTexts((current) => ({ ...current, [index]: event.target.value }))
                  }
                  placeholder="Write your answer, or just the final result for a calculation..."
                  className="input min-h-[92px] resize-y"
                />
                <button
                  onClick={() => void scoreWritten(index)}
                  disabled={busy || (writtenTexts[index] ?? '').trim() === ''}
                  className="btn btn-primary btn-sm self-start"
                >
                  {busy ? 'Checking...' : score === undefined ? 'Check my answer' : 'Check again'}
                </button>
                {score !== undefined && (
                  <div className="rounded-[var(--radius)] border border-border bg-bg p-3 text-sm">
                    <p className="font-medium">
                      Score: {score.correctness + score.completeness + score.structure}/6
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-text-muted">
                      <li>Correctness {score.correctness}/2</li>
                      <li>Completeness {score.completeness}/2</li>
                      <li>Structure {score.structure}/2</li>
                    </ul>
                    <Markdown content={score.feedback} compact className="mt-2" />
                    <details className="mt-2 text-[13px] text-text-muted">
                      <summary className="cursor-pointer select-none">Model answer</summary>
                      <Markdown content={item.modelAnswer} compact className="mt-1 text-text" />
                    </details>
                  </div>
                )}
              </article>
            );
          })}

          {autoKnownNote !== '' && <p className="text-[12.5px] text-known">{autoKnownNote}</p>}
          <button onClick={() => void markDone()} className="btn btn-ghost btn-sm self-start">
            I am done with this topic (mark known)
          </button>
        </section>
      )}

      {total > 0 && (
        <p className="text-[12.5px] text-text-muted" aria-live="polite">
          {done} of {total} parts answered.
        </p>
      )}

      {total === 0 && !loading && error === '' && (
        <p className="rounded-[var(--radius)] border border-border bg-surface p-4 text-sm text-text-muted">
          Pick a topic and press New practice set. You get a run of multiple-choice
          questions across the whole topic, then a few written answers for the theory.
        </p>
      )}
    </div>
  );
}
