import type { MaterialPage } from '@axiom/data';

/** One extracted page before persistence. */
export interface ExtractedPage {
  pageNumber: number;
  text: string | null;
  method: 'text_layer' | 'ocr' | 'vision' | 'pasted';
  confidence: number | null;
}

/**
 * Extraction implementations are injected so the pipeline stays testable:
 * the desktop app injects the pdf.js / tesseract.js / vision-model
 * implementations (they are heavy, so they load dynamically on use).
 */
export interface PageExtractors {
  /** PDF bytes -> one entry per page (method text_layer, or ocr for scans). */
  extractPdf(data: ArrayBuffer): Promise<ExtractedPage[]>;
  /** Image bytes -> OCR or vision (single page). */
  extractImage(data: ArrayBuffer, mime: string): Promise<ExtractedPage>;
  /** Pasted text (one page). */
  extractText(text: string): ExtractedPage;
}

export function pageIsLowConfidence(confidence: number | null, threshold = 0.75): boolean {
  return confidence !== null && confidence < threshold;
}

const EMPTY_TEXT_ERROR = 'page has no text; try pasting it in';

export function extractedToPages(
  materialId: string,
  pages: ExtractedPage[],
  existingId: (pageNumber: number) => string | undefined = () => undefined,
): MaterialPage[] {
  return pages.map((page) => ({
    id: existingId(page.pageNumber) ?? crypto.randomUUID(),
    materialId,
    pageNumber: page.pageNumber,
    text: page.text,
    extractionMethod: page.method,
    confidence: page.confidence,
    lowConfidence: pageIsLowConfidence(page.confidence),
  }));
}

export { EMPTY_TEXT_ERROR };
