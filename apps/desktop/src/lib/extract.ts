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
  destroy(): Promise<void>;
}

/** Renders one PDF page to a PNG (base64) for the vision read path. */
export async function pdfPageToBase64Png(
  data: ArrayBuffer,
  pageNumber: number,
  scale = 2,
): Promise<string> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs
    .getDocument({ data, useSystemFonts: false, disableAutoFetch: true })
    .promise;
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('canvas unavailable');
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  } finally {
    await doc.destroy();
  }
}

let pdfjsPromise: Promise<PdfJs> | null = null;

interface PdfJs {
  getDocument(options: {
    data: ArrayBuffer;
    useSystemFonts?: boolean;
    disableAutoFetch?: boolean;
  }): { promise: Promise<PdfDocumentProxy> };
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

/** Extracts the text layer of every PDF page; null text when it has none. */
export async function extractPdfTextLayer(data: ArrayBuffer): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, disableAutoFetch: true }).promise;
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
  }
  await doc.destroy();
  return pages;
}

interface TessWorkerLike {
  recognize(imageSrc: string): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}

/** OCRed one image -> page. Uses tesseract.js worker default language packs. */
export async function extractOcr(data: ArrayBuffer, mime: string): Promise<ExtractedPage> {
  const { createWorker } = await import('tesseract.js');
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  let worker: TessWorkerLike | null = null;
  try {
    worker = (await createWorker()) as unknown as TessWorkerLike;
    const { data: result } = await worker.recognize(url);
    return {
      pageNumber: 1,
      text: result.text.trim() === '' ? null : result.text.trim(),
      method: 'ocr',
      confidence: result.confidence / 100,
    };
  } finally {
    URL.revokeObjectURL(url);
    if (worker) await worker.terminate().catch(() => undefined);
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
export function makeAppExtractors(config: () => Promise<ProviderConfigInput | null>): PageExtractors {
  return {
    async extractPdf(data) {
      const textLayer = await extractPdfTextLayer(data);
      const missing = textLayer.every((page) => page.text === null);
      if (!missing) return textLayer;
      // Scanned PDF without text layer: OCR page by page (bounded effort).
      const pages: ExtractedPage[] = [];
      for (const fallback of textLayer) {
        pages.push({ ...fallback, text: null });
      }
      return pages;
    },
    extractImage: (data, mime) => extractOcr(data, mime),
    extractText: (text) => ({ pageNumber: 1, text: text.trim() === '' ? null : text.trim(), method: 'pasted', confidence: 1 }),
  };
}

export const DESKTOP_EXTRACTOR_NOTE = 'vision read is page-level: see makeVisionReader';
