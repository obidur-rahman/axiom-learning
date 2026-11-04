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
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={components}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </Wrapper>
  );
}

/**
 * Some local models emit LaTeX with \( \) and \[ \] instead of dollar signs.
 * remark-math only understands dollars, so convert the delimiters while
 * leaving fenced code and inline code untouched.
 */
export function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expression: string) => `$$\n${expression.trim()}\n$$`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_match, expression: string) => `$${expression.trim()}$`);
    })
    .join('');
}
