'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  getFileData,
  listPages,
  rowToMaterial,
  type Material,
  type MaterialPage,
} from '@axiom/data';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Maximize2,
  Minimize2,
  RotateCw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getDb } from '../lib/db';
import { setWindowFullscreen } from '../lib/fullscreen';
import { openPdfDocument, type PdfDocumentHandle, type PdfPageSize } from '../lib/preview';
import { Markdown } from './markdown';
import { WorkProgress, type WorkState } from './work-progress';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const PAGE_GAP = 16;
/** Room above each page for its number label. */
const PAGE_CAPTION = 24;
const WINDOW_BEFORE = 1;
const WINDOW_AFTER = 2;
/** A scroll track taller than this cannot be laid out by the browser. */
const MAX_TRACK_PX = 20_000_000;
const MAX_HITS = 200;

type ViewMode = 'scroll' | 'single';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

interface StoredView {
  page: number;
  fit: 'width' | 'height' | 'none';
  zoom: number;
  rotation: number;
  mode: ViewMode;
  textOpen: boolean;
}

const VIEW_KEY_PREFIX = 'axiom.preview.view.';

function readView(materialId: string): StoredView | null {
  if (typeof window === 'undefined' || materialId === '') return null;
  try {
    const raw = window.localStorage.getItem(`${VIEW_KEY_PREFIX}${materialId}`);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<StoredView>;
    const zoom = Number(value.zoom);
    const page = Number(value.page);
    return {
      page: Number.isFinite(page) ? Math.max(1, Math.round(page)) : 1,
      fit: value.fit === 'height' || value.fit === 'none' ? value.fit : 'width',
      zoom: Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : 1,
      rotation: value.rotation === 90 || value.rotation === 180 || value.rotation === 270 ? value.rotation : 0,
      mode: value.mode === 'single' ? 'single' : 'scroll',
      textOpen: value.textOpen === true,
    };
  } catch {
    return null;
  }
}

function saveView(materialId: string, view: StoredView): void {
  if (typeof window === 'undefined' || materialId === '') return;
  try {
    window.localStorage.setItem(`${VIEW_KEY_PREFIX}${materialId}`, JSON.stringify(view));
  } catch {
    // A full disk must not stop the reader from reading.
  }
}

/**
 * Material review with the whole PDF, not a column of thumbnails: page jump,
 * zoom, rotate, fit width, find-in-document, one-page or continuous mode, and
 * keyboard navigation. Continuous mode only mounts the pages near the
 * viewport, so a several-hundred-page scan stays responsive.
 */
export function MaterialViewer() {
  const params = useSearchParams();
  const materialId = params.get('id') ?? '';

  const [material, setMaterial] = useState<Material | null>(null);
  const [pages, setPages] = useState<MaterialPage[]>([]);
  const [pdf, setPdf] = useState<PdfDocumentHandle | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [textBody, setTextBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const [mode, setMode] = useState<ViewMode>('scroll');
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState('1');
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<'width' | 'height' | 'none'>('width');
  const [rotation, setRotation] = useState(0);
  const [textOpen, setTextOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [baseSize, setBaseSize] = useState<PdfPageSize | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [searchNote, setSearchNote] = useState('');
  const [searching, setSearching] = useState(false);

  const pdfRef = useRef<PdfDocumentHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(1);
  const searchToken = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const stored = readView(materialId);
    pdfRef.current = null;
    setLoading(true);
    setError(null);
    setRenderError(null);
    setMaterial(null);
    setPages([]);
    setPdf(null);
    setBaseSize(null);
    setImageUrl(null);
    setTextBody(null);
    setPage(stored?.page ?? 1);
    setJump(String(stored?.page ?? 1));
    setHits([]);
    setSearchNote('');
    setQuery('');
    setMode(stored?.mode ?? 'scroll');
    setFit(stored?.fit ?? 'width');
    setRotation(stored?.rotation ?? 0);
    setZoom(stored?.zoom ?? 1);
    setTextOpen(stored?.textOpen ?? false);
    setFullscreen(false);

    void (async () => {
      if (materialId === '') {
        setError('No material was selected.');
        setLoading(false);
        return;
      }
      try {
        const db = await getDb();
        const rows = await db.driver.select<Record<string, unknown>>(
          'SELECT * FROM materials WHERE id = $1',
          [materialId],
        );
        const row = rows[0];
        if (row === undefined) {
          setError('This material is no longer stored on this device.');
          setLoading(false);
          return;
        }
        const found = rowToMaterial(row);
        const readPages = await listPages(db.driver, materialId);
        if (cancelled) return;
        setMaterial(found);
        setPages(readPages);

        const file = await getFileData(db.driver, materialId);
        if (cancelled) return;
        if (file === null) {
          return; // Text-only material: the read pages still show on the right.
        }
        if (file.mime.startsWith('image/')) {
          objectUrl = URL.createObjectURL(new Blob([file.data], { type: file.mime }));
          setImageUrl(objectUrl);
        } else if (file.mime === 'application/pdf') {
          const handle = await openPdfDocument(file.data);
          if (cancelled) {
            void handle.destroy();
            return;
          }
          pdfRef.current = handle;
          setPdf(handle);
          setBaseSize(await handle.getPageSize(1, 0));
          // The saved page may be past the end if the file was replaced.
          const restored = clamp(stored?.page ?? 1, 1, handle.numPages);
          setPage(restored);
          setJump(String(restored));
        } else {
          setTextBody(new TextDecoder().decode(file.data));
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
      if (pdfRef.current !== null) {
        void pdfRef.current.destroy();
        pdfRef.current = null;
      }
    };
  }, [materialId]);

  const numPages = pdf?.numPages ?? 0;

  // Page 1 sets the frame the other pages are measured against.
  const pageFrame = useMemo<PdfPageSize>(() => {
    if (baseSize === null) return { width: 612, height: 792 };
    return rotation % 180 === 0
      ? baseSize
      : { width: baseSize.height, height: baseSize.width };
  }, [baseSize, rotation]);

  const fitWidthScale = useMemo(() => {
    const available = Math.max(180, stageSize.width - 2 * PAGE_GAP);
    return clamp(available / pageFrame.width, MIN_ZOOM, MAX_ZOOM);
  }, [stageSize.width, pageFrame.width]);

  // Fit height is for a page that is too wide to see whole at fit width. A
  // flex child can report 0 before layout settles, so use a sane page box
  // rather than shrinking the page to the minimum.
  const heightBox = stageSize.height >= 160 ? stageSize.height : 640;
  const fitHeightScale = useMemo(() => {
    const available = Math.max(160, heightBox - 2 * PAGE_GAP);
    return clamp(available / pageFrame.height, MIN_ZOOM, MAX_ZOOM);
  }, [heightBox, pageFrame.height]);

  const scale =
    fit === 'width' ? fitWidthScale : fit === 'height' ? fitHeightScale : zoom;
  const slotHeight = Math.round(pageFrame.height * scale) + PAGE_CAPTION;
  const trackHeight = numPages * (slotHeight + PAGE_GAP);
  // Past this many pages the scroll track exceeds the browser's layout limit,
  // so the viewer falls back to one page at a time and says why.
  const tooLargeToScroll = trackHeight > MAX_TRACK_PX;
  const shownMode: ViewMode = tooLargeToScroll ? 'single' : mode;

  const width = Math.round(pageFrame.width * scale);
  const height = Math.round(pageFrame.height * scale);

  const goToPage = useCallback(
    (target: number) => {
      if (numPages === 0) return;
      // An empty or half-typed box must not move the reader to page NaN.
      const safe = Number.isFinite(target) ? target : pageRef.current;
      const next = clamp(Math.round(safe), 1, numPages);
      setPage(next);
      setJump(String(next));
      if (shownMode === 'scroll' && scrollRef.current !== null) {
        scrollRef.current.scrollTop = (next - 1) * (slotHeight + PAGE_GAP);
      }
    },
    [numPages, shownMode, slotHeight],
  );

  const onScroll = useCallback(() => {
    if (shownMode !== 'scroll' || slotHeight === 0) return;
    const element = scrollRef.current;
    if (element === null) return;
    const next = clamp(Math.floor(element.scrollTop / (slotHeight + PAGE_GAP)) + 1, 1, numPages);
    setPage((current) => (current === next ? current : next));
  }, [shownMode, slotHeight, numPages]);

  useEffect(() => {
    pageRef.current = page;
    setJump(String(page));
  }, [page]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined) return;
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [pdf, shownMode, textOpen, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Ask the native window to go full screen too, so the title bar and taskbar
  // get out of the way. Leaving the screen (or the page) restores the window.
  useEffect(() => {
    if (!fullscreen) return;
    void setWindowFullscreen(true);
    return () => {
      void setWindowFullscreen(false);
    };
  }, [fullscreen]);

  // A new zoom, rotation or mode keeps the reader on the same page.
  useEffect(() => {
    if (shownMode !== 'scroll') return;
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTop = (pageRef.current - 1) * (slotHeight + PAGE_GAP);
  }, [shownMode, slotHeight, rotation]);

  // Where you were, at what zoom, survives closing the viewer and the app.
  useEffect(() => {
    if (pdf === null) return;
    saveView(materialId, { page, fit, zoom, rotation, mode, textOpen });
  }, [pdf, materialId, page, fit, zoom, rotation, mode, textOpen]);

  const zoomBy = useCallback(
    (delta: number) => {
      const current = fit === 'width' ? fitWidthScale : fit === 'height' ? fitHeightScale : zoom;
      setFit('none');
      setZoom(clamp(current + delta, MIN_ZOOM, MAX_ZOOM));
    },
    [fit, fitWidthScale, fitHeightScale, zoom],
  );

  const runSearch = useCallback(
    async (raw: string) => {
      const needle = raw.trim().toLowerCase();
      searchToken.current += 1;
      const token = searchToken.current;
      if (pdf === null || needle === '') {
        setHits([]);
        setSearchNote('');
        setSearching(false);
        return;
      }
      setSearching(true);
      setSearchNote('');
      const stored = new Map(pages.map((entry) => [entry.pageNumber, entry.text ?? '']));
      const found: number[] = [];
      try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (searchToken.current !== token) return;
          const text = stored.get(pageNumber) ?? (await pdf.getPageText(pageNumber));
          if (text.toLowerCase().includes(needle)) found.push(pageNumber);
          if (found.length >= MAX_HITS) break;
        }
        if (searchToken.current !== token) return;
        setHits(found);
        setHitIndex(0);
        if (found.length === 0) setSearchNote('No page contains that text.');
        else if (found.length >= MAX_HITS) setSearchNote(`Showing the first ${MAX_HITS} matching pages.`);
        else setSearchNote(`${found.length} page${found.length === 1 ? '' : 's'} match.`);
        if (found[0] !== undefined) goToPage(found[0]);
      } catch (caught) {
        if (searchToken.current === token) {
          setSearchNote(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (searchToken.current === token) setSearching(false);
      }
    },
    [pdf, pages, goToPage],
  );

  const stepHit = useCallback(
    (delta: number) => {
      if (hits.length === 0) return;
      const next = (hitIndex + delta + hits.length) % hits.length;
      setHitIndex(next);
      const target = hits[next];
      if (target !== undefined) goToPage(target);
    },
    [hits, hitIndex, goToPage],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === 'Escape' && fullscreen) {
        event.preventDefault();
        setFullscreen(false);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goToPage(page + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToPage(page - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goToPage(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        goToPage(numPages);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === '-') {
        event.preventDefault();
        zoomBy(-ZOOM_STEP);
      }
    },
    [goToPage, page, numPages, zoomBy, fullscreen],
  );

  const windowPages = useMemo(() => {
    if (pdf === null) return [] as number[];
    if (shownMode === 'single') return [page];
    const start = clamp(page - WINDOW_BEFORE, 1, pdf.numPages);
    const end = clamp(page + WINDOW_AFTER, 1, pdf.numPages);
    const list: number[] = [];
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) list.push(pageNumber);
    return list;
  }, [pdf, shownMode, page]);

  const activeText = pages.find((entry) => entry.pageNumber === page) ?? null;

  const work: WorkState | null = loading
    ? { label: 'Opening the material', detail: 'Loading the stored file', percent: null, tone: 'busy' }
    : null;

  if (error !== null) {
    return (
      <div className="card w-full p-6">
        <p className="text-sm text-danger">{error}</p>
        <p className="mt-1 text-[12.5px] text-text-muted">
          The file preview needs the material copy that was stored on upload.
        </p>
        <Link
          href={material === null ? '/courses' : `/course?id=${material.courseId}&tab=material`}
          className="btn btn-ghost btn-sm mt-3"
        >
          ← Back to material
        </Link>
      </div>
    );
  }

  if (material === null) {
    return (
      <div className="card w-full p-8" aria-live="polite">
        <div className="skeleton h-6 w-56" />
        <div className="skeleton mt-3 h-3 w-32" />
      </div>
    );
  }

  return (
    <div
      className={
        fullscreen
          ? 'pdf-fullscreen fixed inset-0 z-50 flex h-screen flex-col gap-3 overflow-hidden bg-bg p-3'
          : 'flex flex-col gap-4'
      }
      onKeyDown={onKeyDown}
    >
      {!fullscreen && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/course?id=${material.courseId}&tab=material`}
              className="text-[11.5px] uppercase tracking-[0.12em] text-text-muted no-underline hover:text-text"
            >
              ← Back to material
            </Link>
          </div>

          <header>
            <h1 className="page-title">{material.kind.replace(/_/g, ' ')} review</h1>
            <p className="mt-2 flex flex-wrap items-center gap-1">
              <span className="chip num">
                {numPages > 0 ? numPages : (material.pageCount ?? pages.length)} page
                {(numPages > 0 ? numPages : pages.length) === 1 ? '' : 's'}
              </span>
              <span className="chip">{pages.length} read</span>
              <span className="chip">{material.mimeType ?? 'stored file'}</span>
              <span className="chip">{material.status}</span>
            </p>
          </header>
        </>
      )}

      {work !== null && <WorkProgress work={work} />}

      {renderError !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-danger/40 bg-surface px-3 py-2">
          <p className="text-[12.5px] text-danger">A page could not be drawn: {renderError}</p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRenderError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div
        className={
          fullscreen
            ? textOpen
              ? 'grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_330px]'
              : 'flex min-h-0 flex-1 flex-col gap-4'
            : textOpen
              ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]'
              : 'flex flex-col gap-4'
        }
      >
        <section
          className={fullscreen ? 'pdf-viewer pdf-viewer-grow min-w-0' : 'pdf-viewer min-w-0'}
          aria-label="Document"
        >
          {pdf !== null && (
            <>
              <div className="pdf-toolbar" role="toolbar" aria-label="PDF controls">
                <div className="pdf-tool-group">
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                  </button>
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      goToPage(Number(jump));
                    }}
                  >
                    <input
                      value={jump}
                      onChange={(event) => setJump(event.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={() => goToPage(Number(jump))}
                      className="input pdf-jump"
                      aria-label={`Page number, 1 to ${numPages}`}
                      inputMode="numeric"
                    />
                    <span className="num text-[12px] text-text-muted">/ {numPages}</span>
                  </form>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= numPages}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                </div>

                <div className="pdf-tool-group">
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => zoomBy(-ZOOM_STEP)}
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="size-4" aria-hidden />
                  </button>
                  <span className="num w-11 text-center text-[12px] text-text-muted">{zoomLabel(scale)}</span>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => zoomBy(ZOOM_STEP)}
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={fit === 'width' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                    aria-pressed={fit === 'width'}
                    onClick={() => setFit('width')}
                  >
                    Fit width
                  </button>
                  <button
                    type="button"
                    className={fit === 'height' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                    aria-pressed={fit === 'height'}
                    onClick={() => setFit('height')}
                  >
                    Fit height
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRotation((value) => (value + 90) % 360)}
                    aria-label="Rotate page"
                  >
                    <RotateCw className="size-3.5" aria-hidden />
                  </button>
                </div>

                <div className="pdf-tool-group">
                  <button
                    type="button"
                    className={shownMode === 'single' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                    aria-pressed={shownMode === 'single'}
                    onClick={() => setMode('single')}
                  >
                    One page
                  </button>
                  <button
                    type="button"
                    className={shownMode === 'scroll' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                    aria-pressed={shownMode === 'scroll'}
                    onClick={() => setMode('scroll')}
                    disabled={tooLargeToScroll}
                    title={
                      tooLargeToScroll
                        ? 'This document has too many pages to scroll continuously.'
                        : 'Scroll through every page'
                    }
                  >
                    Scrolling
                  </button>
                  <button
                    type="button"
                    className={textOpen ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                    aria-pressed={textOpen}
                    onClick={() => setTextOpen((value) => !value)}
                    title="Show the text that was extracted from each page"
                  >
                    <FileText className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Read pages</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setFullscreen((value) => !value)}
                    aria-pressed={fullscreen}
                    title={fullscreen ? 'Leave full screen' : 'Read the document full screen'}
                  >
                    {fullscreen ? (
                      <Minimize2 className="size-3.5" aria-hidden />
                    ) : (
                      <Maximize2 className="size-3.5" aria-hidden />
                    )}
                    <span className="hidden sm:inline">{fullscreen ? 'Exit' : 'Full screen'}</span>
                  </button>
                </div>

                <form
                  className="pdf-tool-group ml-auto"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runSearch(query);
                  }}
                >
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find in document"
                    className="input pdf-search"
                    aria-label="Find in document"
                  />
                  {hits.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => stepHit(-1)}
                        aria-label="Previous match"
                      >
                        <ChevronLeft className="size-3.5" aria-hidden />
                      </button>
                      <span className="num text-[11.5px] text-text-muted">
                        {hitIndex + 1}/{hits.length}
                      </span>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => stepHit(1)}
                        aria-label="Next match"
                      >
                        <ChevronRight className="size-3.5" aria-hidden />
                      </button>
                    </>
                  )}
                  <button type="submit" className="btn btn-ghost btn-sm" aria-label="Search" disabled={searching}>
                    {searching ? <span className="spinner" aria-hidden /> : <Search className="size-4" aria-hidden />}
                  </button>
                </form>
              </div>

              {(searchNote !== '' || tooLargeToScroll) && (
                <p className="border-b border-border px-3 py-1.5 text-[11.5px] text-text-muted">
                  {searchNote}
                  {searchNote !== '' && tooLargeToScroll ? ' · ' : ''}
                  {tooLargeToScroll
                    ? 'This document is too large to scroll as one strip, so it shows one page at a time. Use the page box to move.'
                    : ''}
                </p>
              )}

              {shownMode === 'single' ? (
                <div ref={scrollRef} className={fullscreen ? 'pdf-scroll pdf-scroll-grow' : 'pdf-scroll'}>
                  <div className="pdf-single">
                    <PdfPageCanvas
                      pdf={pdf}
                      pageNumber={page}
                      scale={scale}
                      width={width}
                      height={height}
                      rotation={rotation}
                      onError={setRenderError}
                      label={`Page ${page} of ${numPages}`}
                    />
                  </div>
                </div>
              ) : (
                <div
                  ref={scrollRef}
                  className={fullscreen ? 'pdf-scroll pdf-scroll-grow' : 'pdf-scroll'}
                  onScroll={onScroll}
                >
                  <div className="pdf-track" style={{ height: trackHeight }}>
                    {windowPages.map((pageNumber) => (
                      <div
                        key={pageNumber}
                        className="pdf-slot"
                        style={{
                          top: (pageNumber - 1) * (slotHeight + PAGE_GAP),
                          height: slotHeight,
                        }}
                      >
                        <PdfPageCanvas
                          pdf={pdf}
                          pageNumber={pageNumber}
                          scale={scale}
                          width={width}
                          height={height}
                          rotation={rotation}
                          onError={setRenderError}
                          label={`Page ${pageNumber} of ${numPages}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {imageUrl !== null && (
            <img
              src={imageUrl}
              alt="Uploaded page"
              className="pdf-page"
              style={{ width: Math.round(720 * scale), height: 'auto' }}
            />
          )}

          {textBody !== null && (
            <pre className="whitespace-pre-wrap rounded-[var(--radius)] border border-border bg-surface p-4 text-[13px] leading-relaxed">
              {textBody}
            </pre>
          )}

          {pdf === null && imageUrl === null && textBody === null && !loading && (
            <p className="rounded-[var(--radius)] border border-dashed border-border-strong bg-surface p-5 text-sm text-text-muted">
              No stored copy of this file, so there is nothing to show. The text that was read
              is with Read pages.
            </p>
          )}
        </section>

        {textOpen && (
          <aside
            className={
              fullscreen ? 'flex min-h-0 flex-col gap-2 overflow-y-auto' : 'flex flex-col gap-2'
            }
            aria-label="Read pages"
          >
            <p className="section-title">Read pages</p>
            {pages.length === 0 ? (
              <p className="text-[12.5px] text-text-muted">
                No page produced text. Use Read with vision or Paste text on the Material tab.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  {pages.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => goToPage(entry.pageNumber)}
                      className={
                        entry.pageNumber === page ? 'chip bg-accent-soft text-text' : 'chip hover:text-text'
                      }
                    >
                      {entry.pageNumber}
                    </button>
                  ))}
                </div>
                <p className="text-[11.5px] text-text-muted">
                  Pick a page to jump to it and read the text that was extracted.
                </p>
                {activeText !== null && (
                  <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-muted">
                      <span className="chip">p.{activeText.pageNumber}</span>
                      <span className="chip">{activeText.extractionMethod.replace('_', ' ')}</span>
                      {activeText.confidence !== null && (
                        <span className="chip num">{Math.round(activeText.confidence * 100)}%</span>
                      )}
                      {activeText.lowConfidence && (
                        <span className="chip" style={{ color: 'var(--color-warning)' }}>
                          low confidence
                        </span>
                      )}
                    </p>
                    <div className="mt-2 max-h-[340px] overflow-auto">
                      {activeText.text === null ? (
                        <p className="text-[12.5px] text-text-muted">No text was read from this page.</p>
                      ) : (
                        // Read with the same renderer as the page inspector, so
                        // LaTeX reads as maths here too.
                        <Markdown content={activeText.text} compact className="text-[12.5px]" />
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </div>

      {!fullscreen && (
        <p className="text-[11.5px] text-text-muted">
          Arrow keys turn pages · Home/End jump to the ends · + and − zoom · Esc leaves full screen.
          Fit width fills the width; fit height shows the whole page at once. Zoom and rotation are
          per session; the PDF itself is never changed.
        </p>
      )}
    </div>
  );
}

/** One page canvas: draws when it mounts, and again when scale or rotation changes. */
function PdfPageCanvas({
  pdf,
  pageNumber,
  scale,
  width,
  height,
  rotation,
  label,
  onError,
}: {
  pdf: PdfDocumentHandle;
  pageNumber: number;
  scale: number;
  width: number;
  /** Estimated height, so the slot keeps its shape until the page paints. */
  height: number;
  rotation: number;
  label: string;
  onError: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    setRendering(true);
    void (async () => {
      try {
        await pdf.renderPage(pageNumber, canvas, {
          scale,
          rotation,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        });
      } catch (caught) {
        if (!cancelled) onError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, scale, rotation, onError]);

  return (
    <div className="pdf-page-frame" style={{ width }} data-rendering={rendering ? 'true' : undefined}>
      <span className="pdf-page-label num">{label}</span>
      <canvas
        // A new key gives each render its own canvas, so a fast zoom never draws
        // two generations onto the same bitmap.
        key={`${pageNumber}:${scale.toFixed(3)}:${rotation}`}
        ref={canvasRef}
        aria-label={label}
        className="pdf-page"
        style={{ width, height }}
      />
      {rendering && (
        <span className="pdf-page-spinner" aria-hidden>
          <span className="spinner" />
        </span>
      )}
    </div>
  );
}
