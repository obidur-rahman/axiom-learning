'use client';

/**
 * A small ask box under a lesson beat or slide: questions are scoped to that
 * section's text, so the answer is about what the learner is looking at rather
 * than the whole course.
 */
import { useCallback, useRef, useState } from 'react';
import { streamTutorAnswer, type TutorMessage } from '@axiom/pipeline';
import { getDb } from '../lib/db';
import { loadConfig } from '../lib/provider';
import { Markdown } from './markdown';

const MAX_SECTION_CHARS = 1_600;

export function SectionAsk({
  courseId,
  sectionTitle,
  sectionText,
}: {
  courseId: string;
  sectionTitle: string;
  sectionText: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const thread = useRef<TutorMessage[]>([]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (question === '' || busy) return;
    setBusy(true);
    setAnswer('');
    setError('');
    const config = await loadConfig();
    if (config === null) {
      setError('No provider configured. Set it in Settings first.');
      setBusy(false);
      return;
    }
    let accumulated = '';
    await streamTutorAnswer(
      config,
      courseId,
      (await getDb()).driver,
      `The lesson section "${sectionTitle}" says:\n"""\n${sectionText.slice(0, MAX_SECTION_CHARS)}\n"""\n\nAbout this section: ${question}`,
      thread.current,
      false,
      {
        onDelta: (chunk) => {
          accumulated += chunk;
          setAnswer(accumulated);
        },
        onDone: (citations) => {
          thread.current = [
            ...thread.current,
            { role: 'user' as const, content: question, citations: [] },
            { role: 'assistant' as const, content: accumulated, citations },
          ];
          setInput('');
          setBusy(false);
        },
        onError: (caught) => {
          setError(caught.message);
          setBusy(false);
        },
      },
    );
  }, [input, busy, courseId, sectionTitle, sectionText]);

  if (!open) {
    return (
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(true)}>
        Ask about this section
      </button>
    );
  }

  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-wide text-text-muted">
          Ask about “{sectionTitle}”
        </p>
        <button
          type="button"
          className="text-[12px] text-text-muted hover:text-text"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>
      {answer !== '' && (
        <div className="mt-2 rounded-[var(--radius)] border border-border bg-bg px-3 py-2">
          <Markdown content={answer} compact />
        </div>
      )}
      {error !== '' && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send();
          }}
          placeholder="What is not clear here?"
          className="input flex-1"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || input.trim() === ''}
          className="btn btn-primary btn-sm"
        >
          {busy ? 'Asking...' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
