'use client';

import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Sparkles } from 'lucide-react';
import type { LessonCheckQuestion, LessonSlide, LessonSlideKind } from '../lib/lesson-content';
import { Markdown } from './markdown';

const KIND_LABEL: Record<LessonSlideKind, string> = {
  concept: 'Concept',
  steps: 'Process',
  compare: 'Compare',
  math: 'Equation',
  code: 'Code',
};

interface LessonDeckProps {
  title: string;
  slides: LessonSlide[];
  questions: LessonCheckQuestion[];
  answers: string[];
  onAnswer: (index: number, value: string) => void;
  shown: number[];
  onShowAnswer: (index: number) => void;
}

export function LessonDeck({
  title,
  slides,
  questions,
  answers,
  onAnswer,
  shown,
  onShowAnswer,
}: LessonDeckProps) {
  const [index, setIndex] = useState(0);
  const [present, setPresent] = useState(false);
  const total = slides.length + (questions.length > 0 ? 1 : 0);
  const isQuiz = index >= slides.length;
  const slide = isQuiz ? undefined : slides[index];

  const goTo = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(total - 1, next))),
    [total],
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
      }
    },
    [goTo, index, present, total],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="lesson-deck">
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

        <section
          className="lesson-stage"
          data-index={String(index + 1).padStart(2, '0')}
          data-present={present ? 'true' : undefined}
          aria-roledescription="carousel"
          aria-label={`${title} slides`}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="slide-kind">{isQuiz ? 'Check yourself' : KIND_LABEL[slide?.kind ?? 'concept']}</span>
            <button
              type="button"
              onClick={() => setPresent((value) => !value)}
              className="btn btn-quiet btn-sm -mt-1 -mr-1"
              aria-pressed={present}
              title={present ? 'Exit presentation (Esc)' : 'Present this slide'}
            >
              {present ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
              <span className="hidden sm:inline">{present ? 'Exit' : 'Present'}</span>
            </button>
          </div>

          {isQuiz ? (
            <>
              <h2 className="slide-title">Check yourself</h2>
              <p className="mt-2 max-w-[64ch] text-[14.5px] leading-relaxed text-text-muted">
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
                          className="mt-2 text-[12.5px] font-medium text-accent underline-offset-4 hover:underline"
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
              <span className="num whitespace-nowrap text-[12.5px] text-text-muted">
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

          <p className="mt-2 text-center text-[12px] text-text-muted">
            <Sparkles className="mr-1 inline size-3 align-[-1px]" aria-hidden />
            Use the arrow keys to move through the lesson.
          </p>
        </section>
      </div>
    </div>
  );
}
