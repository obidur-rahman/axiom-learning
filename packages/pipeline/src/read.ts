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

/**
 * Branding burned into the page by a phone scanning app. OCR reads that crisp
 * printed stamp far more reliably than handwriting, so on a CamScanner-style
 * scan it is often the only "text" a page yields. It must never reach the
 * pipeline as content, and a page carrying nothing else is unread.
 */
const SCAN_FURNITURE: RegExp[] = [
  /scanned\s+(?:by|with|using)\s+cam\s*scanner/gi,
  /\bcam\s*scanner\b/gi,
  /scanned\s+(?:by|with|using)\s+(?:adobe\s+scan|microsoft\s+lens|tiny\s+scanner|simple\s+scan|vflat|genius\s+scan)/gi,
  /\b(?:adobe\s+scan|microsoft\s+lens|vflat)\b/gi,
];

/** Removes scanner-app watermarks and the whitespace they leave behind. */
export function stripScanFurniture(text: string): string {
  let out = text;
  for (const pattern of SCAN_FURNITURE) out = out.replace(pattern, ' ');
  return out
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Counts letters and digits in any script, so Bangla counts as content. */
export function meaningfulLength(text: string | null): number {
  if (text === null) return 0;
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/**
 * A page this short carries no study content: a scan with only its watermark
 * left, a blank page, or OCR noise. Vision models fake fluency, so the bar is
 * a character count rather than any confidence the transcriber reports.
 */
export const MIN_USABLE_CHARS = 40;

export function hasUsableText(text: string | null, minChars = MIN_USABLE_CHARS): boolean {
  return meaningfulLength(stripScanFurniture(text ?? '')) >= minChars;
}

/** True when the page still needs an image read (vision, then OCR). */
export function pageNeedsImageRead(
  page: ExtractedPage,
  minChars = MIN_USABLE_CHARS,
): boolean {
  return !hasUsableText(page.text, minChars);
}

export { EMPTY_TEXT_ERROR };
