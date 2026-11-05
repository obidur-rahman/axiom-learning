'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  deleteMaterial,
  enqueue,
  listMaterials,
  listPages,
  replacePages,
  updateMaterialStatus,
  storeFileData,
  type Material,
  type MaterialPage,
} from '@axiom/data';
import { embedAndStorePages, type ExtractedPage } from '@axiom/pipeline';
import { onAppEvent } from '../lib/events';
import {
  arrayBufferToBase64,
  extractPdfTextLayer,
  extractScannedPdf,
  makeAppExtractors,
  makeVisionReader,
  pdfPageToBase64Png,
} from '../lib/extract';
import { loadConfig } from '../lib/provider';
import { getDb } from '../lib/db';
import { loadPrefs, usePrefs } from '../lib/prefs';
import { WorkProgress, type WorkState } from './work-progress';

type DbHandle = Awaited<ReturnType<typeof getDb>>;

interface Item {
  material: Material;
  pages: MaterialPage[];
}

function toPagePatch(page: ExtractedPage) {
  return {
    pageNumber: page.pageNumber,
    text: page.text,
    extractionMethod: page.method,
    confidence: page.confidence,
    lowConfidence: page.confidence !== null && page.confidence < 0.75,
  };
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
  const [uploadKind, setUploadKind] = useState<'syllabus' | 'notes' | 'past_questions' | 'textbook' | 'other'>('other');
  const [query, setQuery] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const sessionFiles = useRef(new Map<string, File>());

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

  useEffect(() => {
    void load();
    return onAppEvent((event) => {
      if (event.kind === 'job-updated' && event.courseId === courseId) void load();
    });
  }, [load, courseId]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (files === null || files.length === 0) return;
      const list = Array.from(files);
      setBusy(true);
      setNotice(null);
      setWork({ label: list[0]?.name ?? 'Material', detail: 'Preparing the read', percent: 0, tone: 'busy' });
      const failures: string[] = [];
      try {
        const db = await getDb();
        const extractors = makeAppExtractors();
        for (const [index, file] of list.entries()) {
          const position = list.length > 1 ? `File ${index + 1}/${list.length}: ` : '';
          const label = `${position}${file.name}`;
          const step = (detail: string, percent: number) =>
            setWork({ label, detail, percent, tone: 'busy' });
          const pageStep = (page: number, total: number, method: string) => {
            const what =
              method === 'text_layer'
                ? 'Reading the text layer, page'
                : method === 'vision'
                  ? 'Vision reading page'
                  : 'OCR page';
            step(`${what} ${page} of ${total}`, 12 + Math.round((page / Math.max(1, total)) * 70));
          };
          let materialId: string | null = null;
          try {
            // Files stay on this machine. Read the bytes first so we can store
            // them for the preview panel and run extraction in one pass.
            step('Reading the file from disk', 3);
            const data = await file.arrayBuffer();
            const material = await db.materials.createMaterial(db.driver, {
              courseId,
              kind: uploadKind,
              mimeType: file.type,
              sizeBytes: file.size,
            });
            materialId = material.id;
            step('Storing a copy for the page preview', 8);
            await storeFileData(db.driver, material.id, data, file.type);
            sessionFiles.current.set(material.id, file);

            const config = await loadConfig().catch(() => null);
            const vision = config === null ? undefined : makeVisionReader(async () => config);

            let pages: ExtractedPage[];
            if (file.type === 'application/pdf') {
              step('Reading the PDF text layer, page 1', 12);
              pages = await extractPdfTextLayer(data, (page, total) =>
                pageStep(page, total, 'text_layer'),
              );
              if (pages.every((page) => page.text === null)) {
                // A CamScanner-style scan has no text layer at all. Read every
                // page as an image - OCR first, vision for what OCR cannot read.
                step('No text layer - reading every page as an image', 12);
                pages = await extractScannedPdf(data, {
                  onProgress: ({ page, total, method }) => pageStep(page, total, method),
                  ...(vision === undefined ? {} : { readVision: vision }),
                });
              }
            } else if (file.type.startsWith('image/')) {
              step('Running OCR on the image', 20);
              const page = await extractors.extractImage(data, file.type);
              pages = [page];
              if (page.text === null && vision !== undefined) {
                step('OCR found no text - vision reading the image', 55);
                pages = [await vision({ base64: arrayBufferToBase64(data), mime: file.type })];
              }
            } else {
              step('Reading the text file', 30);
              pages = [extractors.extractText(await file.text())];
            }
            if (pages.every((page) => page.text === null)) {
              throw new Error(
                'Every page came back empty. Set a vision model in Settings, or paste the text on the Material tab.',
              );
            }

            step(`Saving ${pages.length} page${pages.length === 1 ? '' : 's'}`, 88);
            await replacePages(db.driver, material.id, pages.map(toPagePatch));
            await updateMaterialStatus(db.driver, material.id, {
              status: 'ready',
              pageCount: pages.length,
            });
            step('Queued topic extraction', 93);
            await enqueue(db.driver, 'build_topics', { courseId });
            if (prefs.autoRebuildRoadmap) {
              step('Queued the roadmap build', 95);
              await enqueue(db.driver, 'build_roadmap', { courseId });
            }

            // Best effort: with an embedding model configured, store page
            // vectors so tutor/practice retrieval upgrades to cosine search.
            let embedded = 0;
            if (config !== null && config.embedModel !== undefined && prefs.autoEmbedPages) {
              try {
                step('Embedding pages for retrieval', 97);
                embedded = await embedAndStorePages(
                  db.driver,
                  material.id,
                  pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
                  config,
                );
              } catch {
                embedded = 0;
              }
            }

            const readable = pages.filter((page) => page.text !== null).length;
            setNotice(
              `${file.name}: ${pages.length} page${pages.length === 1 ? '' : 's'} read` +
                ` (${readable} with text${embedded > 0 ? `, ${embedded} embedded` : ''}). ` +
                'Topic extraction runs in the background.',
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (materialId !== null) {
              await updateMaterialStatus(db.driver, materialId, {
                status: 'failed',
                errorMessage: message,
              }).catch(() => undefined);
            }
            failures.push(`${file.name}: ${message}`);
            setWork({
              label: `${label} could not be read`,
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
              ? 'One file could not be read'
              : `${failures.length} files could not be read`,
          detail: failures.join(' · '),
          percent: null,
          tone: 'error',
        });
        setNotice(null);
      } else {
        setWork(null);
      }
    },
    [courseId, load, uploadKind, prefs.autoRebuildRoadmap, prefs.autoEmbedPages],
  );

  /** FR-023: re-read one page with the vision model (needs the file in memory). */
  const handleVisionPage = useCallback(
    async (materialId: string, pageNumber: number) => {
      const file = sessionFiles.current.get(materialId);
      const db = await getDb();
      if (file === undefined) {
        setWork({
          label: `Page ${pageNumber} could not be re-read`,
          detail: 'The file is no longer in memory. Add it again to use vision read.',
          percent: null,
          tone: 'error',
        });
        return;
      }
      setWork({
        label: `Vision read of page ${pageNumber}`,
        detail: 'Sending the page image to the vision model',
        percent: null,
        tone: 'busy',
      });
      try {
        const data = await file.arrayBuffer();
        const reader = makeVisionReader(loadConfig);
        const base64 =
          file.type === 'application/pdf'
            ? await pdfPageToBase64Png(data, pageNumber)
            : arrayBufferToBase64(data);
        const read1 = await reader({ base64, mime: file.type === 'application/pdf' ? 'image/png' : file.type });
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
      sessionFiles.current.delete(materialId);
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
          <section className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface p-3" aria-label="Search results">
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

      <ul className="flex flex-col gap-3">
        {items.map(({ material, pages }) => {
          const flagged = prefs.flagLowConfidence ? pages.filter((page) => page.lowConfidence) : [];
          const hasPages = pages.length > 0;

          return (
            <li key={material.id} className="rounded-[var(--radius)] border border-border bg-surface p-3">
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
                    <Link
                      href={`/preview?id=${material.id}`}
                      className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs text-text no-underline hover:border-accent"
                    >
                      Review pages
                    </Link>
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
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="rounded-[var(--radius)] border border-dashed border-border-strong bg-surface p-5 text-sm text-text-muted">
            No material yet. Drop a syllabus, notes or past paper above to see its pages previewed here.
          </li>
        )}
      </ul>
    </div>
  );
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
