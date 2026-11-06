/**
 * The read step (FR-022): turn one stored file into material pages, then queue
 * the topic and roadmap rebuilds. It runs from the background worker rather
 * than the upload handler, so vision-reading a forty-page scan does not freeze
 * the screen, and a failed read is retried by the queue.
 *
 * Pages are saved one at a time as they are read. A 56-page scan takes a long
 * time; writing only at the end means a stopped or failed read loses every
 * page that did work, and the learner cannot inspect any of it meanwhile.
 */
import {
  clearPages,
  enqueue,
  getFileData,
  updateMaterialStatus,
  upsertPage,
  type DbDriver,
} from '@axiom/data';
import { embedAndStorePages, type ExtractedPage } from '@axiom/pipeline';
import {
  DEFAULT_OCR_MAX_EDGE,
  arrayBufferToBase64,
  extractOcr,
  extractPdfTextLayer,
  extractScannedPdf,
  makeVisionReader,
} from './extract';
import { loadConfig } from './provider';
import { loadPrefs } from './prefs';

/** One page finished, in the shape the progress UI shows. */
export interface ReadPageProgress {
  number: number;
  total: number;
  method: ExtractedPage['method'];
  /** Letters and digits in the extracted text; 0 means the page came back empty. */
  chars: number;
}

export interface ReadProgress {
  /** 0..100 for the whole read step. */
  percent: number;
  message: string;
  page?: ReadPageProgress;
}

export interface ReadResult {
  pageCount: number;
  readable: number;
  embedded: number;
  /** Set when the OCR model failed at least once; the page text may be OCR. */
  visionError: string | null;
}

/** One extracted page in the shape the database stores. */
export function toPagePatch(page: ExtractedPage) {
  return {
    pageNumber: page.pageNumber,
    text: page.text,
    extractionMethod: page.method,
    confidence: page.confidence,
    lowConfidence: page.confidence !== null && page.confidence < 0.75,
  };
}

/** A Windows File can report no type; the read step must not treat a PDF as text. */
const TEXT_JUNK_LIMIT = 0.02;

function decodeText(data: ArrayBuffer): string {
  const text = new TextDecoder().decode(data);
  const junk = (text.match(/\uFFFD/g) ?? []).length;
  if (text.length > 0 && junk / text.length > TEXT_JUNK_LIMIT) {
    throw new Error(
      'This file is not text. Add a scan as a PDF or an image so the pages can be read.',
    );
  }
  return text;
}

/** Counts letters and digits in any script, matching the pipeline's rule. */
function contentLength(text: string | null): number {
  return text === null ? 0 : (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export async function readMaterial(
  driver: DbDriver,
  materialId: string,
  options: {
    onProgress?: (progress: ReadProgress) => void;
    onVisionError?: (message: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ReadResult> {
  try {
    return await readIntoPages(driver, materialId, options);
  } catch (error) {
    const stopped = options.signal?.aborted === true;
    const message = stopped
      ? 'Stopped by you.'
      : error instanceof Error
        ? error.message
        : String(error);
    // The job retries, but the material should say why it is unread meanwhile.
    await updateMaterialStatus(driver, materialId, { status: 'failed', errorMessage: message }).catch(
      () => undefined,
    );
    throw error;
  }
}

async function readIntoPages(
  driver: DbDriver,
  materialId: string,
  options: {
    onProgress?: (progress: ReadProgress) => void;
    onVisionError?: (message: string) => void;
    signal?: AbortSignal;
  },
): Promise<ReadResult> {
  const step = (percent: number, message: string, page?: ReadPageProgress) =>
    options.onProgress?.({ percent, message, ...(page === undefined ? {} : { page }) });
  const rows = await driver.select<Record<string, unknown>>(
    'SELECT * FROM materials WHERE id = $1',
    [materialId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`material ${materialId} disappeared`);
  const stored = await getFileData(driver, materialId);
  if (stored === null) {
    throw new Error('The stored copy of this file is missing. Add it again.');
  }
  const mime = stored.mime === '' ? 'application/pdf' : stored.mime;

  step(6, 'Reading the file');
  options.signal?.throwIfAborted();
  const config = await loadConfig().catch(() => null);
  const vision =
    config === null ? undefined : makeVisionReader(async () => config, options.signal);
  const ocrMaxEdge = config?.ocrMaxEdge ?? DEFAULT_OCR_MAX_EDGE;
  // Name the model in every step that spends its time: the learner can see
  // whether a slow page is a model call or the built-in OCR.
  const ocrModel = config?.ocrModel ?? config?.chatModel ?? '';
  const readBy = ocrModel === '' ? 'the OCR model' : ocrModel;
  const embedModel = config?.embedModel ?? '';
  let visionError: string | null = null;
  const noteVisionError = (message: string) => {
    visionError = message;
    options.onVisionError?.(message);
  };

  // The material is marked reading and its old pages are cleared before the
  // first page lands, so the UI can show a live page count instead of a stale
  // previous read.
  await updateMaterialStatus(driver, materialId, { status: 'reading' });
  await clearPages(driver, materialId).catch(() => undefined);
  const savePage = async (page: ExtractedPage) => {
    await upsertPage(driver, materialId, toPagePatch(page));
  };

  let pages: ExtractedPage[];
  if (mime === 'application/pdf') {
    pages = await extractPdfTextLayer(
      stored.data,
      (page, total) =>
        step(
          8 + Math.round((page / Math.max(1, total)) * 32),
          `Reading the text layer, page ${page} of ${total}`,
        ),
      options.signal,
      savePage,
    );
    await updateMaterialStatus(driver, materialId, {
      status: 'reading',
      pageCount: pages.length,
    });
    // Judged per page: a file often mixes printed sheets with photographed
    // ones, and only the photographed pages need an image read.
    const textless = pages.filter((page) => page.text === null).map((page) => page.pageNumber);
    if (textless.length > 0) {
      step(
        42,
        textless.length === pages.length
          ? `No text layer - ${readBy} reads every page`
          : `Reading ${textless.length} scanned page${textless.length === 1 ? '' : 's'} with ${readBy}`,
      );
      const scanned = await extractScannedPdf(stored.data, {
        onlyPages: textless,
        maxEdge: ocrMaxEdge,
        onPage: savePage,
        onProgress: ({ page, total, method, chars }) =>
          step(
            42 + Math.round((page / Math.max(1, total)) * 43),
            method === 'vision'
              ? `${readBy} reading page ${page} of ${total}`
              : `OCR page ${page} of ${total}`,
            { number: page, total, method, chars },
          ),
        ...(vision === undefined ? {} : { readVision: vision }),
        onVisionError: noteVisionError,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      const byPage = new Map(scanned.map((page) => [page.pageNumber, page]));
      pages = pages.map((page) => byPage.get(page.pageNumber) ?? page);
    }
  } else if (mime.startsWith('image/')) {
    const base64 = arrayBufferToBase64(stored.data);
    step(20, vision === undefined ? 'Reading the image' : `Reading the image with ${readBy}`);
    let page: ExtractedPage | null = null;
    if (vision !== undefined) {
      try {
        const read = await vision({ base64, mime });
        if (read.text !== null) page = read;
      } catch (error) {
        if (options.signal?.aborted === true) throw error;
        noteVisionError(error instanceof Error ? error.message : String(error));
      }
    }
    if (page === null) {
      options.signal?.throwIfAborted();
      step(60, 'OCR on the image');
      page = await extractOcr(stored.data, mime);
    }
    pages = [page];
    await savePage(page);
    step(80, `Page 1 of 1 ${page.text === null ? 'came back empty' : 'read'}`, {
      number: 1,
      total: 1,
      method: page.method,
      chars: contentLength(page.text),
    });
  } else {
    step(30, 'Reading the text file');
    const text = decodeText(stored.data).trim();
    pages = [
      { pageNumber: 1, text: text === '' ? null : text, method: 'pasted', confidence: 1 },
    ];
    await savePage(pages[0]!);
  }

  if (pages.every((page) => page.text === null)) {
    const reason =
      visionError === null ? '' : ` The OCR model failed: ${visionError}.`;
    throw new Error(
      `Every page came back empty.${reason} Point the app at a vision model in Settings, or paste the text on the Material tab.`,
    );
  }

  const readable = pages.filter((page) => page.text !== null).length;
  step(88, `Read ${readable} of ${pages.length} page${pages.length === 1 ? '' : 's'}`);
  await updateMaterialStatus(driver, materialId, {
    status: 'ready',
    pageCount: pages.length,
  });

  step(92, 'Queued topic extraction');
  await enqueue(driver, 'build_topics', { courseId: String(row.course_id) });
  const prefs = loadPrefs();
  if (prefs.autoRebuildRoadmap) {
    step(94, 'Queued the roadmap build');
    await enqueue(driver, 'build_roadmap', { courseId: String(row.course_id) });
  }

  // Best effort: with an embedding model configured, store page vectors so
  // tutor and practice retrieval upgrades to cosine search.
  let embedded = 0;
  if (config !== null && config.embedModel !== undefined && prefs.autoEmbedPages) {
    try {
      step(96, embedModel === '' ? 'Embedding pages for retrieval' : `Embedding pages with ${embedModel}`);
      embedded = await embedAndStorePages(
        driver,
        materialId,
        pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
        config,
      );
    } catch {
      embedded = 0;
    }
  }

  return { pageCount: pages.length, readable, embedded, visionError };
}
