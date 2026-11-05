'use client';

import { useMemo, useState } from 'react';
import { saveAttempt, type ExamQuestion } from '@axiom/data';
import { getDb } from '../lib/db';
import { Markdown } from './markdown';

/**
 * A small deterministic mock paper. The app assembles it from confirmed
 * questions; there is no proctoring and no invented marking. After submitting,
 * the learner grades each answer against the model answer, and the score is
 * saved as study attempts so weak topics feed the next plan.
 */
export function MockExam({
  courseId,
  questions,
  onFinished,
}: {
  courseId: string;
  questions: ExamQuestion[];
  onFinished: () => void;
}) {
  const paper = useMemo(
    () =>
      [...questions]
        .filter((question) => question.status === 'confirmed')
        .sort((a, b) => {
          if (a.source !== b.source) return a.source === 'past_paper' ? -1 : 1;
          return a.difficulty - b.difficulty || (a.year ?? 0) - (b.year ?? 0);
        })
        .slice(0, 10),
    [questions],
  );
  const [started, setStarted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<Record<string, 'correct' | 'partial' | 'wrong'>>({});
  const [busy, setBusy] = useState(false);

  const totalMarks = paper.reduce((sum, question) => sum + (question.marks ?? 5), 0);
  const earned = paper.reduce((sum, question) => {
    const grade = grades[question.id];
    const marks = question.marks ?? 5;
    if (grade === 'correct') return sum + marks;
    if (grade === 'partial') return sum + marks / 2;
    return sum;
  }, 0);
  const allGraded = paper.length > 0 && paper.every((question) => grades[question.id] !== undefined);

  const finish = async () => {
    if (!allGraded || busy) return;
    setBusy(true);
    const db = await getDb();
    for (const question of paper) {
      const grade = grades[question.id] ?? 'wrong';
      await saveAttempt(db.driver, {
        courseId,
        itemKind: 'mock',
        questionId: question.id,
        topicId: question.topicId,
        lessonId: null,
        result: grade,
        score: grade === 'correct' ? (question.marks ?? 5) : grade === 'partial' ? (question.marks ?? 5) / 2 : 0,
        maxScore: question.marks ?? 5,
        confidence: null,
        durationSeconds: null,
        meta: { source: 'mock', patternLabel: question.patternLabel },
        startedAt: null,
      });
    }
    setBusy(false);
    setStarted(false);
    setSubmitted(false);
    setAnswers({});
    setGrades({});
    onFinished();
  };

  if (paper.length === 0) {
    return <p className="text-[12.5px] text-text-muted">Confirm some questions first to assemble a mock paper.</p>;
  }

  if (!started) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-text-muted">
          {paper.length} questions · {totalMarks} marks · mixed past and generated. Self-marked, no timer pressure.
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStarted(true)}>
          Start mock exam
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-text-muted">
          {paper.length} questions · {totalMarks} marks. Write your answers, then submit and mark yourself.
        </p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setStarted(false)}>
          Cancel
        </button>
      </div>
      <ol className="flex flex-col gap-2.5">
        {paper.map((question, index) => (
          <li key={question.id} className="rounded-[var(--radius)] border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip num">Q{index + 1}</span>
              <span className="chip">{question.source === 'past_paper' ? 'Past paper' : 'Generated from notes'}</span>
              <span className="chip num">{question.marks ?? 5} marks</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{question.prompt}</p>
            <textarea
              rows={3}
              value={answers[question.id] ?? ''}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              placeholder="Your answer"
              className="input mt-2 w-full resize-y text-[13px]"
            />
            {submitted && (
              <div className="mt-2 rounded-[var(--radius)] border border-border bg-panel p-2.5">
                {question.answerMd !== null && (
                  <details className="text-[12.5px]">
                    <summary className="cursor-pointer select-none font-medium">Model answer</summary>
                    <div className="mt-1">
                      <Markdown content={question.answerMd} />
                    </div>
                  </details>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] text-text-muted">Mark:</span>
                  {(['correct', 'partial', 'wrong'] as const).map((grade) => (
                    <button
                      key={grade}
                      type="button"
                      aria-pressed={grades[question.id] === grade}
                      onClick={() => setGrades((current) => ({ ...current, [question.id]: grade }))}
                      className={`btn btn-sm ${grades[question.id] === grade ? 'btn-primary' : 'btn-quiet'}`}
                    >
                      {grade === 'correct' ? 'Full' : grade === 'partial' ? 'Half' : 'Zero'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {!submitted ? (
        <button type="button" className="btn btn-primary btn-sm self-start" onClick={() => setSubmitted(true)}>
          Submit paper
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="num text-[13px]">
            {allGraded ? `${earned}/${totalMarks} marks` : 'Mark every question to finish.'}
          </p>
          <button type="button" className="btn btn-primary btn-sm" disabled={!allGraded || busy} onClick={() => void finish()}>
            {busy ? 'Saving...' : 'Save result'}
          </button>
        </div>
      )}
    </div>
  );
}
