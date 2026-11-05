/** PDF helpers for the material viewer. */

interface PdfPageProxy {
  getViewport(options: { scale: number; rotation?: number }): { width: number; height: number };
  render(options: unknown): { promise: Promise<void>; cancel?(): void };
  getTextContent(): Promise<{ items: { str?: string }[] }>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}

interface PdfjsLike {
  getDocument(options: {
    data: ArrayBuffer;
    useSystemFonts?: boolean;
    disableAutoFetch?: boolean;
  }): PdfLoadingTask;
  GlobalWorkerOptions: { workerSrc: string };
}

export interface PdfPageSize {
  width: number;
  height: number;
}

export interface PdfRenderOptions {
  /** CSS pixels per PDF point; 1 is 72 dpi. */
  scale: number;
  rotation?: number;
  /** Backing-store multiplier so the page stays sharp on a HiDPI screen. */
  pixelRatio?: number;
}

/** An open document the viewer renders page by page as the user scrolls. */
export interface PdfDocumentHandle {
  numPages: number;
  getPageSize(pageNumber: number, rotation?: number): Promise<PdfPageSize>;
  renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    options: PdfRenderOptions,
  ): Promise<PdfPageSize>;
  /** Text layer as one string, for find-in-document. */
  getPageText(pageNumber: number): Promise<string>;
  destroy(): Promise<void>;
}

let pdfjsPromise: Promise<PdfjsLike> | null = null;

async function loadPdfJs(): Promise<PdfjsLike> {
  if (pdfjsPromise === null) {
    pdfjsPromise = (async () => {
      const pdfjs = (await import('pdfjs-dist')) as unknown as PdfjsLike;
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * Opens a stored PDF once. Rendering needs the same document for every page,
 * and re-parsing per page would make a long scan crawl.
 */
/**
 * pdf.js refuses a second render on a canvas while the first is still running
 * (React re-runs effects, and a quick zoom reuses the element), so renders for
 * one canvas are queued instead of overlapping.
 */
const renderQueues = new WeakMap<HTMLCanvasElement, Promise<unknown>>();

export async function openPdfDocument(data: ArrayBuffer): Promise<PdfDocumentHandle> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data, useSystemFonts: false, disableAutoFetch: true });
  const doc = await task.promise;

  const drawPage = async (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    options: PdfRenderOptions,
  ): Promise<PdfPageSize> => {
    const page = await doc.getPage(pageNumber);
    const rotation = options.rotation ?? 0;
    const viewport = page.getViewport({ scale: options.scale, rotation });
    const ratio = Math.max(1, options.pixelRatio ?? 1);
    canvas.width = Math.max(1, Math.round(viewport.width * ratio));
    canvas.height = Math.max(1, Math.round(viewport.height * ratio));
    canvas.style.width = `${Math.round(viewport.width)}px`;
    canvas.style.height = `${Math.round(viewport.height)}px`;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('This document cannot be drawn on this screen.');
    await page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
    return { width: viewport.width, height: viewport.height };
  };

  return {
    numPages: doc.numPages,
    async getPageSize(pageNumber, rotation = 0) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1, rotation });
      return { width: viewport.width, height: viewport.height };
    },
    async renderPage(pageNumber, canvas, options) {
      const previous = renderQueues.get(canvas) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(() => drawPage(pageNumber, canvas, options));
      renderQueues.set(canvas, run);
      try {
        return await run;
      } finally {
        if (renderQueues.get(canvas) === run) renderQueues.delete(canvas);
      }
    },
    async getPageText(pageNumber) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      return content.items
        .map((item) => item.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    destroy: () => task.destroy(),
  };
}
