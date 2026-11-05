'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  confirmAllDrafts,
  listQuestions,
  setQuestionStatus,
  updateQuestion,
  type ExamQuestion,
} from '@axiom/data';
import { getDb } from '../lib/db';

const SOURCE_LABEL: Record<ExamQuestion['source'], string> = {
  past_paper: 'Past paper',
  generated: 'Generated from notes - not a past paper',
  user: 'Added by you',
};

const TYPE_LABEL: Record<string, string> = {
  definition: 'Definition',
  explanation: 'Explanation',
  derivation: 'Derivation',
  numerical: 'Numerical',
  comparison: 'Comparison',
  diagram: 'Diagram',
  essay: 'Essay',
  code: 'Code',
  other: 'Other',
};

/**
 * Human review for extracted questions. Nothing here is auto-confirmed: a
 * draft becomes part of the study ladder only when the learner accepts it.
 */
export function QuestionReview({
  courseId,
  onChanged,
}: {
  courseId: string;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<ExamQuestion[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const db = await getDb();
    setDrafts(await listQuestions(db.driver, courseId, 'draft'));
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = useCallback(
    async (fn: () => Promise<void>) => {
      await fn();
      await load();
      onChanged();
    },
    [load, onChanged],
  );

  if (drafts.length === 0) return null;

  return (
    <section className="rounded-[var(--radius)] border border-border bg-surface p-3.5" aria-labelledby="review-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="review-heading" className="text-[14px] font-semibold">
            Review extracted questions
          </h3>
          <p className="mt-0.5 text-[12px] text-text-muted">
            {drafts.length} draft{drafts.length === 1 ? '' : 's'} waiting. Confirm only what the paper really asked.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            void change(async () => {
              const db = await getDb();
              await confirmAllDrafts(db.driver, courseId);
              setMessage('All drafts confirmed.');
            })
          }
        >
          Confirm all
        </button>
      </div>

      <ul className="mt-3 flex flex-col gap-2.5">
        {drafts.map((question) => (
          <li key={question.id} className="rounded-[var(--radius)] border border-border bg-panel p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip">{SOURCE_LABEL[question.source]}</span>
              <span className="chip">{TYPE_LABEL[question.questionType] ?? question.questionType}</span>
              {question.year !== null && <span className="chip num">{question.year}</span>}
              {question.questionNumber !== null && <span className="chip num">Q{question.questionNumber}</span>}
              {question.marks !== null && <span className="chip num">{question.marks} marks</span>}
              <span className="chip num">Difficulty {question.difficulty}/5</span>
              {question.citationPages.length > 0 && (
                <span className="chip num">p.{question.citationPages.join(', ')}</span>
              )}
            </div>
            <textarea
              defaultValue={question.prompt}
              rows={3}
              className="input mt-2 w-full resize-y text-[13px]"
              aria-label="Question text"
              onBlur={(event) => {
                const next = event.currentTarget.value.trim();
                if (next === '' || next === question.prompt) return;
                void change(async () => {
                  const db = await getDb();
                  await updateQuestion(db.driver, question.id, { prompt: next });
                });
              }}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  void change(async () => {
                    const db = await getDb();
                    await setQuestionStatus(db.driver, question.id, 'confirmed');
                  })
                }
              >
                Confirm
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() =>
                  void change(async () => {
                    const db = await getDb();
                    await setQuestionStatus(db.driver, question.id, 'rejected');
                  })
                }
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
      {message !== '' && (
        <p className="mt-2 text-[12px] text-text-muted" aria-live="polite">
          {message}
        </p>
      )}
    </section>
  );
}
