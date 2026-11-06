'use client';

/**
 * Page-by-page inspection of a read material. A long scan is opaque with a
 * single percent bar: this grid shows every page, which method read it, how
 * much text it produced, and the actual parsed text. It follows a live read,
 * so a wrong result is visible on page 3, not after 56 pages.
 *
 * The page itself is typeset as a document on paper, not shown inside another
 * card: the material screen is already the container, and a preview nested two
 * cards deep with its own scrollbar made a long read impossible to follow.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MaterialPage } from '@axiom/data';
import {
  exportLatex,
  exportPdfFromElement,
  exportWordFromElement,
  type ExportProgress,
  type ExportResult,
} from '../lib/export';
import { Markdown } from './markdown';
import { OpenExportLink } from './open-export-link';

export interface LiveReadState {
  materialId: string;
  page: number | null;
  total: number | null;
  message: string;
}

const METHOD_LABEL: Record<string, string> = {
  text_layer: 'Text layer',
  vision: 'OCR model',
  ocr: 'Built-in OCR',
  pasted: 'Pasted',
};

function contentLength(text: string | null): number {
  return text === null ? 0 : (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

function pageTone(page: MaterialPage | undefined): string {
  if (page === undefined) return 'pending';
  if (page.text === null) return 'empty';
  if (page.lowConfidence) return 'low';
  if (page.extractionMethod === 'vision') return 'vision';
  if (page.extractionMethod === 'ocr') return 'ocr';
  return 'text';
}

const TONE_STYLE: Record<string, string> = {
  pending: 'border-dashed border-border bg-surface text-text-muted',
  empty: 'border-danger/50 bg-danger/10 text-danger',
  low: 'border-warning/60 bg-warning/10 text-warning',
  vision: 'border-known/50 bg-known/10 text-known',
  ocr: 'border-bridge/50 bg-bridge/10 text-bridge',
  text: 'border-accent/50 bg-accent-soft text-text',
};

export function PageInspector({
  pages,
  totalPages,
  live,
  busyPage,
  onReread,
}: {
  pages: MaterialPage[];
  totalPages: number;
  live: LiveReadState | null;
  busyPage: number | null;
  onReread: (pageNumber: number) => void;
}) {
  const byNumber = useMemo(() => new Map(pages.map((page) => [page.pageNumber, page])), [pages]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const [exportState, setExportState] = useState<{
    message: string;
    percent: number | null;
    tone: 'busy' | 'ok' | 'error';
    result: ExportResult | null;
  } | null>(null);

  // Start on the first page that needs attention, otherwise page 1.
  useEffect(() => {
    if (selected !== null) return;
    if (pages.length === 0) return;
    const problem = pages.find((page) => page.text === null || page.lowConfidence);
    setSelected((problem ?? pages[0]!).pageNumber);
  }, [pages, selected]);

  // While a read runs, follow the page being read unless the learner pinned
  // another page to inspect.
  useEffect(() => {
    if (pinned) return;
    if (live === null || live.page === null) return;
    setSelected(live.page);
  }, [live, pinned]);

  const total = Math.max(totalPages, pages.length);
  const page = selected === null ? undefined : byNumber.get(selected);
  const readCount = pages.length;
  const emptyCount = pages.filter((entry) => entry.text === null).length;
  const canExport = page !== undefined && page.text !== null && selected !== null;
  const exporting = exportState?.tone === 'busy';

  /**
   * Every export is asynchronous now: the save dialog opens first, then the
   * file is generated, and the message says which step is running so a slow
   * PDF does not look like a dead button.
   */
  const runExport = async (
    label: string,
    task: (report: ExportProgress) => Promise<ExportResult | null>,
  ) => {
    if (exporting) return;
    setExportState({ message: `Preparing ${label}...`, percent: 0, tone: 'busy', result: null });
    try {
      const saved = await task((message, percent) =>
        setExportState({ message, percent, tone: 'busy', result: null }),
      );
      setExportState(
        saved
          ? { message: `${label} saved.`, percent: null, tone: 'ok', result: saved }
          : null,
      );
    } catch (error) {
      setExportState({
        message: `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
        percent: null,
        tone: 'error',
        result: null,
      });
    }
  };

  const exportPagePdf = () => {
    const element = articleRef.current;
    if (element === null || page === undefined || selected === null) return;
    void runExport('PDF', (report) =>
      exportPdfFromElement({
        element,
        filename: `page-${selected}.pdf`,
        onProgress: report,
      }),
    );
  };

  const exportPageWord = () => {
    const element = articleRef.current;
    if (element === null || page === undefined || selected === null) return;
    void runExport('Word', () =>
      exportWordFromElement({
        element,
        title: `Page ${selected}`,
        filename: `page-${selected}.doc`,
      }),
    );
  };

  const exportPageLatex = () => {
    if (page === undefined || page.text === null || selected === null) return;
    const text = page.text;
    void runExport('LaTeX', () =>
      exportLatex({
        title: `Page ${selected}`,
        pages: [{ pageNumber: selected, text, method: page.extractionMethod }],
        filename: `page-${selected}.tex`,
      }),
    );
  };

  return (
    <section className="mt-3 border-t border-border pt-3" aria-label="Parsed pages">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-text-muted">
          <span className="font-medium text-text">{readCount}</span> of {total || '?'} pages read
          {emptyCount > 0 && <span className="text-danger"> · {emptyCount} empty</span>}
        </p>
        {live !== null && live.message !== '' && (
          <p className="truncate text-xs text-text-muted" aria-live="polite">{live.message}</p>
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1.5">
        {Array.from({ length: total }, (_, index) => index + 1).map((pageNumber) => {
          const entry = byNumber.get(pageNumber);
          const tone = pageTone(entry);
          const isSelected = selected === pageNumber;
          return (
            <button
              key={pageNumber}
              type="button"
              onClick={() => {
                setSelected(pageNumber);
                setPinned(true);
              }}
              aria-pressed={isSelected}
              aria-label={`Page ${pageNumber}${
                entry === undefined ? ', not read yet' : `, ${METHOD_LABEL[entry.extractionMethod] ?? 'read'}`
              }`}
              title={
                entry === undefined
                  ? `Page ${pageNumber}: reading`
                  : `Page ${pageNumber}: ${METHOD_LABEL[entry.extractionMethod] ?? 'read'}, ${contentLength(entry.text)} characters`
              }
              className={`num h-8 rounded-[calc(var(--radius)-4px)] border text-[11px] transition-colors duration-100 hover:border-accent ${
                isSelected ? 'outline outline-2 outline-offset-1 outline-accent' : ''
              } ${TONE_STYLE[tone]}`}
            >
              {pageNumber}
            </button>
          );
        })}
      </div>

      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <div className="flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-known" /> OCR model</div>
        <div className="flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-bridge" /> Built-in OCR</div>
        <div className="flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-accent" /> Text layer</div>
        <div className="flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-warning" /> Low confidence</div>
        <div className="flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-danger" /> Empty</div>
      </dl>

      {selected !== null && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11.5px] uppercase tracking-[0.14em] text-text-muted">Page {selected}</p>
            <div className="flex flex-wrap items-center gap-2">
              {page !== undefined && (
                <span className="chip">
                  {METHOD_LABEL[page.extractionMethod] ?? page.extractionMethod}
                  {page.confidence !== null && ` · ${Math.round(page.confidence * 100)}%`}
                  {` · ${contentLength(page.text)} chars`}
                </span>
              )}
              {page !== undefined && (
                <button
                  type="button"
                  onClick={() => onReread(selected)}
                  disabled={busyPage === selected}
                  aria-busy={busyPage === selected}
                  className="btn btn-ghost btn-sm"
                >
                  {busyPage === selected ? 'Reading...' : 'Re-read with OCR model'}
                </button>
              )}
              {canExport && (
                <div className="flex items-center gap-1" aria-label="Download this page">
                  <span className="text-[11.5px] text-text-muted">Download</span>
                  <button
                    type="button"
                    onClick={exportPagePdf}
                    disabled={exporting}
                    className="btn btn-ghost btn-sm"
                    title="Generate a PDF of this page and save it"
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={exportPageWord}
                    disabled={exporting}
                    className="btn btn-ghost btn-sm"
                    title="Save this page as a Word document"
                  >
                    DOC
                  </button>
                  <button
                    type="button"
                    onClick={exportPageLatex}
                    disabled={exporting}
                    className="btn btn-ghost btn-sm"
                    title="Save the editable LaTeX source of this page"
                  >
                    LaTeX
                  </button>
                </div>
              )}
            </div>
          </div>

          {exportState !== null && (
            <div className="mt-2" aria-live="polite">
              <p
                className={`text-[11.5px] ${
                  exportState.tone === 'error'
                    ? 'text-danger'
                    : exportState.tone === 'ok'
                      ? 'text-known'
                      : 'text-text-muted'
                }`}
              >
                {exportState.message}
              </p>
              {exportState.tone === 'busy' && exportState.percent !== null && (
                <div className="mt-1 h-1 w-full max-w-xs overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${exportState.percent}%` }}
                  />
                </div>
              )}
              {exportState.result?.openable === true && (
                <OpenExportLink result={exportState.result} />
              )}
            </div>
          )}

          {/* The page as a document: full height on the screen, no inner
              scrollbar, serif body and KaTeX for the maths the read produced. */}
          <article ref={articleRef} className="parsed-document mt-2.5" aria-label={`Text read from page ${selected}`}>
            {page !== undefined && page.text !== null ? (
              <Markdown content={page.text} />
            ) : (
              <p className="parsed-document-empty">
                {page === undefined
                  ? 'This page has not been read yet.'
                  : 'The read returned no text for this page.'}
              </p>
            )}
          </article>
        </>
      )}
    </section>
  );
}
