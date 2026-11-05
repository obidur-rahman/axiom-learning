'use client';

import { isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';

function plainTextOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(plainTextOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return plainTextOf(node.props.children);
  return '';
}

/** Fenced code with a language label and a copy action, useful in lessons. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeElement = isValidElement<{ className?: string }>(children) ? children : null;
  const language = /language-([\w-]+)/.exec(codeElement?.props.className ?? '')?.[1] ?? 'code';

  const copy = () => {
    const text = plainTextOf(children).replace(/\n$/, '');
    if (text === '' || typeof navigator === 'undefined' || navigator.clipboard === undefined) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{language}</span>
        <button type="button" className="code-copy" onClick={copy} aria-label={`Copy ${language} code`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

interface MarkdownProps {
  content: string;
  className?: string;
  /** Tight spacing for chat bubbles and answer panels. */
  compact?: boolean;
  /** For short single-line labels such as a multiple-choice option. */
  inline?: boolean;
}

/**
 * Lesson and tutor text is model-authored Markdown. Render it instead of
 * showing the source, with GFM tables/lists and KaTeX for $...$ and $$...$$.
 * Raw HTML stays disabled: the model never gets to inject markup.
 */
export function Markdown({ content, className, compact = false, inline = false }: MarkdownProps) {
  const Wrapper = inline ? 'span' : 'div';

  // Never add a key with an `undefined` value here: react-markdown's JSX
  // runtime checks for key presence, so `p: undefined` would make every
  // paragraph render as an invalid element type.
  const components: Components = {
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ children, ...props }) => (
      <a {...props} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table>{children}</table>
      </div>
    ),
    img: ({ alt, ...props }) => (
      // Local lesson images can be data URLs or file paths; next/image
      // cannot optimise either in a static Tauri export.
      // eslint-disable-next-line @next/next/no-img-element
      <img {...props} alt={alt ?? ''} className="my-3 max-w-full rounded-[var(--radius)] border border-border" />
    ),
  };

  if (inline) {
    components.p = ({ children }) => <>{children}</>;
  }

  return (
    <Wrapper
      className={cn('markdown', compact && 'markdown-compact', inline && 'markdown-inline', className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false }]]}
        components={components}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </Wrapper>
  );
}

/**
 * Models do not always emit the dollar delimiters remark-math understands.
 * This turns every common form into dollars while leaving code untouched:
 *   \[ ... \]        -> $$ ... $$
 *   \( ... \)        -> $ ... $
 *   \begin{align}... -> $$ ... $$
 *   $math
 *   over two lines$ -> $$ ... $$ (single dollars cannot span lines)
 * Emphasis that leaked inside math is dropped so KaTeX gets clean source.
 */
function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return cleanMathPart(part);
    })
    .join('');
}

/** A whole top-level LaTeX environment, nested inner environments included. */
const ENVIRONMENT_BLOCK =
  /\\begin\{(align\*?|aligned|alignat\*?|equation\*?|gather\*?|eqnarray\*?|multline\*?|cases|array|matrix|pmatrix|bmatrix|vmatrix)\}[\s\S]*?\\end\{\1\}/g;

function insideDisplayMath(text: string, offset: number): boolean {
  return (text.slice(0, offset).match(/\$\$/g) ?? []).length % 2 === 1;
}

function cleanMathPart(part: string): string {
  let text = part
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, expression: string) => `$${expression.trim()}$`);

  // KaTeX only renders align/equation and friends inside display math.
  text = text.replace(ENVIRONMENT_BLOCK, (match: string, _name: string, offset: number) =>
    insideDisplayMath(text, offset) ? match : `\n$$\n${match}\n$$\n`,
  );

  // Single dollars cannot span lines (or hold a blank line): promote them.
  text = text.replace(/(?<!\$)\$(?!\$)([^$]+?)\$(?!\$)/g, (match, body: string) => {
    if (!body.includes('\n')) return match;
    return /\\[a-zA-Z]|\^|_|\{|=/.test(body) ? `\n$$\n${body.trim()}\n$$\n` : match;
  });

  // `**x**` inside math is Markdown emphasis that leaked into LaTeX.
  text = text.replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g, (_match, display?: string, inline?: string) => {
    const body = (display ?? inline ?? '').replace(/\*\*/g, '');
    return display !== undefined ? `$$${body}$$` : `$${body}$`;
  });

  return text;
}
