'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  deleteMaterial,
  enqueue,
  getFileData,
  listMaterials,
  listPages,
  replacePages,
  storeFileData,
  type Material,
  type MaterialPage,
} from '@axiom/data';
import { emitAppEvent, onAppEvent } from '../lib/events';
import {
  exportLatex,
  exportPdf,
  exportWord,
  sanitizeFilename,
  type ExportProgress,
  type ExportResult,
} from '../lib/export';
import {
  arrayBufferToBase64,
  makeVisionReader,
  pdfPageToBase64Image,
  type VisionImage,
} from '../lib/extract';
import { toPagePatch } from '../lib/read-material';
import { loadConfig } from '../lib/provider';
import { getDb } from '../lib/db';
import { loadPrefs, usePrefs } from '../lib/prefs';
import { OpenExportLink } from './open-export-link';
import { PageInspector } from './page-inspector';
import { WorkProgress, type WorkState } from './work-progress';

type DbHandle = Awaited<ReturnType<typeof getDb>>;

interface Item {
  material: Material;
  pages: MaterialPage[];
}

/**
 * Material screen (FR-020..FR-025): upload files, watch the read status, fix
 * low-confidence pages by vision read or paste. Vision re-read needs the
 * original file, so the File handle is kept only for this webview session;
 * afterwards the paste fallback always works.
 */
export function UploadPanel({ courseId }: { courseId: string }) {
  const prefs = usePrefs();
  const [items, setItems] = useState<Item[]>([]);
  const [work, setWork] = useState<WorkState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteFor, setPasteFor] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<'syllabus' | 'notes' | 'past_questions' | 'textbook' | 'other'>('notes');
  const [query, setQuery] = useState('');
  const [liveRead, setLiveRead] = useState<{
    materialId: string;
    page: number | null;
    total: number | null;
    message: string;
  } | null>(null);
  const [openPages, setOpenPages] = useState<string[]>([]);
  const [busyPage, setBusyPage] = useState<{ materialId: string; page: number } | null>(null);
  const [exportState, setExportState] = useState<{
    message: string;
    percent: number | null;
    tone: 'busy' | 'ok' | 'error';
    result: ExportResult | null;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const exporting = exportState?.tone === 'busy';

  /** Same contract as the page export: dialog first, then visible progress. */
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

  const load = useCallback(async () => {
    const db = await getDb();
    const materials = await listMaterials(db.driver, courseId);
    setItems(
      await Promise.all(
        materials.map(async (material) => ({
          material,
          pages: await listPages(db.driver, material.id),
        })),
      ),
    );
  }, [courseId]);

  /** Reload one material's pages while it is being read, page by page. */
  const refreshPages = useCallback(async (materialId: string) => {
    const db = await getDb();
    const pages = await listPages(db.driver, materialId);
    setItems((current) =>
      current.map((item) => (item.material.id === materialId ? { ...item, pages } : item)),
    );
  }, []);

  useEffect(() => {
    void load();
    return onAppEvent((event) => {
      if (event.kind === 'worker-tick') return;
      if (event.courseId !== courseId) return;
      if (event.kind === 'job-progress' && event.jobKind === 'read_material') {
        setWork({
          label: 'Reading material',
          detail: event.message,
          percent: event.percent,
          tone: 'busy',
        });
        if (event.materialId !== undefined) {
          const materialId = event.materialId;
          setLiveRead({
            materialId,
            page: event.page?.number ?? null,
            total: event.page?.total ?? null,
            message: event.message,
          });
          // Open the page grid for the file being read, so its progress is
          // visible without hunting for it in the list.
          setOpenPages((current) =>
            current.includes(materialId) ? current : [...current, materialId],
          );
          // The page row is written before the event is emitted, so every
          // progress message can refresh the grid (text-layer pages too).
          void refreshPages(materialId);
        }
        return;
      }
      if (event.kind === 'job-updated') {
        if (event.jobKind === 'read_material') {
          setWork(
            event.status === 'failed'
              ? {
                  label: 'A file could not be read',
                  detail: event.error ?? 'The read failed.',
                  percent: null,
                  tone: 'error',
                }
              : null,
          );
          if (event.status !== 'queued' && event.status !== 'running') setLiveRead(null);
        }
        void load();
      }
    });
  }, [load, refreshPages, courseId]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (files === null || files.length === 0) return;
      const list = Array.from(files);
      setBusy(true);
      setNotice(null);
      setWork({
        label: list[0]?.name ?? 'Material',
        detail: 'Storing the file on this device',
        percent: 4,
        tone: 'busy',
      });
      const failures: string[] = [];
      try {
        const db = await getDb();
        for (const [index, file] of list.entries()) {
          const position = list.length > 1 ? `File ${index + 1}/${list.length}: ` : '';
          const label = `${position}${file.name}`;
          // Windows can report an empty type for a PDF. Guessing from the
          // extension keeps a scan out of the text-file branch.
          const mime = file.type !== '' ? file.type : mimeFromName(file.name);
          setWork({
            label,
            detail: 'Storing a copy and queueing the read',
            percent: 10,
            tone: 'busy',
          });
          try {
            const data = await file.arrayBuffer();
            const material = await db.materials.createMaterial(db.driver, {
              courseId,
              kind: uploadKind,
              mimeType: mime,
              sizeBytes: file.size,
            });
            await storeFileData(db.driver, material.id, data, mime);
            // Reading runs in the worker: model-reading a forty-page scan of
            // handwriting takes minutes and must not hold the screen.
            const jobId = await enqueue(db.driver, 'read_material', {
              courseId,
              materialId: material.id,
            });
            // Tell the rail now: the worker claims it on its next poll, and the
            // queue would otherwise look empty until then.
            emitAppEvent({
              kind: 'job-updated',
              jobId,
              courseId,
              jobKind: 'read_material',
              status: 'queued',
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`${file.name}: ${message}`);
            setWork({
              label: `${label} could not be added`,
              detail: message,
              percent: null,
              tone: 'error',
            });
          }
        }
      } catch (error) {
        setWork({
          label: 'The upload could not start',
          detail: error instanceof Error ? error.message : String(error),
          percent: null,
          tone: 'error',
        });
      } finally {
        setBusy(false);
        if (fileInput.current !== null) fileInput.current.value = '';
        await load();
      }
      if (failures.length > 0) {
        setWork({
          label:
            failures.length === 1
              ? 'One file could not be added'
              : `${failures.length} files could not be added`,
          detail: failures.join(' · '),
          percent: null,
          tone: 'error',
        });
        setNotice(null);
      } else {
        setWork(null);
        setNotice(
          `${list.length} file${list.length === 1 ? '' : 's'} queued. Reading runs in the background — pages appear here as they are read.`,
        );
      }
    },
    [courseId, load, uploadKind],
  );

  /** FR-023: re-read one page with the vision model, from the stored copy. */
  const handleVisionPage = useCallback(
    async (materialId: string, pageNumber: number) => {
      setWork({
        label: `OCR model read of page ${pageNumber}`,
        detail: 'Sending the page image to the OCR model',
        percent: null,
        tone: 'busy',
      });
      setBusyPage({ materialId, page: pageNumber });
      try {
        const db = await getDb();
        const stored = await getFileData(db.driver, materialId);
        if (stored === null) {
          throw new Error('The stored copy of this file is missing. Add it again.');
        }
        const config = await loadConfig();
        let image: VisionImage;
        if (stored.mime === 'application/pdf') {
          image = await pdfPageToBase64Image(stored.data, pageNumber, config?.ocrMaxEdge);
        } else if (stored.mime.startsWith('image/')) {
          image = { base64: arrayBufferToBase64(stored.data), mime: stored.mime };
        } else {
          throw new Error('A vision read needs a PDF page or an image.');
        }
        const reader = makeVisionReader(async () => config);
        const read1 = await reader(image);
        if (read1.text === null) {
          throw new Error('The model found no readable text on this page.');
        }
        const pages = await listPages(db.driver, materialId);
        await replacePages(db.driver, materialId, [
          ...pages
            .filter((page) => page.pageNumber !== pageNumber)
            .map((page) => ({
              pageNumber: page.pageNumber,
              text: page.text,
              extractionMethod: page.extractionMethod,
              confidence: page.confidence,
              lowConfidence: page.lowConfidence,
            })),
          toPagePatch({ ...read1, pageNumber }),
        ]);
        setWork(null);
        setNotice(`Page ${pageNumber} re-read.`);
      } catch (error) {
        setWork({
          label: `Page ${pageNumber} could not be re-read`,
          detail: error instanceof Error ? error.message : String(error),
          percent: null,
          tone: 'error',
        });
      }
      setBusyPage(null);
      await load();
    },
    [load],
  );

  /** Paste fallback (FR-024): replace one page's text by hand. */
  const handlePaste = useCallback(
    async (db: DbHandle, materialId: string, pageNumber: number, text: string) => {
      const pages = await listPages(db.driver, materialId);
      await replacePages(db.driver, materialId, [
        ...pages
          .filter((page) => page.pageNumber !== pageNumber)
          .map((page) => ({
            pageNumber: page.pageNumber,
            text: page.text,
            extractionMethod: page.extractionMethod,
            confidence: page.confidence,
            lowConfidence: page.lowConfidence,
          })),
        {
          pageNumber,
          text: text.trim(),
          extractionMethod: 'pasted',
          confidence: 1,
          lowConfidence: false,
        },
      ]);
      await enqueue(db.driver, 'build_topics', { courseId });
      if (loadPrefs().autoRebuildRoadmap) {
        await enqueue(db.driver, 'build_roadmap', { courseId });
      }
      setNotice(`Page ${pageNumber} replaced.`);
      setPasteFor(null);
      setPasteText('');
      await load();
    },
    [courseId, load],
  );

  const handleDelete = useCallback(
    async (materialId: string) => {
      const db = await getDb();
      await deleteMaterial(db.driver, materialId);
      await load();
    },
    [load],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <label className="flex items-center gap-1 text-xs text-text-muted">
          This upload is
          <select
            value={uploadKind}
            onChange={(event) => setUploadKind(event.target.value as typeof uploadKind)}
            className="rounded-[var(--radius)] border border-border bg-surface px-2 py-1.5 text-xs text-text"
          >
            <option value="syllabus">Syllabus</option>
            <option value="notes">Notes</option>
            <option value="past_questions">Past paper</option>
            <option value="textbook">Textbook</option>
            <option value="other">Other</option>
          </select>
        </label>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          aria-busy={busy}
          className="rounded-[var(--radius)] bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Reading...' : 'Add material'}
        </button>
        <RebuildButton courseId={courseId} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find in pages..."
          title="Search the text of every read page"
          className="ml-auto w-full max-w-xs rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>

      {query.trim().length >= 2 && (() => {
        const lower = query.trim().toLowerCase();
        const hits = items.flatMap(({ material, pages }) =>
          pages
            .filter((page) => (page.text ?? '').toLowerCase().includes(lower))
            .map((page) => {
              const text = page.text ?? '';
              const start = Math.max(0, text.toLowerCase().indexOf(lower) - 40);
              return { kind: material.kind, pageNumber: page.pageNumber, snippet: text.slice(start, start + 140) };
            }),
        );
        return (
          <section className="row flex flex-col gap-2" aria-label="Search results">
            <p className="text-xs text-text-muted">
              {hits.length === 0 ? 'No page contains' : `Found on ${hits.length} page(s):`}
              <span className="ml-1 text-text">“{query.trim()}”</span>
            </p>
            {hits.slice(0, 8).map((hit, index) => (
              <p key={`${hit.kind}-${hit.pageNumber}-${index}`} className="text-sm">
                <span className="text-xs text-text-muted">
                  {hit.kind.replace(/_/g, ' ')} · p.{hit.pageNumber} —
                </span>{' '}
                …{hit.snippet}…
              </p>
            ))}
            {hits.length > 8 && (
              <p className="text-xs text-text-muted">+ {hits.length - 8} more</p>
            )}
          </section>
        );
      })()}

      {work !== null && <WorkProgress work={work} onDismiss={() => setWork(null)} />}

      {notice !== null && (
        <p className="text-sm text-text-muted" role="status">
          {notice}
        </p>
      )}

      {exportState !== null && (
        <div className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2" role="status" aria-live="polite">
          <p
            className={`text-[12.5px] ${
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
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
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

      {/* Plain rows, not cards: the material screen is the container, and a
          card per file nested page cards one more level deep. */}
      <ul className="mt-1">
        {items.map(({ material, pages }) => {
          const flagged = prefs.flagLowConfidence ? pages.filter((page) => page.lowConfidence) : [];
          const hasPages = pages.length > 0;
          const exportPages = pages.flatMap((page) =>
            page.text === null || page.text.trim() === ''
              ? []
              : [{ pageNumber: page.pageNumber, text: page.text, method: page.extractionMethod }],
          );

          return (
            <li key={material.id} className="row">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{material.kind.toUpperCase()}</p>
                  <p className="text-xs text-text-muted">
                    {material.status}
                    {hasPages && ` — ${pages.length} pages`}
                    {flagged.length > 0 && ` — ${flagged.length} low-confidence`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {hasPages && (
                    <button
                      onClick={() =>
                        setOpenPages((current) =>
                          current.includes(material.id)
                            ? current.filter((id) => id !== material.id)
                            : [...current, material.id],
                        )
                      }
                      aria-expanded={openPages.includes(material.id)}
                      className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs hover:border-accent"
                    >
                      {openPages.includes(material.id)
                        ? 'Hide parsed pages'
                        : `Parsed pages (${pages.length}${
                            material.pageCount !== null && material.pageCount !== pages.length
                              ? `/${material.pageCount}`
                              : ''
                          })`}
                    </button>
                  )}
                  {hasPages && (
                    <Link
                      href={`/preview?id=${material.id}`}
                      className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs text-text no-underline hover:border-accent"
                    >
                      Review pages
                    </Link>
                  )}
                  {hasPages && (
                    <details className="relative">
                      <summary
                        className="cursor-pointer list-none rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs hover:border-accent"
                        title="Export every read page of this material"
                      >
                        Export
                      </summary>
                      <div className="absolute right-0 z-20 mt-1 flex w-40 flex-col rounded-[var(--radius)] border border-border bg-panel p-1 shadow-[var(--shadow-pop)]">
                        <button
                          type="button"
                          disabled={exporting}
                          className="rounded-[2px] px-2 py-1.5 text-left text-xs hover:bg-surface disabled:opacity-50"
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            void runExport('PDF', (report) =>
                              exportPdf({
                                title: `${material.kind.replace(/_/g, ' ')} pages`,
                                pages: exportPages,
                                filename: `${sanitizeFilename(material.kind)}-pages.pdf`,
                                onProgress: report,
                              }),
                            );
                          }}
                          title="Generate one PDF of every read page and save it"
                        >
                          PDF (all pages)
                        </button>
                        <button
                          type="button"
                          disabled={exporting}
                          className="rounded-[2px] px-2 py-1.5 text-left text-xs hover:bg-surface disabled:opacity-50"
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            void runExport('Word', () =>
                              exportWord({
                                title: `${material.kind.replace(/_/g, ' ')} pages`,
                                pages: exportPages,
                                filename: `${sanitizeFilename(material.kind)}-pages.doc`,
                              }),
                            );
                          }}
                          title="Save every read page as one Word document"
                        >
                          Word (.doc)
                        </button>
                        <button
                          type="button"
                          disabled={exporting}
                          className="rounded-[2px] px-2 py-1.5 text-left text-xs hover:bg-surface disabled:opacity-50"
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            void runExport('LaTeX', () =>
                              exportLatex({
                                title: `${material.kind.replace(/_/g, ' ')} pages`,
                                pages: exportPages,
                                filename: `${sanitizeFilename(material.kind)}-pages.tex`,
                              }),
                            );
                          }}
                          title="Save every read page as one editable LaTeX document"
                        >
                          LaTeX (.tex)
                        </button>
                      </div>
                    </details>
                  )}
                  <button
                    onClick={() => void handleDelete(material.id)}
                    className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs hover:border-danger hover:text-danger"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {material.errorMessage !== null && (
                <p className="mt-1 text-xs text-danger">{material.errorMessage}</p>
              )}

              {flagged.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {flagged.map((page) => (
                    <div key={page.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-warning">
                        Page {page.pageNumber}: {page.confidence === null ? 'no text' : `${Math.round((page.confidence ?? 0) * 100)}% OCR`}
                      </span>
                      <span className="flex gap-2">
                        <button
                          onClick={() => void handleVisionPage(material.id, page.pageNumber)}
                          className="rounded-[var(--radius)] border border-border px-2 py-1 hover:border-accent"
                        >
                          Read with vision
                        </button>
                        <button
                          onClick={() => {
                            setActiveMaterialId(material.id);
                            setPasteFor(page.pageNumber);
                            setPasteText('');
                          }}
                          className="rounded-[var(--radius)] border border-border px-2 py-1 hover:border-accent"
                        >
                          Paste text
                        </button>
                      </span>
                    </div>
                  ))}

                  {activeMaterialId === material.id &&
                    pasteFor !== null &&
                    flagged.some((page) => page.pageNumber === pasteFor) && (
                      <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border p-2">
                        <textarea
                          value={pasteText}
                          onChange={(event) => setPasteText(event.target.value)}
                          rows={4}
                          placeholder={`Paste page ${pasteFor} text here...`}
                          className="flex-1 rounded-[var(--radius)] border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={pasteText.trim() === ''}
                            onClick={() => {
                              const dbRef = activeMaterialId;
                              void (async () => {
                                const db = await getDb();
                                void dbRef;
                                await handlePaste(db, material.id, pasteFor, pasteText);
                              })();
                            }}
                            className="rounded-[var(--radius)] bg-accent px-3 py-1 text-xs text-accent-contrast disabled:opacity-50"
                          >
                            Replace page
                          </button>
                          <button
                            onClick={() => setPasteFor(null)}
                            className="rounded-[var(--radius)] border border-border px-3 py-1 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              )}

              {openPages.includes(material.id) && (
                <PageInspector
                  pages={pages}
                  totalPages={material.pageCount ?? (liveRead?.materialId === material.id ? liveRead.total ?? 0 : pages.length)}
                  live={liveRead !== null && liveRead.materialId === material.id ? liveRead : null}
                  busyPage={busyPage !== null && busyPage.materialId === material.id ? busyPage.page : null}
                  onReread={(pageNumber) => void handleVisionPage(material.id, pageNumber)}
                />
              )}
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="row text-sm text-text-muted">
            No material yet. Drop a syllabus, notes or past paper above to see its pages previewed here.
          </li>
        )}
      </ul>
    </div>
  );
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  md: 'text/markdown',
};

/** Windows can hand back an empty File.type; fall back to the extension. */
function mimeFromName(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'text/plain';
}

function RebuildButton({ courseId }: { courseId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={() => {
        void (async () => {
          setBusy(true);
          try {
            const db = await getDb();
            await enqueue(db.driver, 'build_roadmap', { courseId });
          } finally {
            setBusy(false);
          }
        })();
      }}
      aria-busy={busy}
      className="rounded-[var(--radius)] border border-border px-4 py-2 text-sm hover:border-accent disabled:opacity-50"
    >
      {busy ? 'Queueing...' : 'Rebuild roadmap'}
    </button>
  );
}
