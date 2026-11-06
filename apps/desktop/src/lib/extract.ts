/**
 * Page extraction for the read step (FR-022 / FR-023). Printed PDFs go through
 * the text layer; image-only pages are rendered to a downscaled JPEG and read
 * by the OCR model first, because a phone scan of handwriting is exactly what
 * OCR is worst at. tesseract.js is the fallback when no model is configured or
 * the model fails. All heavy libraries load dynamically so the first paint of
 * the app stays fast.
 */
import { beforeModelCall, getFetch, normalizeBaseUrl, type ProviderConfig } from '@axiom/ai';
import {
  hasUsableText,
  meaningfulLength,
  stripScanFurniture,
  type ExtractedPage,
  type PageExtractors,
} from '@axiom/pipeline';

interface PdfPageProxy {
  getTextContent(): Promise<{ items: { str?: string }[] }>;
  getViewport(options: { scale: number }): {
    width: number;
    height: number;
  };
  render(options: unknown): { promise: Promise<void> };
}

interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
}

/** pdf.js v6 moved cleanup from the document proxy to the loading task. */
interface PdfLoadingTask {
  promise: Promise<PdfDocumentProxy>;
  destroy(): Promise<void>;
}

/**
 * Long edge sent to the OCR model. Larger looks no better and costs far more:
 * a 300-dpi phone scan is ~3500 px tall, and every vision model downsamples it
 * anyway. The settings screen raises or lowers this.
 */
export const DEFAULT_OCR_MAX_EDGE = 1400;
const OCR_JPEG_QUALITY = 0.82;

/**
 * Renders one page to a JPEG, never larger than `maxEdge` on its long side.
 */
async function renderPageJpeg(
  doc: PdfDocumentProxy,
  pageNumber: number,
  maxEdge = DEFAULT_OCR_MAX_EDGE,
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const longest = Math.max(base.width, base.height);
  const scale = Math.min(2, maxEdge / Math.max(1, longest));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas unavailable');
  // JPEG has no alpha channel: unpainted areas would otherwise come out black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/jpeg', OCR_JPEG_QUALITY).split(',')[1] ?? '';
}

/** Renders one PDF page as a JPEG ready for the OCR model. */
export async function pdfPageToBase64Image(
  data: ArrayBuffer,
  pageNumber: number,
  maxEdge = DEFAULT_OCR_MAX_EDGE,
): Promise<VisionImage> {
  const pdfjs = await loadPdfJs();
  // getDocument detaches the buffer it is handed, so pass a copy.
  const task = pdfjs.getDocument({ data: data.slice(0), useSystemFonts: false, disableAutoFetch: true });
  const doc = await task.promise;
  try {
    return { base64: await renderPageJpeg(doc, pageNumber, maxEdge), mime: 'image/jpeg' };
  } finally {
    await task.destroy();
  }
}

let pdfjsPromise: Promise<PdfJs> | null = null;

interface PdfJs {
  getDocument(options: {
    data: ArrayBuffer;
    useSystemFonts?: boolean;
    disableAutoFetch?: boolean;
  }): PdfLoadingTask;
  GlobalWorkerOptions: { workerSrc: string };
}

async function loadPdfJs(): Promise<PdfJs> {
  if (pdfjsPromise === null) {
    pdfjsPromise = (async () => {
      const pdfjs = (await import('pdfjs-dist')) as unknown as PdfJs;
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * Extracts the text layer of every PDF page; null text when the page has none
 * left after the scanner watermark is removed. `onProgress` fires after each
 * page so the screen can show how far it got; `onPage` persists each page the
 * moment it is known.
 */
export async function extractPdfTextLayer(
  data: ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
  signal?: AbortSignal,
  onPage?: (page: ExtractedPage) => Promise<void> | void,
): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfJs();
  // Hand pdf.js a copy: the caller keeps the bytes for the OCR/vision pass,
  // and a detached buffer would make that second read fail.
  const task = pdfjs.getDocument({ data: data.slice(0), useSystemFonts: false, disableAutoFetch: true });
  const doc = await task.promise;
  try {
    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const raw = content.items.map((item) => item.str ?? '').join(' ');
      // A scan whose only text layer is "Scanned by CamScanner" is a scan: it
      // must be read as an image, not accepted as page text.
      const text = stripScanFurniture(raw);
      const usable = hasUsableText(text);
      const extracted: ExtractedPage = {
        pageNumber,
        text: usable ? text : null,
        method: 'text_layer',
        confidence: usable ? 1 : null,
      };
      pages.push(extracted);
      await onPage?.(extracted);
      onProgress?.(pageNumber, doc.numPages);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

interface TessWorkerLike {
  recognize(imageSrc: string): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}

let ocrWorker: Promise<TessWorkerLike> | null = null;

/** One tesseract worker per session: wasm init is the slow part per file. */
function getOcrWorker(): Promise<TessWorkerLike> {
  if (ocrWorker === null) {
    ocrWorker = (async () => {
      const { createWorker } = await import('tesseract.js');
      return (await createWorker()) as unknown as TessWorkerLike;
    })();
    ocrWorker.catch(() => {
      ocrWorker = null;
    });
  }
  return ocrWorker;
}

function ocrResultToPage(result: { text: string; confidence: number }): ExtractedPage {
  const text = stripScanFurniture(result.text);
  return {
    pageNumber: 1,
    text: hasUsableText(text) ? text : null,
    method: 'ocr',
    confidence: result.confidence / 100,
  };
}

/** OCRed one image -> page. Uses tesseract.js worker default language packs. */
export async function extractOcr(data: ArrayBuffer, mime: string): Promise<ExtractedPage> {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const worker = await getOcrWorker();
    const { data: result } = await worker.recognize(url);
    return ocrResultToPage(result);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface ScanProgress {
  page: number;
  total: number;
  method: 'ocr' | 'vision';
  /** Letters and digits in the page just read, so the UI can show real output. */
  chars: number;
}

/**
 * Reads PDF pages that carry no usable text layer - a CamScanner-style scan of
 * handwritten pages. Each page is rendered once, sent to the vision model when
 * one is configured, and OCRed only when the model is unset or fails: tesseract
 * cannot read handwriting, and its confidence on a crisp printed watermark is
 * high enough to outvote the vision read entirely.
 */
export async function extractScannedPdf(
  data: ArrayBuffer,
  options: {
    onProgress?: (progress: ScanProgress) => void;
    /** Fires as each page is finished, so it can be saved before the next one. */
    onPage?: (page: ExtractedPage) => Promise<void> | void;
    readVision?: (image: VisionImage) => Promise<ExtractedPage>;
    /** Reported once per distinct vision failure; never silently swallowed. */
    onVisionError?: (message: string) => void;
    /** Only these page numbers (1-based); every page when omitted. */
    onlyPages?: number[];
    /** Long edge of the rendered page image. */
    maxEdge?: number;
    /** Aborts the read between pages, leaving the saved pages untouched. */
    signal?: AbortSignal;
  } = {},
): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: data.slice(0), useSystemFonts: false, disableAutoFetch: true });
  const doc = await task.promise;
  try {
    const wanted = options.onlyPages === undefined ? null : new Set(options.onlyPages);
    const pages: ExtractedPage[] = [];
    let worker: TessWorkerLike | null = null;
    let lastVisionError: string | null = null;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      if (wanted !== null && !wanted.has(pageNumber)) continue;
      options.signal?.throwIfAborted();
      const image = await renderPageJpeg(doc, pageNumber, options.maxEdge);
      let page: ExtractedPage | null = null;
      let method: ScanProgress['method'] = 'vision';
      if (options.readVision !== undefined) {
        try {
          const read = await options.readVision({ base64: image, mime: 'image/jpeg' });
          if (hasUsableText(read.text)) page = { ...read, pageNumber };
        } catch (error) {
          // A stopped job must stop, not quietly drop to the OCR fallback.
          if (options.signal?.aborted === true) throw error;
          const message = error instanceof Error ? error.message : String(error);
          if (message !== lastVisionError) {
            lastVisionError = message;
            options.onVisionError?.(message);
          }
        }
      }
      if (page === null) {
        options.signal?.throwIfAborted();
        worker = worker ?? (await getOcrWorker());
        const { data: result } = await worker.recognize(`data:image/jpeg;base64,${image}`);
        page = { ...ocrResultToPage(result), pageNumber };
        method = 'ocr';
      }
      pages.push(page);
      // Save before reporting: by the time the screen hears about a page, the
      // page text is already in the database and can be previewed.
      await options.onPage?.(page);
      options.onProgress?.({
        page: pageNumber,
        total: doc.numPages,
        method,
        chars: meaningfulLength(page.text),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** Vision fallback: ask the configured OCR model to read one image page. */
export interface VisionImage {
  base64: string;
  mime: string;
}

/**
 * The model is a transcriber here, not a tutor: anything it adds is invented
 * text that later becomes a lesson or a quiz answer. It may repair a gap left
 * by a faint stroke or a cut-off edge, because a page of `x = [illegible] + 3`
 * is worse than no read at all, but it may not add content of its own.
 */
const VISION_SYSTEM_PROMPT = [
  'You transcribe photographed pages of study material into Markdown.',
  '1. Transcribe everything visible, in reading order: headings, question',
  '   numbers, body text, table cells and diagram labels.',
  '2. Write every mathematical expression as LaTeX: inline as $...$ and',
  '   display as $$...$$. Use \\frac, \\sqrt, \\int, \\sum, superscripts and',
  '   subscripts exactly as the page shows them. Never flatten a formula into',
  '   plain text.',
  '3. When handwriting, a smudge, a torn or cut-off edge, or a half-drawn',
  '   symbol leaves a gap, read the whole page first, decide what the subject',
  '   and the surrounding sentences require, and fill the gap with that most',
  '   likely reading. Complete a word, number, unit or symbol rather than',
  '   writing [illegible] or skipping it.',
  '4. Repair gaps only. Never invent a question, an answer, a step or a fact',
  '   the page does not contain, and never change a value that is legible.',
  '5. Keep the original language and wording. Do not translate, explain,',
  '   summarise, solve or add commentary.',
  '6. Ignore watermarks, logos, stamps and app branding (for example',
  '   "Scanned by CamScanner"). Do not transcribe page furniture such as',
  '   scanner borders unless it is part of the content.',
].join('\n');

const VISION_USER_PROMPT = 'Transcribe this page.';

/** The message an OpenAI-compatible error body carries, if it carries one. */
function providerErrorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (typeof parsed.error?.message === 'string') return parsed.error.message;
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return body.trim().slice(0, 200);
}

/**
 * A failed OCR request has to say what to fix. A 404 from a hosted endpoint is
 * nearly always a retired or misspelled model ID, not a broken URL.
 */
function visionErrorMessage(model: string, status: number, body: string): string {
  const detail = providerErrorText(body);
  const suffix = detail === '' ? '' : ` Provider said: ${detail}`;
  if (status === 404) {
    return (
      `OCR model "${model}" was not found at the endpoint (HTTP 404). ` +
      'It may have been retired; pick a current vision model in Settings.' +
      suffix
    );
  }
  if (status === 401 || status === 403) {
    return `The OCR request was refused (HTTP ${status}). Check the API key in Settings.${suffix}`;
  }
  return `OCR read failed: HTTP ${status}.${suffix}`;
}

export function makeVisionReader(
  config: () => Promise<ProviderConfig | null>,
  signal?: AbortSignal,
): (image: VisionImage) => Promise<ExtractedPage> {
  return async (image) => {
    const provider = await config();
    if (provider === null) throw new Error('No provider configured for the OCR read.');
    // The OCR role may be a different model from the chat role: swap the
    // local runtime to it before the image is sent.
    const model = provider.ocrModel ?? provider.chatModel;
    await beforeModelCall(model, 'vision');
    const response = await getFetch()(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      ...(signal === undefined ? {} : { signal }),
      body: JSON.stringify({
        model,
        temperature: 0,
        // Keep the whole reply budget for the transcript; a thinking VLM
        // otherwise spends it in the scratchpad and returns nothing.
        ...(provider.ocrMaxTokens === undefined ? {} : { max_tokens: provider.ocrMaxTokens }),
        ...(provider.ocrThink === undefined
          ? {}
          : {
              think: provider.ocrThink,
              ...(provider.ocrThink ? {} : { chat_template_kwargs: { enable_thinking: false } }),
            }),
        messages: [
          { role: 'system', content: VISION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${image.mime};base64,${image.base64}` },
              },
              { type: 'text', text: VISION_USER_PROMPT },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(visionErrorMessage(model, response.status, detail));
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string; reasoning?: string } }[];
    };
    const message = body.choices?.[0]?.message;
    const text = stripScanFurniture(message?.content ?? '');
    if (!hasUsableText(text)) {
      return { pageNumber: 1, text: null, method: 'vision', confidence: 0.9 };
    }
    return { pageNumber: 1, text, method: 'vision', confidence: 0.9 };
  };
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/** Composed extractor set used by the read step in the app worker. */
export function makeAppExtractors(): PageExtractors {
  return {
    // A scanned PDF comes back with every page textless; the read step OCRs it.
    extractPdf: extractPdfTextLayer,
    extractImage: (data, mime) => extractOcr(data, mime),
    extractText: (text) => ({ pageNumber: 1, text: text.trim() === '' ? null : text.trim(), method: 'pasted', confidence: 1 }),
  };
}
