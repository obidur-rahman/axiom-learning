'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  enqueue,
  flagLesson,
  getActiveLesson,
  getLessonDocument,
  type Lesson,
  type LessonDocument,
} from '@axiom/data';
import { BookOpen, Layers, ListTree, RefreshCw } from 'lucide-react';
import { getDb } from '../lib/db';
import { onAppEvent } from '../lib/events';
import { parseLessonContent } from '../lib/lesson-content';
import { loadPrefs, usePrefs } from '../lib/prefs';
import { listTopicOptions, type TopicOption } from '../lib/topics';
import { LessonBoard } from './lesson-board';
import { LessonDeck } from './lesson-deck';
import { Markdown } from './markdown';
import { ProgressBar } from './progress-bar';

/** One topic option in the lesson picker. */
/**
 * Lessons + diagnostic (FR-040..FR-057): one topic at a time. A saved lesson
 * becomes a designed slide deck with a key-idea footer, a final check-yourself
 * slide and a read-all fallback.
 */
export function LessonsPanel({ courseId }: { courseId: string }) {
  const prefs = usePrefs();
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [topicId, setTopicId] = useState('');
  const [depth, setDepth] = useState<'core' | 'bridge'>('core');
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [document, setDocument] = useState<LessonDocument | null>(null);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [shown, setShown] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [view, setView] = useState<'board' | 'slides' | 'read'>('board');
  const params = useSearchParams();
  const requestedTopic = params.get('topic');

  const loadLesson = useCallback(async (target: string, forDepth: string) => {
    if (target === '') return;
    const db = await getDb();
    const loaded = await getActiveLesson(db.driver, target, 'mixed', forDepth);
    setLesson(loaded);
    setDocument(loaded === null ? null : await getLessonDocument(db.driver, loaded.id));
  }, []);

  useEffect(() => {
    void (async () => {
      // Read the saved default on the client: the static HTML has no storage.
      const initialDepth = loadPrefs().defaultLessonDepth;
      setDepth(initialDepth);
      const db = await getDb();
      const options = await listTopicOptions(db.driver, courseId);
      setTopics(options);
      const first =
        (requestedTopic !== null && options.some((topic) => topic.id === requestedTopic)
          ? requestedTopic
          : options[0]?.id) ?? '';
      setTopicId(first);
      await loadLesson(first, initialDepth);
    })();
  }, [courseId, loadLesson, requestedTopic]);

  useEffect(() => {
    setView(loadPrefs().lessonFormat === 'read' ? 'read' : loadPrefs().lessonFormat === 'slides' ? 'slides' : 'board');
    setAnswers(['', '', '']);
    setShown([]);
  }, [lesson?.id]);

  useEffect(
    () =>
      onAppEvent((event) => {
        if (event.kind === 'lesson-ready' && event.courseId === courseId && event.topicId === topicId) {
          void loadLesson(topicId, depth);
        }
        // Slides are saved one at a time; show each as it lands.
        if (event.kind === 'lesson-progress' && event.courseId === courseId && event.topicId === topicId) {
          void loadLesson(topicId, depth);
        }
        if (
          event.kind === 'job-progress' &&
          event.jobKind === 'build_lesson' &&
          event.courseId === courseId
        ) {
          setProgress({ percent: event.percent, message: event.message });
        }
        if (event.kind === 'job-updated' && event.jobKind === 'build_lesson') {
          if (event.status === 'failed') {
            setMessage(`Lesson failed: ${event.error ?? 'unknown error'}`);
            setProgress(null);
          } else if (event.status === 'done') {
            setMessage('');
            setProgress(null);
          } else if (event.status === 'running') {
            setMessage('Building the lesson...');
            setProgress({ percent: 2, message: 'Starting the lesson build' });
          }
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

  const parsed = useMemo(
    () => (lesson === null ? null : parseLessonContent(lesson.contentMd)),
    [lesson],
  );
  const slides = parsed?.slides ?? [];
  const questions = parsed?.checkQuestions ?? [];
  const activeTopic = topics.find((topic) => topic.id === topicId);
  const citationPages = useMemo(() => {
    if (lesson?.citations === null || lesson?.citations === undefined) return [];
    const pages = (lesson.citations as { page?: number }[])
      .map((citation) => citation.page)
      .filter((page): page is number => typeof page === 'number');
    return [...new Set(pages)];
  }, [lesson]);

  const setAnswer = useCallback((index: number, value: string) => {
    setAnswers((current) => current.map((answer, answerIndex) => (answerIndex === index ? value : answer)));
  }, []);

  const showAnswer = useCallback((index: number) => {
    setShown((current) => (current.includes(index) ? current : [...current, index]));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-border bg-surface p-2.5 lg:flex-row lg:items-end">
        <label className="field min-w-0 flex-1">
          <span className="text-[11.5px] font-medium">Topic</span>
          <select
            value={topicId}
            onChange={(event) => {
              setTopicId(event.target.value);
              void loadLesson(event.target.value, depth);
            }}
            className="input"
          >
            {topics.length === 0 && <option value="">No topics yet</option>}
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field lg:w-[170px]">
          <span className="text-[11.5px] font-medium">Depth</span>
          <select
            value={depth}
            onChange={(event) => {
              const next = event.target.value as 'core' | 'bridge';
              setDepth(next);
              void loadLesson(topicId, next);
            }}
            className="input"
          >
            <option value="core">Full lesson</option>
            <option value="bridge">Quick recap</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={topicId === '' || busy}
          className="btn btn-primary lg:mb-px"
        >
          <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} aria-hidden />
          {busy ? 'Building...' : lesson === null ? 'Generate lesson' : 'Regenerate'}
        </button>
      </div>

      {progress !== null && (
        <div className="rounded-[var(--radius)] border border-border bg-surface p-3.5" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13.5px] font-medium">{progress.message}...</p>
            <span className="num text-[12.5px] text-text-muted">{progress.percent}%</span>
          </div>
          <ProgressBar label={progress.message} value={progress.percent} className="mt-2" />
          <p className="mt-2 text-[12.5px] text-text-muted">
            You can switch tabs while this runs - the lesson keeps building in the background.
          </p>
        </div>
      )}

      {message !== '' && (
        <p className="text-[13px] text-text-muted" aria-live="polite">
          {message}
        </p>
      )}

      {lesson !== null && parsed !== null && (
        <div className="flex flex-col gap-3.5">
          {lesson.isGeneralContent && (
            <p className="rounded-[var(--radius)] border border-warning/40 bg-surface px-3.5 py-2.5 text-[13px] text-warning">
              This lesson uses general knowledge - not grounded in your uploaded material.
            </p>
          )}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">
                {activeTopic?.title ?? parsed.title}
              </h2>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="chip">{depth === 'core' ? 'Full lesson' : 'Quick recap'}</span>
                <span className="chip">
                  {document === null
                    ? `${slides.length} slides`
                    : document.plannedBeats !== undefined && document.beats.length < document.plannedBeats
                      ? `${document.beats.length} of ${document.plannedBeats} slides`
                      : `${document.beats.length} teaching beats`}
                </span>
                {questions.length > 0 && <span className="chip">{questions.length} check questions</span>}
              </p>
            </div>

            <div
              className="flex items-center gap-1 rounded-[var(--radius)] border border-border bg-surface p-1"
              role="group"
              aria-label="Lesson view"
            >
              <button
                type="button"
                aria-pressed={view === 'board'}
                onClick={() => setView('board')}
                className={`inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  view === 'board' ? 'bg-accent text-accent-contrast' : 'text-text-muted hover:text-text'
                }`}
              >
                <ListTree className="size-3.5" aria-hidden />
                Board
              </button>
              <button
                type="button"
                aria-pressed={view === 'slides'}
                onClick={() => setView('slides')}
                className={`inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  view === 'slides' ? 'bg-accent text-accent-contrast' : 'text-text-muted hover:text-text'
                }`}
              >
                <Layers className="size-3.5" aria-hidden />
                Slides
              </button>
              <button
                type="button"
                aria-pressed={view === 'read'}
                onClick={() => setView('read')}
                className={`inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  view === 'read' ? 'bg-accent text-accent-contrast' : 'text-text-muted hover:text-text'
                }`}
              >
                <BookOpen className="size-3.5" aria-hidden />
                Read all
              </button>
            </div>
          </div>

          {document !== null &&
            document.plannedBeats !== undefined &&
            document.beats.length < document.plannedBeats && (
              <p className="text-[12.5px] text-text-muted" aria-live="polite">
                {document.beats.length === 0
                  ? `Planning ${document.plannedBeats} slides...`
                  : `Slide ${document.beats.length} of ${document.plannedBeats} ready - the rest keep writing while you read.`}
              </p>
            )}

          {view === 'board' && document !== null ? (
            <LessonBoard
              key={lesson.id}
              courseId={courseId}
              document={document}
              onRegenerate={() => void generate()}
              busy={busy}
            />
          ) : view === 'slides' ? (
            <LessonDeck
              key={lesson.id}
              courseId={courseId}
              title={activeTopic?.title ?? parsed.title}
              slides={slides}
              questions={questions}
              answers={answers}
              onAnswer={setAnswer}
              shown={shown}
              onShowAnswer={showAnswer}
            />
          ) : (
            <article className="rounded-[var(--radius-card)] border border-border bg-panel p-5 sm:p-6">
              {view === 'board' && <p className="mb-3 text-[12.5px] text-text-muted">This saved lesson uses the older slide format.</p>}
              <Markdown content={parsed.readMarkdown} />
            </article>
          )}

          {prefs.showCitationPages && citationPages.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-text-muted">Sources</span>
              {citationPages.map((page) => (
                <span key={page} className="chip num">
                  p.{page}
                </span>
              ))}
            </div>
          )}

          <button onClick={() => void flag()} className="btn btn-danger btn-sm self-start">
            This lesson is wrong - flag it
          </button>
        </div>
      )}

      {lesson === null && topics.length > 0 && message === '' && (
        <div className="rounded-[var(--radius)] border border-dashed border-border-strong bg-surface p-5">
          <p className="text-[14px] font-medium">No lesson for this topic yet</p>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-text-muted">
            Press Generate. Axiom builds a guided teaching board from your material - explanations, a worked example,
            recall and exam-answer shape - plus check questions. Old lessons still open as slides.
          </p>
        </div>
      )}
    </div>
  );
}
