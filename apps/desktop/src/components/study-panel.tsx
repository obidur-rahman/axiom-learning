'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildStudyPlan,
  type PlanAttempt,
  type PlanQuestion,
  type PlanTopic,
  type StudyItem,
} from '@axiom/engine';
import {
  enqueue,
  ensureStudySettings,
  listAttempts,
  listProgress,
  listQuestions,
  loadLatestRoadmap,
  saveAttempt,
  saveStudySettings,
  type CourseStudySettings,
  type ExamQuestion,
  type StudyProfile,
} from '@axiom/data';
import { BookOpen, CheckCircle2, CircleHelp, ListChecks, RefreshCw, XCircle } from 'lucide-react';
import { getDb } from '../lib/db';
import { onAppEvent } from '../lib/events';
import { MockExam } from './mock-exam';
import { QuestionReview } from './question-review';

const PROFILE_LABEL: Record<StudyProfile, string> = {
  past_first: 'Past questions first',
  notes_first: 'Notes first',
  adaptive: 'Adaptive mix',
};

const PROFILE_OPTIONS: { value: StudyProfile; label: string }[] = [
  { value: 'past_first', label: 'Past questions first' },
  { value: 'notes_first', label: 'Notes first' },
  { value: 'adaptive', label: 'Adaptive mix' },
];

interface StudyData {
  settings: CourseStudySettings;
  plan: ReturnType<typeof buildStudyPlan>;
  questions: ExamQuestion[];
  topicTitles: Record<string, string>;
  firstTopicId: string | null;
  pastMaterialCount: number;
  noteMaterialCount: number;
}

function daysLabel(days: number | null): string {
  if (days === null) return 'No exam date';
  if (days === 0) return 'Exam today';
  return `${days} day${days === 1 ? '' : 's'} to the exam`;
}

function sourceLabel(item: StudyItem): string {
  if (item.source === 'past_paper') return 'Past paper';
  if (item.source === 'generated') return 'Generated from notes';
  if (item.source === 'mock') return 'Mock exam';
  return 'From your notes';
}

export function StudyPanel({ courseId, examDate }: { courseId: string; examDate: string | null }) {
  const [data, setData] = useState<StudyData | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<{ item: StudyItem; question: ExamQuestion | null } | null>(null);
  const [attempt, setAttempt] = useState('');
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    const db = await getDb();
    const [settings, questions, roadmap, progress, attempts, lessons, materialRows] = await Promise.all([
      ensureStudySettings(db.driver, courseId),
      listQuestions(db.driver, courseId),
      loadLatestRoadmap(db.driver, courseId),
      listProgress(db.driver, courseId),
      listAttempts(db.driver, courseId),
      db.driver.select<{ topic_id: string | null; id: string }>(
        `SELECT topic_id, id FROM lessons
         WHERE course_id = $1 AND status = 'active' AND language = 'mixed'
         ORDER BY CASE depth WHEN 'core' THEN 0 ELSE 1 END, created_at DESC`,
        [courseId],
      ),
      db.driver.select<{ kind: string; c: number }>(
        'SELECT kind, COUNT(*) AS c FROM materials WHERE course_id = $1 GROUP BY kind',
        [courseId],
      ),
    ]);

    const activeLesson = new Map<string, string>();
    for (const row of lessons) {
      if (row.topic_id !== null && !activeLesson.has(row.topic_id)) activeLesson.set(row.topic_id, row.id);
    }
    const progressMap = new Map(progress.map((row) => [row.topicId, row.status]));
    const nodeByTopic = new Map(roadmap?.roadmap.nodes.map((node) => [node.id, node]) ?? []);

    const topicRows = await db.driver.select<{ id: string; title: string; syllabus_order: number | null }>(
      'SELECT id, title, syllabus_order FROM topics WHERE course_id = $1 ORDER BY COALESCE(syllabus_order, 999999), created_at',
      [courseId],
    );

    const topics: PlanTopic[] = topicRows.map((row, index) => {
      const node = nodeByTopic.get(row.id);
      const status = progressMap.get(row.id) ?? 'not_started';
      return {
        id: row.id,
        title: row.title,
        weight: node?.weight ?? 0.05,
        order: node?.order ?? row.syllabus_order ?? index,
        type: node?.type ?? 'core',
        progress:
          status === 'known' ? 'known' : status === 'done' ? 'done' : status === 'in_progress' ? 'in_progress' : 'not_started',
        lessonId: activeLesson.get(row.id) ?? null,
      };
    });

    const planQuestions: PlanQuestion[] = questions
      .filter((question) => question.status === 'confirmed')
      .map((question) => ({
        id: question.id,
        topicIds: question.topicIds.length > 0 ? question.topicIds : question.topicId === null ? [] : [question.topicId],
        source: question.source,
        difficulty: question.difficulty,
        year: question.year,
        marks: question.marks,
        status: question.status,
      }));

    const planAttempts: PlanAttempt[] = attempts.map((row) => ({
      questionId: row.questionId,
      topicId: row.topicId,
      itemKind: row.itemKind,
      result: row.result,
      score: row.score,
      completedAt: row.completedAt,
    }));

    const plan = buildStudyPlan({
      profile: settings.profile,
      dailyMinutes: settings.dailyMinutes,
      examDate,
      topics,
      questions: planQuestions,
      attempts: planAttempts,
      now: new Date().toISOString(),
    });

    const materialCount = (kind: string) =>
      materialRows.filter((row) => row.kind === kind).reduce((total, row) => total + Number(row.c), 0);

    setData({
      settings,
      plan,
      questions,
      topicTitles: Object.fromEntries(topicRows.map((row) => [row.id, row.title])),
      firstTopicId: topicRows[0]?.id ?? null,
      pastMaterialCount: materialCount('past_questions'),
      noteMaterialCount: materialCount('notes') + materialCount('syllabus') + materialCount('textbook'),
    });
  }, [courseId, examDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.kind === 'worker-tick') return;
        if (event.courseId !== courseId) return;
        if (event.kind === 'job-updated') {
          if (event.status === 'running') {
            setBusy(true);
            setMessage(
              event.jobKind === 'extract_past_questions'
                ? 'Reading the past paper...'
                : event.jobKind === 'generate_questions'
                  ? 'Writing questions from your notes...'
                  : '',
            );
          }
          if (event.status === 'done' || event.status === 'failed') {
            setBusy(false);
            setMessage(event.status === 'failed' ? (event.error ?? 'The job failed.') : '');
            void load();
          }
        }
      }),
    [courseId, load],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Pick<CourseStudySettings, 'profile' | 'dailyMinutes' | 'hasPastPapers'>>) => {
      const db = await getDb();
      await saveStudySettings(db.driver, courseId, patch);
      await load();
    },
    [courseId, load],
  );

  const runJob = useCallback(
    async (kind: 'extract_past_questions' | 'generate_questions') => {
      setBusy(true);
      setMessage(kind === 'extract_past_questions' ? 'Reading the past paper...' : 'Writing questions from your notes...');
      try {
        const db = await getDb();
        await enqueue(db.driver, kind, { courseId });
      } catch (error) {
        setBusy(false);
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [courseId],
  );

  const startItem = useCallback(
    (item: StudyItem) => {
      if (item.kind === 'lesson') return;
      const question =
        item.kind === 'question'
          ? data?.questions.find((candidate) => candidate.id === item.refId) ?? null
          : null;
      setActive({ item, question });
      setAttempt('');
      setRevealed(false);
    },
    [data],
  );

  const grade = useCallback(
    async (result: 'correct' | 'partial' | 'wrong' | 'skipped') => {
      if (active === null) return;
      const db = await getDb();
      await saveAttempt(db.driver, {
        courseId,
        itemKind: active.item.kind,
        questionId: active.item.kind === 'question' ? active.item.refId : null,
        topicId: active.item.topicId,
        lessonId: active.item.kind === 'lesson' ? active.item.refId : null,
        result,
        score: result === 'correct' ? 1 : result === 'partial' ? 0.5 : 0,
        maxScore: 1,
        confidence: null,
        durationSeconds: null,
        meta: { title: active.item.title },
        startedAt: null,
      });
      setActive(null);
      setAttempt('');
      setRevealed(false);
      await load();
    },
    [active, courseId, load],
  );

  const questionById = useMemo(
    () => new Map((data?.questions ?? []).map((question) => [question.id, question])),
    [data],
  );
  const drafts = useMemo(
    () => (data?.questions ?? []).filter((question) => question.status === 'draft'),
    [data],
  );
  const confirmed = useMemo(
    () => (data?.questions ?? []).filter((question) => question.status === 'confirmed'),
    [data],
  );
  const generatedCount = confirmed.filter((question) => question.source === 'generated').length;
  const pastCount = confirmed.filter((question) => question.source === 'past_paper').length;
  const patterns = useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of confirmed) {
      if (question.source !== 'past_paper' || question.patternLabel === null) continue;
      counts.set(question.patternLabel, (counts.get(question.patternLabel) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [confirmed]);
  const ladder = useMemo(() => {
    const groups = new Map<string, ExamQuestion[]>();
    for (const question of confirmed) {
      const key = question.topicId ?? question.topicIds[0] ?? 'unlinked';
      const list = groups.get(key) ?? [];
      list.push(question);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([topicId, list]) => ({
      topicId,
      title: topicId === 'unlinked' ? 'Unlinked questions' : (data?.topicTitles[topicId] ?? 'Topic'),
      questions: [...list].sort((a, b) => a.difficulty - b.difficulty || (a.year ?? 0) - (b.year ?? 0)),
    }));
  }, [confirmed, data]);

  if (data === null) {
    return (
      <div aria-live="polite">
        <div className="skeleton h-6 w-56" />
        <div className="skeleton mt-3 h-3 w-72" />
        <div className="skeleton mt-4 h-24 w-full" />
      </div>
    );
  }

  const { settings, plan } = data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Today’s study plan</h2>
          <p className="mt-1 text-[12.5px] text-text-muted">
            {daysLabel(plan.daysUntilExam)} · {settings.dailyMinutes} min planned · {PROFILE_LABEL[settings.profile]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="field">
            <span className="text-[11px]">Study style</span>
            <select
              value={settings.profile}
              onChange={(event) => void updateSettings({ profile: event.target.value as StudyProfile })}
              className="input"
            >
              {PROFILE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field w-[120px]">
            <span className="text-[11px]">Minutes/day</span>
            <input
              type="number"
              min={15}
              max={240}
              step={5}
              value={settings.dailyMinutes}
              onChange={(event) => void updateSettings({ dailyMinutes: Number(event.target.value) })}
              className="input"
            />
          </label>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <span className="chip num">
          {plan.coverage.pastQuestionsDone}/{plan.coverage.pastQuestionsTotal} past questions done
        </span>
        <span className="chip num">
          {plan.coverage.topicsTaught}/{plan.coverage.topicsTotal} topics taught
        </span>
        <span className="chip num">{pastCount} confirmed past</span>
        <span className="chip num">{generatedCount} generated</span>
        {drafts.length > 0 && <span className="chip num">{drafts.length} drafts to review</span>}
      </div>

      {message !== '' && (
        <p className="text-[13px] text-text-muted" aria-live="polite">
          {message}
        </p>
      )}

      {plan.items.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border-strong bg-surface p-5">
          <p className="text-[14px] font-medium">Nothing to study yet</p>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-text-muted">
            {data.pastMaterialCount > 0
              ? 'Extract the past paper into questions, then review and confirm them here.'
              : data.noteMaterialCount > 0
                ? 'No past papers needed. Generate questions from your notes and start with a teaching lesson.'
                : 'Add notes, a syllabus or a past paper in the Material tab first.'}
          </p>
          {data.firstTopicId !== null && (
            <button
              type="button"
              className="btn btn-ghost btn-sm mt-3"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setMessage('Building the first teaching lesson...');
                  const db = await getDb();
                  await enqueue(db.driver, 'build_lesson', {
                    courseId,
                    payload: { topicId: data.firstTopicId, depth: 'core' },
                  });
                })()
              }
            >
              <BookOpen className="size-3.5" aria-hidden />
              Build the first lesson
            </button>
          )}
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {plan.items.map((item) => {
            const question = item.kind === 'question' ? questionById.get(item.refId) ?? null : null;
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-surface px-3.5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="chip">{sourceLabel(item)}</span>
                    <span className="chip num">{item.estimatedMinutes} min</span>
                    {item.difficulty !== null && <span className="chip num">Level {item.difficulty}/5</span>}
                    {item.kind === 'question' && question?.year !== null && question?.year !== undefined && (
                      <span className="chip num">{question.year}</span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13.5px] font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[12px] text-text-muted">{item.reason}</p>
                </div>
                {item.kind === 'lesson' ? (
                  <Link href={`/course?id=${courseId}&tab=lessons`} className="btn btn-ghost btn-sm shrink-0">
                    <BookOpen className="size-3.5" aria-hidden />
                    Open lesson
                  </Link>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={() => startItem(item)}>
                    Start
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {active !== null && (
        <section className="rounded-[var(--radius-card)] border border-accent/40 bg-panel p-4" aria-labelledby="practice-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="practice-heading" className="text-[15px] font-semibold">
              {active.item.kind === 'recall' ? active.item.title : 'Try this question'}
            </h3>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setActive(null)}>
              Close
            </button>
          </div>
          {active.question !== null ? (
            <>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="chip">{sourceLabel(active.item)}</span>
                {active.question.marks !== null && <span className="chip num">{active.question.marks} marks</span>}
                {active.question.patternLabel !== null && <span className="chip">{active.question.patternLabel}</span>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{active.question.prompt}</p>
            </>
          ) : (
            <p className="mt-2 text-[13.5px] leading-relaxed">
              Without looking back, explain <strong>{active.item.title.replace(/^Recall: /, '')}</strong> in your own
              words. Write the key steps, then check your notes.
            </p>
          )}
          <label className="field mt-3">
            <span>Your answer (optional)</span>
            <textarea
              rows={4}
              value={attempt}
              onChange={(event) => setAttempt(event.target.value)}
              placeholder="Work it out here, or on paper and just grade yourself."
              className="input resize-y"
            />
          </label>
          {active.question?.answerMd !== null && active.question?.answerMd !== undefined && (
            <div className="mt-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevealed((shown) => !shown)}>
                {revealed ? 'Hide model answer' : 'Show model answer'}
              </button>
              {revealed && (
                <p className="mt-2 whitespace-pre-wrap rounded-[var(--radius)] border border-border bg-surface p-3 text-[13px] leading-relaxed">
                  {active.question.answerMd}
                </p>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-text-muted">How did it go?</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void grade('correct')}>
              <CheckCircle2 className="size-3.5" aria-hidden /> Got it
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void grade('partial')}>
              <CircleHelp className="size-3.5" aria-hidden /> Partly
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void grade('wrong')}>
              <XCircle className="size-3.5" aria-hidden /> Missed it
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void grade('skipped')}>
              Skip
            </button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {data.pastMaterialCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void runJob('extract_past_questions')}
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            Extract past-paper questions
          </button>
        )}
        {data.noteMaterialCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void runJob('generate_questions')}
          >
            <ListChecks className="size-3.5" aria-hidden />
            Generate questions from notes
          </button>
        )}
      </div>

      <QuestionReview courseId={courseId} onChanged={() => void load()} />

      {confirmed.length > 0 && (
        <section aria-labelledby="mock-heading">
          <h3 id="mock-heading" className="section-title">
            Mock exam
          </h3>
          <div className="mt-2 rounded-[var(--radius)] border border-border bg-surface p-3">
            <MockExam courseId={courseId} questions={confirmed} onFinished={() => void load()} />
          </div>
        </section>
      )}

      {(pastCount > 0 || generatedCount > 0) && (
        <section aria-labelledby="ladder-heading">
          <div className="flex items-center justify-between gap-2">
            <h3 id="ladder-heading" className="section-title">
              Question ladder
            </h3>
            <span className="text-[11.5px] text-text-muted">Easiest to hardest</span>
          </div>
          <div className="mt-2 flex flex-col gap-3">
            {ladder.map((group) => (
              <div key={group.topicId}>
                <p className="text-[11px] uppercase tracking-[0.1em] text-text-muted">
                  {group.title}
                </p>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {group.questions.map((question) => (
                    <li
                      key={question.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-[13px]">{question.prompt}</p>
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          <span className={`chip ${question.source === 'generated' ? 'text-warning' : ''}`}>
                            {question.source === 'past_paper'
                              ? `Past paper${question.year === null ? '' : ` ${question.year}`}`
                              : 'Generated from notes - not a past paper'}
                          </span>
                          <span className="chip num">Level {question.difficulty}/5</span>
                          {question.marks !== null && <span className="chip num">{question.marks} marks</span>}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm shrink-0"
                        onClick={() =>
                          startItem({
                            id: `question:${question.id}:0`,
                            kind: 'question',
                            refId: question.id,
                            topicId: question.topicId,
                            title: `Question for ${question.patternLabel ?? 'this topic'}`,
                            reason: question.source === 'past_paper' ? 'Past paper' : 'Generated from notes',
                            estimatedMinutes: 8,
                            difficulty: question.difficulty,
                            source: question.source,
                          })
                        }
                      >
                        Study
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {patterns.length > 0 && (
        <section aria-labelledby="patterns-heading">
          <h3 id="patterns-heading" className="section-title">
            Repeated question patterns
          </h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {patterns.map(([label, count]) => (
              <li key={label} className="chip">
                {label} · asked {count}×
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.pastMaterialCount === 0 && (
        <p className="rounded-[var(--radius)] border border-warning/40 bg-surface px-3.5 py-2.5 text-[12.5px] text-warning">
          No past papers for this course. Questions are generated from your notes and labelled that way - never shown as
          real past-paper statistics.
        </p>
      )}
    </div>
  );
}
