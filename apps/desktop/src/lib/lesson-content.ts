/**
 * A saved lesson is Markdown (one H2 per teaching section). This turns that
 * single string into the slide deck the lesson view shows, without changing
 * the database format or older saved lessons.
 */
export type LessonSlideKind = 'concept' | 'steps' | 'compare' | 'math' | 'code';

export interface LessonSlide {
  title: string;
  markdown: string;
  /** Chosen from the section's own shapes, so slides gain a fitting layout. */
  kind: LessonSlideKind;
  /** A `> key idea` block, lifted out of the body into the slide footer. */
  takeaway: string | null;
}

export interface LessonCheckQuestion {
  prompt: string;
  answer: string;
}

export interface ParsedLesson {
  title: string;
  slides: LessonSlide[];
  /** The full lesson without the check-question block, for the read-all view. */
  readMarkdown: string;
  checkQuestions: LessonCheckQuestion[];
}

interface SectionAccumulator {
  title: string;
  lines: string[];
}

export function parseLessonContent(contentMd: string): ParsedLesson {
  const lines = contentMd.replace(/\r\n/g, '\n').split('\n');
  let title = 'Lesson';
  let intro: SectionAccumulator = { title: '', lines: [] };
  const sections: SectionAccumulator[] = [];
  let current: SectionAccumulator | null = null;
  let inFence = false;

  for (const line of lines) {
    // A heading inside a fenced code block is code, not a new slide.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      (current ?? intro).lines.push(line);
      continue;
    }
    if (inFence) {
      (current ?? intro).lines.push(line);
      continue;
    }
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1 !== null && sections.length === 0 && current === null) {
      title = h1[1] ?? title;
      continue;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2 !== null) {
      if (current !== null) sections.push(current);
      current = { title: h2[1] ?? 'Section', lines: [] };
      continue;
    }
    (current ?? intro).lines.push(line);
  }
  if (current !== null) sections.push(current);

  const checkSection = sections.find((section) => /^check yourself$/i.test(section.title.trim()));
  const teachingSections = sections.filter((section) => section !== checkSection);
  const slides = teachingSections
    .map((section) => buildSlide(section.title.trim(), section.lines.join('\n').trim()))
    .filter((slide) => slide.markdown !== '' || slide.title !== '');

  if (slides.length === 0) {
    const body = [...intro.lines].join('\n').trim();
    slides.push(buildSlide(title, body));
  }

  return {
    title,
    slides,
    readMarkdown: contentMd.replace(/\n##\s+Check yourself\b[\s\S]*$/i, '').trim(),
    checkQuestions: parseCheckQuestions(checkSection?.lines.join('\n') ?? contentMd),
  };
}

/**
 * Lift the first blockquote out as the slide's key idea, then choose a layout
 * from what the section actually contains. This keeps saved lessons useful:
 * no new prompt syntax is required for older content.
 */
function buildSlide(title: string, body: string): LessonSlide {
  const lines = body.split('\n');
  const takeawayLines: string[] = [];
  const bodyLines: string[] = [];
  let inQuote = false;

  for (const line of lines) {
    if (/^\s*>/.test(line)) {
      inQuote = true;
      takeawayLines.push(line.replace(/^\s*>\s?/, ''));
      continue;
    }
    if (inQuote) {
      inQuote = false;
      // Swallow the single blank line that ends a blockquote.
      if (line.trim() === '') continue;
    }
    bodyLines.push(line);
  }

  const markdown = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const takeaway =
    takeawayLines
      .join(' ')
      .replace(/\*\*/g, '')
      .replace(/^\s*key idea\s*:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim() || null;

  const kind: LessonSlideKind = /```|~~~/.test(markdown)
    ? 'code'
    : /^\s*\|.*\|\s*$/m.test(markdown)
      ? 'compare'
      : /^\s*\d+\.\s+/m.test(markdown)
        ? 'steps'
        : /\$\$|\\\[/.test(markdown)
          ? 'math'
          : 'concept';

  return { title, markdown, kind, takeaway };
}

/** Reads blocks shaped like `1. question (Answer: answer)`. */
function parseCheckQuestions(source: string): LessonCheckQuestion[] {
  return source
    .split(/\n(?=\s*\d+\.\s*)/)
    .map((block) => /^\s*\d+\.\s*([\s\S]*?)\s*\(Answer:\s*([\s\S]*?)\)\s*$/.exec(block.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ prompt: match[1] ?? '', answer: match[2] ?? '' }))
    .slice(0, 3);
}
