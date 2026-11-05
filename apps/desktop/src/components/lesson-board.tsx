'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonBlock, LessonDocument } from '@axiom/data';
import { ChevronLeft, ChevronRight, Eye, Lightbulb, Maximize2, Minimize2, RefreshCw, Target, Volume2 } from 'lucide-react';
import { useSpeech } from '../lib/speech';
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

function BlockView({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case 'text':
      return <p className="text-[14.5px] leading-relaxed">{block.text}</p>;
    case 'steps':
      return (
        <ol className="flex flex-col gap-2">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-2.5 text-[14px] leading-relaxed">
              <span className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[11px] font-medium">
                {index + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      );
    case 'compare':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
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
                      {cell}
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
          <Markdown content={`$$${block.latex}$$${block.label === undefined ? '' : `\n\n_${block.label}_`}`} />
        </div>
      );
    case 'code':
      return (
        <div className="overflow-hidden rounded-[var(--radius)] border border-border">
          <pre className="overflow-x-auto bg-surface p-3 text-[12.5px] leading-relaxed">
            <code>{block.code}</code>
          </pre>
          {block.trace !== undefined && block.trace.length > 0 && (
            <ol className="border-t border-border px-3 py-2 text-[12px] text-text-muted">
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
          <p className="mt-1 text-[13.5px] leading-relaxed">{block.text}</p>
        </div>
      );
    }
    case 'flow':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {block.nodes.map((node, index) => (
            <span key={node.id} className="flex items-center gap-2">
              <span className="chip px-2.5 py-1 text-[12.5px]">{node.label}</span>
              {index < block.nodes.length - 1 && <span className="text-text-muted">→</span>}
            </span>
          ))}
        </div>
      );
    case 'recall':
      return <RecallBlock prompt={block.prompt} answer={block.answer} />;
  }
}

function RecallBlock({ prompt, answer }: { prompt: string; answer: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Your turn</p>
      <p className="mt-1 text-[14px] font-medium">{prompt}</p>
      <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setShown((value) => !value)}>
        {shown ? 'Hide answer' : 'Show answer'}
      </button>
      {shown && <p className="mt-2 text-[13.5px] leading-relaxed">{answer}</p>}
    </div>
  );
}

export function LessonBoard({
  courseId,
  document,
  onRegenerate,
  busy,
}: {
  courseId: string;
  document: LessonDocument;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [present, setPresent] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { speaking, supported, speak, stop } = useSpeech();
  const beat = document.beats[index];

  const listen = useCallback(() => {
    if (beat === undefined) return;
    speak(beatText(beat));
  }, [beat, speak]);

  useEffect(() => () => stop(), [stop]);

  const go = useCallback(
    (next: number) => {
      setIndex(Math.min(document.beats.length - 1, Math.max(0, next)));
    },
    [document.beats.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Another tab may be showing: the board stays mounted, but must not hijack keys.
      if (rootRef.current === null || rootRef.current.getClientRects().length === 0) return;
      if (event.key === 'ArrowRight') go(index + 1);
      else if (event.key === 'ArrowLeft') go(index - 1);
      else if (event.key === 'Home') go(0);
      else if (event.key === 'End') go(document.beats.length - 1);
      else if (event.key === 'Escape') setPresent(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [document.beats.length, go, index]);

  if (beat === undefined) return null;

  const workedIndex = document.beats.findIndex((item) => item.kind === 'worked');
  const recallIndex = document.beats.findIndex((item) => item.kind === 'recall');
  const check =
    beat.check ??
    document.checkQuestions[Math.min(index, Math.max(0, document.checkQuestions.length - 1))] ??
    null;

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
          {supported && (
            <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={listen}>
              <Volume2 className="size-4" aria-hidden />
              {speaking ? 'Reading...' : 'Listen'}
            </button>
          )}
          <button
            type="button"
            className={`btn btn-primary btn-sm ${supported ? '' : 'ml-auto'}`}
            onClick={() => setPresent(true)}
          >
            <Maximize2 className="size-4" aria-hidden />
            Present
          </button>
        </div>
        <h3 className="mt-2.5 text-[20px] font-semibold leading-tight tracking-[-0.02em]">{beat.title}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-text-muted">{beat.intro}</p>
        <div className="mt-3.5 flex flex-col gap-3">
          {beat.blocks.map((block, blockIndex) => (
            <BlockView key={blockIndex} block={block} />
          ))}
        </div>
        {beat.takeaway !== null && (
          <p className="mt-3 rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-[13px]">
            <strong>Takeaway:</strong> {beat.takeaway}
          </p>
        )}
        {heatCheck(check)}
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
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRegenerate}
            disabled={busy}
          >
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Present lesson">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="text-[12px] text-text-muted">
            Use ← → or Home/End. Escape exits.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPresent(false)}>
            <Minimize2 className="size-3.5" aria-hidden />
            Exit present
          </button>
        </div>
        <div className="rounded-[var(--radius-card)] border border-border bg-panel p-4 sm:p-6">{board}</div>
      </div>
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
      <p className="mt-1 text-[13.5px]">{check.prompt}</p>
      <details className="mt-1.5 text-[13px] text-text-muted">
        <summary className="cursor-pointer select-none">Show answer</summary>
        <p className="mt-1 text-text">{check.answer}</p>
      </details>
    </div>
  );
}
