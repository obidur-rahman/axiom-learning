'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Sparkles,
  Square,
  Volume2,
} from 'lucide-react';
import type { LessonAnimation } from '@axiom/data';
import type { LessonCheckQuestion, LessonSlide, LessonSlideKind } from '../lib/lesson-content';
import { setWindowFullscreen } from '../lib/fullscreen';
import { usePrefs } from '../lib/prefs';
import { toSpeechText, useSpeech } from '../lib/speech';
import { LessonAnimation as LessonAnimationView } from './lesson-animation';
import { Markdown } from './markdown';
import { SectionAsk } from './section-ask';

const KIND_LABEL: Record<LessonSlideKind, string> = {
  concept: 'Concept',
  steps: 'Process',
  compare: 'Compare',
  math: 'Equation',
  code: 'Code',
};

interface LessonDeckProps {
  courseId: string;
  title: string;
  slides: LessonSlide[];
  questions: LessonCheckQuestion[];
  answers: string[];
  onAnswer: (index: number, value: string) => void;
  shown: number[];
  onShowAnswer: (index: number) => void;
  /** Beat animations, indexed like slides; null where a beat has none. */
  animations?: (LessonAnimation | null)[];
}

export function LessonDeck({
  courseId,
  title,
  slides,
  questions,
  answers,
  onAnswer,
  shown,
  onShowAnswer,
  animations,
}: LessonDeckProps) {
  const prefs = usePrefs();
  const [index, setIndex] = useState(0);
  const [present, setPresent] = useState(false);
  const [playing, setPlaying] = useState(false);
  const { speaking, paused, supported, speak, stop, togglePause } = useSpeech();
  const playToken = useRef(0);
  const total = slides.length + (questions.length > 0 ? 1 : 0);
  const isQuiz = index >= slides.length;
  const slide = isQuiz ? undefined : slides[index];
  const animation = animations?.[index] ?? null;

  const narrationFor = useCallback(
    (at: number): string => {
      const learner = prefs.displayName.trim();
      if (at >= slides.length) {
        return [
          'Check yourself.',
          'Answer each question without looking, then reveal the model answer.',
          ...questions.map((question, questionIndex) => `Question ${questionIndex + 1}. ${question.prompt}`),
        ].join(' ');
      }
      const entry = slides[at];
      if (entry === undefined) return '';
      const opening = at === 0 && learner !== '' ? `Welcome, ${learner}. This lesson is ${title}.` : '';
      return [opening, entry.title, toSpeechText(entry.markdown), entry.takeaway ?? '']
        .filter((part) => part !== '')
        .join('. ');
    },
    [prefs.displayName, questions, slides, title],
  );

  const narrateAt = useCallback<(at: number, autoAdvance: boolean) => void>(
    (at, autoAdvance) => {
      const token = ++playToken.current;
      speak(narrationFor(at), () => {
        if (playToken.current !== token) return;
        if (!autoAdvance) return;
        if (at + 1 < total) {
          setIndex(at + 1);
          narrateAt(at + 1, true);
        } else {
          setPlaying(false);
        }
      });
    },
    [narrationFor, speak, total],
  );

  const stopPlaying = useCallback(() => {
    playToken.current += 1;
    setPlaying(false);
    stop();
  }, [stop]);

  const togglePlay = useCallback(() => {
    if (playing) {
      stopPlaying();
      return;
    }
    setPlaying(true);
    narrateAt(index, true);
  }, [playing, stopPlaying, narrateAt, index]);

  // Leaving the deck must not keep a voice running.
  useEffect(() => () => {
    playToken.current += 1;
    stop();
  }, [stop]);

  // Presenting takes the native window full screen; leaving restores it.
  useEffect(() => {
    if (!present) return;
    void setWindowFullscreen(true);
    return () => {
      void setWindowFullscreen(false);
    };
  }, [present]);

  /**
   * Narration controls. Pause holds the voice mid-sentence, Stop ends it, and
   * neither starts the slide over. Only one set is on screen at a time.
   */
  const speechButtons = (alwaysLabel: boolean) => {
    if (!supported) return null;
    if (playing) {
      return (
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={togglePause}
            title={paused ? 'Resume narration' : 'Pause narration'}
          >
            {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
            <span className={alwaysLabel ? '' : 'hidden sm:inline'}>{paused ? 'Resume' : 'Pause'}</span>
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={stopPlaying} title="Stop narration">
            <Square className="size-3.5" aria-hidden />
            <span className={alwaysLabel ? '' : 'hidden sm:inline'}>Stop</span>
          </button>
        </>
      );
    }
    return (
      <>
        {speaking ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={stop} title="Stop reading this slide">
            <Square className="size-3.5" aria-hidden />
            <span className={alwaysLabel ? '' : 'hidden sm:inline'}>Stop</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => narrateAt(index, false)}
            className="btn btn-ghost btn-sm"
            title="Read this slide aloud"
          >
            <Volume2 className="size-4" aria-hidden />
            <span className={alwaysLabel ? '' : 'hidden sm:inline'}>Listen</span>
          </button>
        )}
        <button
          type="button"
          onClick={togglePlay}
          className="btn btn-ghost btn-sm"
          title="Narrate the whole lesson and advance the slides"
        >
          <Play className="size-4" aria-hidden />
          <span className={alwaysLabel ? '' : 'hidden sm:inline'}>Play lesson</span>
        </button>
      </>
    );
  };

  const goTo = useCallback(
    (next: number) => {
      stopPlaying();
      setIndex(Math.max(0, Math.min(total - 1, next)));
    },
    [total, stopPlaying],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goTo(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        goTo(total - 1);
      } else if (event.key === 'Escape' && present) {
        setPresent(false);
        stop();
      }
    },
    [goTo, index, present, total, stop],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="lesson-deck">
        {!present && (
        <nav className="lesson-deck-nav" aria-label="Lesson slides">
          {slides.map((entry, slideIndex) => (
            <button
              key={`${entry.title}-${slideIndex}`}
              type="button"
              className="slide-nav-item"
              aria-current={slideIndex === index ? 'step' : undefined}
              onClick={() => goTo(slideIndex)}
            >
              <span className="slide-nav-index" aria-hidden>
                {slideIndex + 1}
              </span>
              <span className="slide-nav-label">{entry.title}</span>
            </button>
          ))}
          {questions.length > 0 && (
            <button
              type="button"
              className="slide-nav-item"
              aria-current={isQuiz ? 'step' : undefined}
              onClick={() => goTo(slides.length)}
            >
              <span className="slide-nav-index" aria-hidden>
                ✦
              </span>
              <span className="slide-nav-label">Check yourself</span>
            </button>
          )}
        </nav>
        )}

        <section
          className="lesson-stage"
          data-index={String(index + 1).padStart(2, '0')}
          data-present={present ? 'true' : undefined}
          aria-roledescription="carousel"
          aria-label={`${title} slides`}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {present && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <p className="text-[15px] font-medium">{title}</p>
              <div className="flex items-center gap-1.5">{speechButtons(true)}
                <button
                  type="button"
                  onClick={() => goTo(index - 1)}
                  disabled={index === 0}
                  className="btn btn-ghost btn-sm"
                  aria-label="Previous slide"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => goTo(index + 1)}
                  disabled={index >= total - 1}
                  className="btn btn-ghost btn-sm"
                  aria-label="Next slide"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setPresent(false);
                    stop();
                  }}
                >
                  <Minimize2 className="size-4" aria-hidden />
                  Exit
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="slide-kind">{isQuiz ? 'Check yourself' : KIND_LABEL[slide?.kind ?? 'concept']}</span>
            {!present && (
              <div className="flex items-center gap-1.5">{speechButtons(false)}
                <button
                  type="button"
                  onClick={() => setPresent((value) => !value)}
                  className="btn btn-primary"
                  aria-pressed={present}
                  title="Present this lesson full screen"
                >
                  <Maximize2 className="size-4" aria-hidden />
                  Present
                </button>
              </div>
            )}
          </div>

          {isQuiz ? (
            <>
              <h2 className="slide-title">Check yourself</h2>
              <p className="mt-2 max-w-[64ch] text-[15px] leading-relaxed text-text-muted">
                Answer without looking, then reveal each model answer. If you can do all three, mark the topic known
                in Progress.
              </p>
              <div className="slide-quiz-list">
                {questions.map((question, questionIndex) => (
                  <div key={questionIndex} className="slide-quiz-item">
                    <div className="flex items-start gap-3">
                      <span className="slide-nav-index mt-0.5 flex-none" aria-hidden>
                        {questionIndex + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Markdown content={question.prompt} compact />
                        <textarea
                          rows={2}
                          value={answers[questionIndex] ?? ''}
                          onChange={(event) => onAnswer(questionIndex, event.target.value)}
                          placeholder="Type your answer, or think it through..."
                          className="input mt-2 min-h-[64px] resize-y"
                        />
                        {shown.includes(questionIndex) && (
                          <div className="slide-quiz-answer" aria-live="polite">
                            <span className="mr-1 text-[12px] font-semibold uppercase tracking-wide text-text-muted">
                              Answer
                            </span>
                            <Markdown content={question.answer} compact className="inline-block" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => onShowAnswer(questionIndex)}
                          className="mt-2 text-[13px] font-medium text-accent underline-offset-4 hover:underline"
                        >
                          {shown.includes(questionIndex) ? 'Answer shown' : 'Show answer'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2 className="slide-title">{slide?.title}</h2>
              {slide !== undefined && slide.markdown !== '' && (
                <div className="slide-body">
                  <Markdown content={slide.markdown} />
                </div>
              )}
              {slide?.takeaway !== null && slide?.takeaway !== undefined && (
                <p className="slide-secondary">
                  <span className="font-semibold text-accent">Key idea</span> · {slide.takeaway}
                </p>
              )}
              {animation !== null && (
                <div className="mt-3">
                  <LessonAnimationView animation={animation} />
                </div>
              )}
              {!present && slide !== undefined && (
                <div className="mt-3">
                  <SectionAsk
                    key={`ask-${index}`}
                    courseId={courseId}
                    sectionTitle={slide.title}
                    sectionText={slide.markdown}
                  />
                </div>
              )}
            </>
          )}

          <div className="deck-controls">
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="btn btn-ghost btn-sm"
            >
              <ChevronLeft className="size-4" aria-hidden />
              <span className="hidden sm:inline">Previous</span>
            </button>

            <div className="deck-progress">
              <span className="num whitespace-nowrap text-[13px] text-text-muted">
                {index + 1} / {total}
              </span>
              <div
                className="deck-progress-track"
                role="progressbar"
                aria-label="Lesson progress"
                aria-valuemin={1}
                aria-valuemax={Math.max(1, total)}
                aria-valuenow={index + 1}
              >
                <div
                  className="deck-progress-fill"
                  style={{ width: `${total === 0 ? 0 : ((index + 1) / total) * 100}%` }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => goTo(index + 1)}
              disabled={index >= total - 1}
              className="btn btn-primary btn-sm"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>

          {!present && (
            <p className="mt-2 text-center text-[12.5px] text-text-muted">
              <Sparkles className="mr-1 inline size-3 align-[-1px]" aria-hidden />
              Use the arrow keys to move through the lesson.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
