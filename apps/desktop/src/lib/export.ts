/**
 * Exports for a parsed page or a whole material.
 *
 * The OCR read is Markdown with LaTeX maths, so the only truly lossless export
 * is the LaTeX one: this turns the page text into a standalone `.tex` file that
 * compiles as-is and can be edited in any editor. A page can also be saved as a
 * Word-openable `.doc` (HTML + MathML, which Word understands) and sent to the
 * print dialog as PDF, where the browser's print engine renders the same KaTeX
 * that is on screen.
 *
 * No new dependency: KaTeX already runs in the app, and Word opens HTML.
 */
import katex from 'katex';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';

export interface ExportPage {
  pageNumber: number;
  text: string;
  method?: string;
}

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (char) => LATEX_ESCAPES[char] ?? char);
}

const INLINE_MATH =
  /^(?:\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$)/;
const BOLD = /^\*\*([\s\S]+?)\*\*/;
const ITALIC = /^\*([^*\n]+?)\*/;
const CODE_SPAN = /^`([^`\n]+)`/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)/;
const PLAIN_CHUNK = /^[^\\$`*[]+/;

/** One line of Markdown, converted to LaTeX with its maths left untouched. */
function inlineLatex(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const math = INLINE_MATH.exec(rest);
    if (math !== null) {
      const display = math[1] !== undefined || math[3] !== undefined;
      const expression = (math[1] ?? math[2] ?? math[3] ?? math[4] ?? '').trim();
      out += display ? `\n\\[\n${expression}\n\\]\n` : `$${expression}$`;
      index += math[0].length;
      continue;
    }
    const code = CODE_SPAN.exec(rest);
    if (code !== null) {
      out += `\\texttt{${escapeLatex(code[1] ?? '')}}`;
      index += code[0].length;
      continue;
    }
    const bold = BOLD.exec(rest);
    if (bold !== null) {
      out += `\\textbf{${inlineLatex(bold[1] ?? '')}}`;
      index += bold[0].length;
      continue;
    }
    const italic = ITALIC.exec(rest);
    if (italic !== null) {
      out += `\\emph{${inlineLatex(italic[1] ?? '')}}`;
      index += italic[0].length;
      continue;
    }
    const link = LINK.exec(rest);
    if (link !== null) {
      const url = (link[2] ?? '').replace(/[\\{}%]/g, (char) => encodeURIComponent(char));
      out += `\\href{${url}}{${inlineLatex(link[1] ?? '')}}`;
      index += link[0].length;
      continue;
    }
    const chunk = PLAIN_CHUNK.exec(rest);
    if (chunk !== null) {
      out += escapeLatex(chunk[0]);
      index += chunk[0].length;
      continue;
    }
    out += escapeLatex(source[index] ?? '');
    index += 1;
  }
  return out;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(?:[-*_]\s*){3,}$/;
const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?$/;

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Markdown body -> LaTeX body. Headings, lists, tables, quotes and code. */
function bodyToLatex(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push(inlineLatex(paragraph.join(' ')));
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
      index += 1;
      continue;
    }

    const fence = FENCE.exec(trimmed);
    if (fence !== null) {
      flush();
      const marker = fence[1] ?? '```';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith(marker)) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push(['\\begin{verbatim}', ...code, '\\end{verbatim}'].join('\n'));
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading !== null) {
      flush();
      const level = (heading[1] ?? '#').length;
      const command =
        level === 1 ? 'section' : level === 2 ? 'subsection' : level === 3 ? 'subsubsection' : 'paragraph';
      blocks.push(`\\${command}*{${inlineLatex((heading[2] ?? '').trim())}}`);
      index += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      flush();
      blocks.push('\\begin{center}\\rule{0.4\\linewidth}{0.4pt}\\end{center}');
      index += 1;
      continue;
    }

    if (trimmed.startsWith('|') && TABLE_SEPARATOR.test((lines[index + 1] ?? '').trim())) {
      flush();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        rows.push(splitRow((lines[index] ?? '').trim()));
        index += 1;
      }
      const columns = Math.max(header.length, ...rows.map((row) => row.length), 1);
      const cells = (row: string[]) => {
        const padded = [...row];
        while (padded.length < columns) padded.push('');
        return padded.map((cell) => inlineLatex(cell)).join(' & ') + ' \\\\';
      };
      blocks.push(
        [
          '\\begin{center}',
          `\\begin{tabular}{${'l'.repeat(columns)}}`,
          '\\hline',
          header.map((cell) => `\\textbf{${inlineLatex(cell)}}`).join(' & ') + ' \\\\',
          '\\hline',
          ...rows.map(cells),
          '\\hline',
          '\\end{tabular}',
          '\\end{center}',
        ].join('\n'),
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const raw = lines[index] ?? '';
        const match = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
        if (match === null || /^\s*\d/.test(raw) !== ordered) break;
        items.push(`\\item ${inlineLatex(match[1] ?? '')}`);
        index += 1;
      }
      const environment = ordered ? 'enumerate' : 'itemize';
      blocks.push([`\\begin{${environment}}`, ...items, `\\end{${environment}}`].join('\n'));
      continue;
    }

    if (trimmed.startsWith('>')) {
      flush();
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quote.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(['\\begin{quote}', bodyToLatex(quote.join('\n')), '\\end{quote}'].join('\n'));
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flush();
  return blocks.join('\n\n').trim();
}

function renderMath(expression: string, display: boolean): string {
  try {
    return katex.renderToString(expression, {
      displayMode: display,
      throwOnError: false,
      output: 'htmlAndMathml',
    });
  } catch {
    return `<code>${escapeHtml(expression)}</code>`;
  }
}

/** One line of Markdown to HTML, with real KaTeX markup for the maths. */
function inlineHtml(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const math = INLINE_MATH.exec(rest);
    if (math !== null) {
      const display = math[1] !== undefined || math[3] !== undefined;
      const expression = (math[1] ?? math[2] ?? math[3] ?? math[4] ?? '').trim();
      out += renderMath(expression, display);
      index += math[0].length;
      continue;
    }
    const code = CODE_SPAN.exec(rest);
    if (code !== null) {
      out += `<code>${escapeHtml(code[1] ?? '')}</code>`;
      index += code[0].length;
      continue;
    }
    const bold = BOLD.exec(rest);
    if (bold !== null) {
      out += `<strong>${inlineHtml(bold[1] ?? '')}</strong>`;
      index += bold[0].length;
      continue;
    }
    const italic = ITALIC.exec(rest);
    if (italic !== null) {
      out += `<em>${inlineHtml(italic[1] ?? '')}</em>`;
      index += italic[0].length;
      continue;
    }
    const link = LINK.exec(rest);
    if (link !== null) {
      out += `<a href="${escapeHtml(link[2] ?? '')}">${inlineHtml(link[1] ?? '')}</a>`;
      index += link[0].length;
      continue;
    }
    const chunk = PLAIN_CHUNK.exec(rest);
    if (chunk !== null) {
      out += escapeHtml(chunk[0]);
      index += chunk[0].length;
      continue;
    }
    out += escapeHtml(source[index] ?? '');
    index += 1;
  }
  return out;
}

/** Markdown body to HTML blocks. Mirrors bodyToLatex, for Word and print. */
function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${inlineHtml(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
      index += 1;
      continue;
    }

    const fence = FENCE.exec(trimmed);
    if (fence !== null) {
      flush();
      const marker = fence[1] ?? '```';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith(marker)) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading !== null) {
      flush();
      const level = Math.min(6, (heading[1] ?? '#').length + 1);
      blocks.push(`<h${level}>${inlineHtml((heading[2] ?? '').trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (RULE.test(trimmed)) {
      flush();
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    if (trimmed.startsWith('|') && TABLE_SEPARATOR.test((lines[index + 1] ?? '').trim())) {
      flush();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        rows.push(splitRow((lines[index] ?? '').trim()));
        index += 1;
      }
      blocks.push(
        [
          '<table>',
          `<thead><tr>${header.map((cell) => `<th>${inlineHtml(cell)}</th>`).join('')}</tr></thead>`,
          '<tbody>',
          ...rows.map(
            (row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell)}</td>`).join('')}</tr>`,
          ),
          '</tbody>',
          '</table>',
        ].join(''),
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const raw = lines[index] ?? '';
        const match = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
        if (match === null || /^\s*\d/.test(raw) !== ordered) break;
        items.push(`<li>${inlineHtml(match[1] ?? '')}</li>`);
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (trimmed.startsWith('>')) {
      flush();
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quote.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flush();
  return blocks.join('\n');
}

/** One HTML document body for every read page, for Word and print. */
export function buildDocumentHtml({
  title,
  pages,
}: {
  title: string;
  pages: ExportPage[];
}): string {
  const kept = pages.filter((page) => page.text.trim() !== '');
  const body = kept
    .map((page) =>
      [
        '<section class="export-page">',
        `<p class="export-page-number">Page ${page.pageNumber}${
          page.method === undefined ? '' : ` · ${escapeHtml(page.method)}`
        }</p>`,
        markdownToHtml(page.text),
        '</section>',
      ].join('\n'),
    )
    .join('\n');
  return [
    '<article class="parsed-document export-sheet">',
    `<h1 class="export-title">${escapeHtml(title)}</h1>`,
    body === '' ? '<p>No readable text was found in this export.</p>' : body,
    '</article>',
  ].join('\n');
}

/** A standalone LaTeX document from one or more read pages. */
export function buildLatexDocument({
  title,
  pages,
}: {
  title: string;
  pages: ExportPage[];
}): string {
  const kept = pages.filter((page) => page.text.trim() !== '');
  const sections = kept.map((page) => {
    const marker = `% ===== page ${page.pageNumber}${
      page.method === undefined ? '' : ` · ${page.method}`
    } =====`;
    const heading = kept.length > 1 ? `\\section*{Page ${page.pageNumber}}\n\n` : '';
    return `${marker}\n${heading}${bodyToLatex(page.text)}`;
  });
  const body =
    sections.length === 0
      ? '% No readable text was found in this export.'
      : sections.join('\n\n\\medskip\\hrule\\medskip\n\n');

  return [
    '% Exported from Axiom. Edit freely and compile with pdflatex or xelatex.',
    '\\documentclass[11pt,a4paper]{article}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[a4paper,margin=25mm]{geometry}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{hyperref}',
    '\\setlength{\\parindent}{0pt}',
    '\\setlength{\\parskip}{0.6em}',
    `\\title{${escapeLatex(title)}}`,
    '\\date{}',
    '\\begin{document}',
    '\\maketitle',
    '',
    body,
    '',
    '\\end{document}',
    '',
  ].join('\n');
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'page' : cleaned;
}

export type ExportProgress = (message: string, percent: number) => void;

/** What a finished export leaves behind, so the screen can offer "Open". */
export interface ExportResult {
  filename: string;
  blob: Blob;
  /** PDFs can be shown in a tab; Word and LaTeX cannot. */
  openable: boolean;
}


interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface SaveHandleLike {
  createWritable(): Promise<WritableLike>;
}

interface SaveTarget {
  filename: string;
  handle: SaveHandleLike | null;
}

/**
 * Prefer the browser's save dialog: it confirms where the file went, which the
 * silent download anchor cannot. A webview without the File System Access API
 * falls back to a download, and the screen says so.
 */
async function pickSaveTarget(
  filename: string,
  description: string,
  mime: string,
  extension: string,
): Promise<SaveTarget | null> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: {
        suggestedName?: string;
        types?: { description?: string; accept: Record<string, string[]> }[];
      }) => Promise<SaveHandleLike>;
    }
  ).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description, accept: { [mime]: [extension] } }],
      });
      return { filename, handle };
    } catch (error) {
      // The learner cancelled: do not then dump a copy into Downloads.
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      // A blocked picker (sandbox, older webview) falls through to download.
    }
  }
  return { filename, handle: null };
}

async function writeTarget(target: SaveTarget, blob: Blob): Promise<void> {
  if (target.handle !== null) {
    const writable = await target.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = target.filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some webviews.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });
}

/**
 * Word opens an HTML file with a .doc extension. KaTeX's visual HTML is
 * stripped and its MathML kept: Word understands MathML, while the absolutely
 * positioned KaTeX spans depend on CSS that Word will not load.
 */
function wordDocumentHtml(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 2.2cm; }
  body { font-family: Cambria, Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.5; color: #111; }
  h1 { font-size: 16pt; }
  h2 { font-size: 13.5pt; }
  h3 { font-size: 12pt; }
  p { margin: 0 0 8pt; }
  .katex-html { display: none; }
  .katex-mathml { position: static; clip: auto; width: auto; height: auto; overflow: visible; }
  math { font-family: 'Cambria Math', Cambria, serif; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #999; padding: 3pt 5pt; }
  .chip, .btn { display: none; }
  .export-title { font-size: 20pt; margin: 0 0 12pt; }
  .export-page + .export-page { margin-top: 14pt; padding-top: 10pt; border-top: 1px solid #ddd; }
  .export-page-number { font-size: 8pt; letter-spacing: 0.06em; text-transform: uppercase; color: #666; margin: 0 0 8pt; }
  .export-note { font-size: 9pt; color: #666; }
</style>
</head>
<body>
<p class="export-note">Maths is embedded as MathML. For perfectly typeset equations, use the LaTeX export.</p>
${bodyHtml}
</body>
</html>`;
}

/** A4 at 96 dpi, so the captured sheet matches the paper exactly. */
const PDF_WIDTH_PX = 794;
const PDF_IMAGE_SCALE = 2;


function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Vertical padding of .pdf-sheet, and the content height it leaves on A4. */
const PDF_MARGIN_Y_PX = 54;
const SHEET_CONTENT_HEIGHT_PX = 1123 - PDF_MARGIN_Y_PX * 2 - 6;

interface SheetEntry {
  element: HTMLElement;
  height: number;
  lead: number;
}

/**
 * Finds a blank pixel row in the band just above a page boundary. Cutting at a
 * blank row keeps a line of text or a formula whole, and lets each page fill
 * naturally instead of ending at a fixed height with a large white tail.
 */
function findBlankRow(
  context: CanvasRenderingContext2D,
  width: number,
  from: number,
  to: number,
): number | null {
  const height = to - from;
  if (height <= 0) return null;
  const data = context.getImageData(0, from, width, height).data;
  for (let row = height - 1; row >= 0; row -= 1) {
    const base = row * width * 4;
    let blank = true;
    for (let x = 0; x < width; x += 3) {
      const index = base + x * 4;
      if (data[index]! < 242 || data[index + 1]! < 242 || data[index + 2]! < 242) {
        blank = false;
        break;
      }
    }
    if (blank) return from + row;
  }
  return null;
}

/**
 * Renders the document to A4 pages. Short source pages share a printed page
 * instead of each taking one, and every boundary is moved to a blank row, so
 * the result reads as one continuous document rather than a stack of
 * half-empty screenshots.
 */
async function renderPdf(element: HTMLElement, onProgress?: ExportProgress): Promise<Blob> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${PDF_WIDTH_PX}px;background:#ffffff;`;
  document.body.appendChild(host);

  try {
    if (document.fonts !== undefined) await document.fonts.ready;
    const sections = Array.from(element.querySelectorAll<HTMLElement>('.export-page'));
    const title = element.querySelector<HTMLElement>('.export-title');
    const blocks: HTMLElement[] = sections.length > 0 ? sections : [element];

    // Measure at the real page width first, so short pages can be packed.
    onProgress?.('Measuring the document', 4);
    const measure = document.createElement('div');
    measure.className = 'pdf-sheet';
    if (title !== null) measure.appendChild(title.cloneNode(true));
    const clones = blocks.map((block) => block.cloneNode(true) as HTMLElement);
    for (const clone of clones) measure.appendChild(clone);
    host.replaceChildren(measure);
    await nextFrame();

    const titleNode = measure.querySelector<HTMLElement>('.export-title');
    const rects = clones.map((clone) => clone.getBoundingClientRect());
    // Title block = its own height plus the real gap the browser used before
    // the first section, not a guessed margin.
    const titleHeight =
      titleNode === null || rects.length === 0
        ? 0
        : Math.max(0, (rects[0]?.top ?? 0) - titleNode.getBoundingClientRect().top);
    const entries: SheetEntry[] = clones.map((clone, index) => ({
      element: clone,
      height: rects[index]?.height ?? 0,
      lead:
        index === 0
          ? 0
          : Math.max(0, (rects[index]?.top ?? 0) - (rects[index - 1]?.bottom ?? 0)),
    }));

    const groups: SheetEntry[][] = [];
    let group: SheetEntry[] = [];
    let used = 0;
    let first = true;
    const flush = () => {
      if (group.length === 0) return;
      groups.push(group);
      group = [];
      used = 0;
      first = false;
    };

    for (const entry of entries) {
      const lead = group.length === 0 ? 0 : entry.lead;
      const titleSpace = group.length === 0 && first ? titleHeight : 0;
      if (entry.height + lead > SHEET_CONTENT_HEIGHT_PX) {
        // One source page taller than a printed page: it spans pages on its own.
        flush();
        groups.push([entry]);
        first = false;
        used = 0;
        continue;
      }
      if (group.length > 0 && used + lead + entry.height > SHEET_CONTENT_HEIGHT_PX) {
        flush();
        used = entry.height;
        group.push(entry);
        continue;
      }
      used += (group.length === 0 ? titleSpace : 0) + (group.length === 0 ? 0 : lead) + entry.height;
      group.push(entry);
    }
    flush();

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    let pageCount = 0;
    for (const [index, sheetEntries] of groups.entries()) {
      onProgress?.(
        `Laying out sheet ${index + 1} of ${groups.length}`,
        5 + Math.round((index / Math.max(1, groups.length)) * 45),
      );
      const sheet = document.createElement('div');
      sheet.className = 'pdf-sheet';
      if (index === 0 && title !== null) sheet.appendChild(title.cloneNode(true));
      for (const entry of sheetEntries) sheet.appendChild(entry.element.cloneNode(true));
      host.replaceChildren(sheet);
      await nextFrame();

      const canvas = await html2canvas(sheet, {
        scale: PDF_IMAGE_SCALE,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('The PDF canvas could not be created.');

      const pageHeight = Math.floor((canvas.width * 297) / 210);
      let offset = 0;
      while (offset < canvas.height) {
        const remaining = canvas.height - offset;
        // Rounding can leave one or two blank rows; do not make a page of them.
        if (remaining <= 3) break;
        let height = Math.min(pageHeight, remaining);
        if (remaining > pageHeight) {
          const window = Math.round(pageHeight * 0.25);
          const blank = findBlankRow(
            context,
            canvas.width,
            offset + pageHeight - window,
            offset + pageHeight,
          );
          // Never cut so early that the page comes out half empty.
          if (blank !== null && blank - offset > pageHeight * 0.5) height = blank - offset;
        }

        const page = document.createElement('canvas');
        page.width = canvas.width;
        page.height = height;
        const pageContext = page.getContext('2d');
        if (pageContext === null) break;
        pageContext.fillStyle = '#ffffff';
        pageContext.fillRect(0, 0, page.width, page.height);
        pageContext.drawImage(canvas, 0, offset, canvas.width, height, 0, 0, canvas.width, height);

        if (pageCount > 0) pdf.addPage();
        pageCount += 1;
        onProgress?.(
          `Writing PDF page ${pageCount}`,
          55 + Math.round((index / Math.max(1, groups.length)) * 40),
        );
        pdf.addImage(
          page.toDataURL('image/jpeg', 0.92),
          'JPEG',
          0,
          0,
          210,
          (height / canvas.width) * 210,
          undefined,
          'FAST',
        );
        offset += height;
      }
    }

    onProgress?.('PDF ready', 100);
    return pdf.output('blob');
  } finally {
    host.remove();
  }
}

/** The editable LaTeX source of one page or a whole material. */
export async function exportLatex({
  title,
  pages,
  filename,
}: {
  title: string;
  pages: ExportPage[];
  filename: string;
}): Promise<ExportResult | null> {
  const target = await pickSaveTarget(filename, 'LaTeX document', 'text/x-tex', '.tex');
  if (target === null) return null;
  const content = buildLatexDocument({ title, pages });
  const blob = new Blob([content], { type: 'text/x-tex;charset=utf-8' });
  await writeTarget(target, blob);
  return { filename, blob, openable: false };
}

/** Every read page as one Word-openable document. */
export async function exportWord({
  title,
  pages,
  filename,
}: {
  title: string;
  pages: ExportPage[];
  filename: string;
}): Promise<ExportResult | null> {
  const target = await pickSaveTarget(filename, 'Word document', 'application/msword', '.doc');
  if (target === null) return null;
  const html = wordDocumentHtml(buildDocumentHtml({ title, pages }), title);
  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  await writeTarget(target, blob);
  return { filename, blob, openable: false };
}

/** One rendered page as a Word-openable document. */
export async function exportWordFromElement({
  element,
  title,
  filename,
}: {
  element: HTMLElement;
  title: string;
  filename: string;
}): Promise<ExportResult | null> {
  const target = await pickSaveTarget(filename, 'Word document', 'application/msword', '.doc');
  if (target === null) return null;
  const clone = element.cloneNode(true) as HTMLElement;
  for (const node of Array.from(clone.querySelectorAll('.katex-html'))) node.remove();
  for (const node of Array.from(clone.querySelectorAll('button, input, textarea, select'))) node.remove();
  clone.removeAttribute('aria-label');
  const blob = new Blob([wordDocumentHtml(clone.outerHTML, title)], {
    type: 'application/msword;charset=utf-8',
  });
  await writeTarget(target, blob);
  return { filename, blob, openable: false };
}

/** Every read page as one PDF, generated in the app and saved to a file. */
export async function exportPdf({
  title,
  pages,
  filename,
  onProgress,
}: {
  title: string;
  pages: ExportPage[];
  filename: string;
  onProgress?: ExportProgress;
}): Promise<ExportResult | null> {
  const target = await pickSaveTarget(filename, 'PDF document', 'application/pdf', '.pdf');
  if (target === null) return null;
  const holder = document.createElement('div');
  holder.innerHTML = buildDocumentHtml({ title, pages });
  const article = holder.firstElementChild;
  if (article === null) throw new Error('The document could not be built.');
  const blob = await renderPdf(article as HTMLElement, onProgress);
  await writeTarget(target, blob);
  return { filename, blob, openable: true };
}

/** One rendered page as a PDF (the page already on screen). */
export async function exportPdfFromElement({
  element,
  filename,
  onProgress,
}: {
  element: HTMLElement;
  filename: string;
  onProgress?: ExportProgress;
}): Promise<ExportResult | null> {
  const target = await pickSaveTarget(filename, 'PDF document', 'application/pdf', '.pdf');
  if (target === null) return null;
  const blob = await renderPdf(element, onProgress);
  await writeTarget(target, blob);
  return { filename, blob, openable: true };
}
