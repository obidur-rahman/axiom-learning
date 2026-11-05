/**
 * Page extraction for the read step (FR-022 / FR-023): PDF text layer first,
 * tesseract.js OCR for scanned/imaged PDFs, vision fallback when the local
 * provider has no OCR and the page still has no text. All heavy libraries
 * load dynamically so the first paint of the app stays fast.
 */
import type { ExtractedPage, PageExtractors } from '@axiom/pipeline';

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

/** Renders one page of an open PDF to a PNG, as base64 without the prefix. */
async function renderPagePng(doc: PdfDocumentProxy, pageNumber: number, scale = 2): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas unavailable');
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

/** Renders one PDF page to a PNG (base64) for the vision read path. */
export async function pdfPageToBase64Png(
  data: ArrayBuffer,
  pageNumber: number,
  scale = 2,
): Promise<string> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data, useSystemFonts: false, disableAutoFetch: true });
  const doc = await task.promise;
  try {
    return await renderPagePng(doc, pageNumber, scale);
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
 * Extracts the text layer of every PDF page; null text when it has none.
 * `onProgress` fires after each page so the screen can show how far it got.
 */
export async function extractPdfTextLayer(
  data: ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfJs();
  // Hand pdf.js a copy: the caller keeps the bytes for the OCR/vision pass,
  // and a detached buffer would make that second read fail.
  const task = pdfjs.getDocument({ data: data.slice(0), useSystemFonts: false, disableAutoFetch: true });
  const doc = await task.promise;
  try {
    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str ?? '').join(' ').trim();
      pages.push({
        pageNumber,
        text: text === '' ? null : text,
        method: 'text_layer',
        confidence: text === '' ? null : 1,
      });
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
  return {
    pageNumber: 1,
    text: result.text.trim() === '' ? null : result.text.trim(),
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
}

/** OCR text below this is treated as unread and handed to the vision model. */
const OCR_MIN_CONFIDENCE = 0.45;

/**
 * Reads a PDF that has no text layer at all - a CamScanner-style scan of
 * handwritten pages. Every page is rendered and OCRed (one shared worker),
 * and pages OCR cannot read are sent to the vision model when one is set up.
 * Without this a multi-page scan collapsed to page 1 and the roadmap was
 * built from a single page.
 */
export async function extractScannedPdf(
  data: ArrayBuffer,
  options: {
    onProgress?: (progress: ScanProgress) => void;
    readVision?: (image: VisionImage) => Promise<ExtractedPage>;
  } = {},
): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: data.slice(0), useSystemFonts: false, disableAutoFetch: true });
  const doc = await task.promise;
  try {
    const pages: ExtractedPage[] = [];
    const worker = await getOcrWorker();
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const image = await renderPagePng(doc, pageNumber);
      const { data: result } = await worker.recognize(`data:image/png;base64,${image}`);
      let page: ExtractedPage = { ...ocrResultToPage(result), pageNumber, method: 'ocr' };
      let method: ScanProgress['method'] = 'ocr';
      const unreadable = page.text === null || (page.confidence ?? 0) < OCR_MIN_CONFIDENCE;
      if (unreadable && options.readVision !== undefined) {
        try {
          const vision = await options.readVision({ base64: image, mime: 'image/png' });
          if (vision.text !== null) {
            page = { ...vision, pageNumber };
            method = 'vision';
          }
        } catch {
          // Keep the OCR text; the page stays flagged low-confidence.
        }
      }
      pages.push(page);
      options.onProgress?.({ page: pageNumber, total: doc.numPages, method });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** Vision fallback: ask the configured provider to read one image page. */
export interface VisionImage {
  base64: string;
  mime: string;
}

export function makeVisionReader(
  config: () => Promise<ProviderConfigInput | null>,
): (image: VisionImage) => Promise<ExtractedPage> {
  return async (image) => {
    const provider = await config();
    if (provider === null) throw new Error('No provider configured for vision read.');
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.chatModel,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${image.mime};base64,${image.base64}` },
              },
              { type: 'text', text: 'Transcribe all visible text. Reply with plain text only.' },
            ],
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`vision read failed: HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? '';
    return {
      pageNumber: 1,
      text: text.trim() === '' ? null : text.trim(),
      method: 'vision',
      confidence: 0.9,
    };
  };
}

export interface ProviderConfigInput {
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
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

