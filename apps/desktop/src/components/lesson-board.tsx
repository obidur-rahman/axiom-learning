'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonBlock, LessonDocument } from '@axiom/data';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Lightbulb,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Target,
  Volume2,
} from 'lucide-react';
import { setWindowFullscreen } from '../lib/fullscreen';
import { useSpeech } from '../lib/speech';
import { LessonAnimation } from './lesson-animation';
import { Markdown } from './markdown';
import { SectionAsk } from './section-ask';

/** Flat text of one beat, for narration and for the section-scoped ask box. */
function beatText(beat: { title: string; intro: string; blocks: LessonBlock[]; takeaway: string | null }): string {
  const parts = [beat.title, beat.intro];
  for (const block of beat.blocks) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'steps') parts.push(block.items.join('. '));
    else if (block.type === 'callout') parts.push(block.text);
    else if (block.type === 'equation') parts.push(block.latex);
    else if (block.type === 'compare') parts.push(block.rows.map((row) => row.join(', ')).join('. '));
  }
  if (beat.takeaway !== null) parts.push(beat.takeaway);
  return parts.filter((part) => part !== '').join('. ');
}

/**
 * Blocks carry Markdown and LaTeX from the model, so every text cell renders
 * through Markdown instead of printing raw `**bold**`, tables or maths.
 * `large` scales the same blocks up for presentation.
 */
function BlockView({ block, large = false }: { block: LessonBlock; large?: boolean }) {
  switch (block.type) {
    case 'text':
      return (
        <Markdown
          content={block.text}
          compact={!large}
          className={large ? 'text-[17px]' : undefined}
        />
      );
    case 'steps':
      return (
        <ol className="flex flex-col gap-2">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-2.5">
              <span
                className={`num mt-0.5 flex shrink-0 items-center justify-center rounded-full border border-border bg-surface font-medium ${
                  large ? 'size-6 text-[12px]' : 'size-5 text-[11px]'
                }`}
              >
                {index + 1}
              </span>
              <Markdown
                content={item}
                compact={!large}
                className={`min-w-0 flex-1 ${large ? 'text-[16.5px]' : ''}`}
              />
            </li>
          ))}
        </ol>
      );
    case 'compare':
      return (
        <div className="overflow-x-auto">
          <table className={`w-full border-collapse ${large ? 'text-[15px]' : 'text-[13px]'}`}>
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th key={column} className="border border-border bg-surface px-2.5 py-1.5 text-left font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border border-border px-2.5 py-1.5 align-top">
                      <Markdown content={cell} compact inline />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'equation':
      return (
        <div className="rounded-[var(--radius)] border border-border bg-surface px-4 py-3">
          <Markdown
            content={`$$${block.latex}$$${block.label === undefined ? '' : `\n\n_${block.label}_`}`}
            className={large ? 'text-[17px]' : undefined}
          />
        </div>
      );
    case 'code':
      return (
        <div className="overflow-hidden rounded-[var(--radius)] border border-border">
          <pre
            className={`overflow-x-auto bg-surface p-3 leading-relaxed ${
              large ? 'text-[14px]' : 'text-[12.5px]'
            }`}
          >
            <code>{block.code}</code>
          </pre>
          {block.trace !== undefined && block.trace.length > 0 && (
            <ol className={`border-t border-border px-3 py-2 text-text-muted ${large ? 'text-[13px]' : 'text-[12px]'}`}>
              {block.trace.map((line, index) => (
                <li key={index} className="ml-4 list-decimal">
                  {line}
                </li>
              ))}
            </ol>
          )}
        </div>
      );
    case 'callout': {
      const tone =
        block.tone === 'trap'
          ? 'border-danger/40 text-danger'
          : block.tone === 'tip'
            ? 'border-known/40'
            : 'border-border';
      return (
        <div className={`rounded-[var(--radius)] border ${tone} bg-surface px-3.5 py-2.5`}>
          <p className="text-[11px] font-medium uppercase tracking-wide">
            {block.title ?? (block.tone === 'trap' ? 'Trap' : block.tone === 'tip' ? 'Tip' : 'Note')}
          </p>
          <Markdown
            content={block.text}
            compact={!large}
            className={large ? 'mt-1 text-[16.5px]' : 'mt-1'}
          />
        </div>
      );
    }
    case 'flow':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {block.nodes.map((node, index) => (
            <span key={node.id} className="flex items-center gap-2">
              <span className={`chip px-2.5 py-1 ${large ? 'text-[14px]' : 'text-[12.5px]'}`}>{node.label}</span>
              {index < block.nodes.length - 1 && <span className="text-text-muted">→</span>}
            </span>
          ))}
        </div>
      );
    case 'recall':
      return <RecallBlock prompt={block.prompt} answer={block.answer} large={large} />;
  }
}

function RecallBlock({ prompt, answer, large }: { prompt: string; answer: string; large: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Your turn</p>
      <Markdown content={prompt} className={large ? 'mt-1 text-[16.5px] font-medium' : 'mt-1 text-[14px] font-medium'} />
      <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setShown((value) => !value)}>
        {shown ? 'Hide answer' : 'Show answer'}
      </button>
      {shown && <Markdown content={answer} compact={!large} className="mt-2" />}
    </div>
  );
}

export function LessonBoard({
  courseId,
  document,
  onRegenerate,
  onAnimate,
  busy,
}: {
  courseId: string;
  document: LessonDocument;
  onRegenerate: () => void;
  /** Ask the pipeline for one animation for this slide, after the fact. */
  onAnimate?: (beatIndex: number) => void;
  busy: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [present, setPresent] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const presentRef = useRef<HTMLDivElement | null>(null);
  const { speaking, paused, supported, speak, stop, togglePause } = useSpeech();
  const beat = document.beats[index];

  const listen = useCallback(() => {
    if (beat === undefined) return;
    speak(beatText(beat));
  }, [beat, speak]);

  // A new beat replaces the narration, and leaving the board silences it.
  useEffect(() => () => stop(), [index, stop]);

  // Presenting takes the native window full screen; leaving restores it.
  useEffect(() => {
    if (!present) return;
    void setWindowFullscreen(true);
    return () => {
      void setWindowFullscreen(false);
    };
  }, [present]);

  const go = useCallback(
    (next: number) => {
      setIndex(Math.min(document.beats.length - 1, Math.max(0, next)));
    },
    [document.beats.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Another tab may be showing: the board stays mounted, but must not hijack keys.
      const board = rootRef.current;
      const stage = presentRef.current;
      const visible = (board?.getClientRects().length ?? 0) > 0 ? board : stage;
      if (visible === null || visible.getClientRects().length === 0) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(index + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(index - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        go(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        go(document.beats.length - 1);
      } else if (event.key === 'Escape') {
        setPresent(false);
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [document.beats.length, go, index, stop]);

  if (beat === undefined) return null;

  const workedIndex = document.beats.findIndex((item) => item.kind === 'worked');
  const recallIndex = document.beats.findIndex((item) => item.kind === 'recall');
  const check =
    beat.check ??
    document.checkQuestions[Math.min(index, Math.max(0, document.checkQuestions.length - 1))] ??
    null;

  // One set of narration controls: pause keeps the voice where it is, stop
  // ends it, and neither restarts the beat.
  const speechControls = supported ? (
    speaking ? (
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={togglePause}
          aria-label={paused ? 'Resume reading' : 'Pause reading'}
        >
          {paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={stop} aria-label="Stop reading">
          <Square className="size-3.5" aria-hidden />
          Stop
        </button>
      </div>
    ) : (
      <button type="button" className="btn btn-ghost btn-sm" onClick={listen}>
        <Volume2 className="size-4" aria-hidden />
        Listen
      </button>
    )
  ) : null;

  const slideBody = (large: boolean) => (
    <>
      <h3 className={large ? 'present-title' : 'mt-2.5 text-[20px] font-semibold leading-tight tracking-[-0.02em]'}>
        {beat.title}
      </h3>
      <p className={large ? 'present-intro' : 'mt-2 text-[14px] leading-relaxed text-text-muted'}>{beat.intro}</p>
      <div className={large ? 'mt-6 flex flex-col gap-4' : 'mt-3.5 flex flex-col gap-3'}>
        {beat.blocks.map((block, blockIndex) => (
          <BlockView key={blockIndex} block={block} large={large} />
        ))}
      </div>
      {beat.animation !== undefined && beat.animation !== null ? (
        <div className={large ? 'mt-6' : 'mt-3.5'}>
          <LessonAnimation animation={beat.animation} large={large} />
        </div>
      ) : onAnimate !== undefined ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-3.5 self-start"
          onClick={() => onAnimate(index)}
          disabled={busy}
          title="Generate a short animation for this slide's idea"
        >
          <Sparkles className="size-3.5" aria-hidden />
          Animate this idea
        </button>
      ) : null}
      {beat.takeaway !== null && (
        <p
          className={
            large
              ? 'mt-5 rounded-[var(--radius)] bg-accent-soft px-4 py-3 text-[17px]'
              : 'mt-3 rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-[13px]'
          }
        >
          <strong>Takeaway:</strong> {beat.takeaway}
        </p>
      )}
      {!large && heatCheck(check)}
    </>
  );

  const board = (
    <div ref={rootRef} className="grid gap-4 lg:grid-cols-[210px_1fr]">
      <aside className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-surface p-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Objective</p>
          <p className="mt-1 text-[12.5px] leading-relaxed">{document.objective}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Beats</p>
          <ol className="mt-1 flex flex-col gap-1">
            {document.beats.map((item, beatIndex) => (
              <li key={`${item.kind}:${beatIndex}`}>
                <button
                  type="button"
                  onClick={() => go(beatIndex)}
                  className={`w-full rounded-[2px] px-2 py-1 text-left text-[12px] transition-colors ${
                    beatIndex === index ? 'bg-accent text-accent-contrast' : 'text-text-muted hover:text-text'
                  }`}
                >
                  {beatIndex + 1}. {item.title}
                </button>
              </li>
            ))}
          </ol>
        </div>
        {document.citations.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Pages</p>
            <p className="mt-1 flex flex-wrap gap-1">
              {document.citations.map((page) => (
                <span key={page} className="chip num">
                  p.{page}
                </span>
              ))}
            </p>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip">{beat.kind.replace('_', ' ')}</span>
          <span className="chip num">
            {index + 1}/{document.beats.length}
          </span>
          {beat.citationPages.map((page) => (
            <span key={page} className="chip num">
              p.{page}
            </span>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {speechControls}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPresent(true)}>
              <Maximize2 className="size-4" aria-hidden />
              Present
            </button>
          </div>
        </div>
        {slideBody(false)}
        <div className="mt-3">
          <SectionAsk
            key={`ask-${index}`}
            courseId={courseId}
            sectionTitle={beat.title}
            sectionText={beatText(beat)}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => go(index - 1)} disabled={index === 0}>
            <ChevronLeft className="size-3.5" aria-hidden />
            Back
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => go(workedIndex === -1 ? index : workedIndex)}
          >
            <Lightbulb className="size-3.5" aria-hidden />
            Show example
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => go(recallIndex === -1 ? index : recallIndex)}
          >
            <Target className="size-3.5" aria-hidden />
            Your turn
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRegenerate} disabled={busy}>
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            Explain again
          </button>
          <button type="button" className="btn btn-primary btn-sm ml-auto" onClick={() => go(index + 1)}>
            Next
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );

  if (!present) return board;

  // Presentation is the whole window, one beat at a time - not the board in a
  // floating card, and never with a Present button still on screen.
  return (
    <div
      ref={presentRef}
      className="present-stage fixed inset-0 z-50 flex flex-col bg-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Present lesson"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{document.title}</p>
        <span className="chip num">
          {index + 1}/{document.beats.length}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {speechControls}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setPresent(false);
              stop();
            }}
          >
            <Minimize2 className="size-3.5" aria-hidden />
            Exit
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex min-h-full w-full max-w-[1080px] flex-col justify-center px-6 py-10 sm:px-10 lg:px-16">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip">{beat.kind.replace('_', ' ')}</span>
            {beat.citationPages.map((page) => (
              <span key={page} className="chip num">
                p.{page}
              </span>
            ))}
          </div>
          {slideBody(true)}
        </article>
      </main>

      <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-panel px-4 py-2.5">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => go(index - 1)} disabled={index === 0}>
          <ChevronLeft className="size-3.5" aria-hidden />
          Back
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${((index + 1) / Math.max(1, document.beats.length)) * 100}%` }}
          />
        </div>
        <span className="hidden text-[11.5px] text-text-muted sm:inline">← → to move · Esc exits</span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => go(index + 1)}
          disabled={index >= document.beats.length - 1}
        >
          Next
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      </footer>
    </div>
  );
}

function heatCheck(check: { prompt: string; answer: string } | null) {
  if (check === null) return null;
  return (
    <div className="mt-3 rounded-[var(--radius)] border border-border bg-surface px-3.5 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
        <Eye className="size-3.5" aria-hidden /> Check
      </p>
      <Markdown content={check.prompt} className="mt-1 text-[13.5px]" />
      <details className="mt-1.5 text-[13px] text-text-muted">
        <summary className="cursor-pointer select-none">Show answer</summary>
        <Markdown content={check.answer} compact className="mt-1 text-text" />
      </details>
    </div>
  );
}
