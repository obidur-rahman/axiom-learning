'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamTutorAnswer, type TutorMessage } from '@axiom/pipeline';
import { getDb } from '../lib/db';
import { loadConfig } from '../lib/provider';
import { loadPrefs, usePrefs } from '../lib/prefs';
import { clearTutorHistory, loadTutorHistory, saveTutorHistory } from '../lib/tutor-history';
import { Markdown } from './markdown';

/**
 * Tutor chat (FR-058..FR-060): grounded streaming answers with page
 * citations, the no-evidence sentence kept visible, and the Guide-me toggle
 * (guiding question first). Three failures in a row offer the hosted
 * provider; the lesson stays inside one thread per topic.
 */
export function TutorPanel({ courseId }: { courseId: string }) {
  const prefs = usePrefs();
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState('');
  const [guideMode, setGuideMode] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [failureCount, setFailureCount] = useState(0);
  const [error, setError] = useState('');
  const thread = useRef<TutorMessage[]>([]);

  useEffect(() => {
    // Restore the saved thread: switching tabs or restarting must not lose it.
    const saved = loadTutorHistory(courseId);
    thread.current = saved;
    setMessages(saved);
    setStreamText('');
    setFailureCount(0);
    setGuideMode(loadPrefs().tutorGuideDefault);
  }, [courseId]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (question === '' || streaming) return;
    setInput('');
    setStreaming(true);
    setStreamText('');
    setError('');
    const config = await loadConfig();
    if (config === null) {
      setError('No provider configured. Set it in Settings first.');
      setStreaming(false);
      return;
    }
    // Accumulate locally: React state may lag the final stream chunk by one
    // render, which would truncate the saved answer.
    let accumulated = '';
    await streamTutorAnswer(
      config,
      courseId,
      (await getDb()).driver,
      question,
      thread.current,
      guideMode,
      {
        onDelta: (chunk) => {
          accumulated += chunk;
          setStreamText(accumulated);
        },
        onDone: (citations) => {
          thread.current = [
            ...thread.current,
            { role: 'user', content: question, citations: [] } as TutorMessage,
            { role: 'assistant', content: accumulated, citations } as TutorMessage,
          ];
          setMessages([...thread.current]);
          saveTutorHistory(courseId, thread.current);
          setStreamText('');
          setStreaming(false);
        },
        onError: (caught) => {
          setError(caught.message);
          setFailureCount((count) => count + 1);
          setStreaming(false);
        },
      },
    );
  }, [input, streaming, courseId, guideMode]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={guideMode}
            onChange={(event) => setGuideMode(event.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Guide me first (ask guiding questions back)
        </label>
        {messages.length > 0 && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              thread.current = [];
              setMessages([]);
              clearTutorHistory(courseId);
            }}
          >
            New chat
          </button>
        )}
      </div>

      <div className="flex max-h-[62vh] min-h-[220px] flex-col gap-2 overflow-y-auto rounded-[var(--radius)] border border-border bg-surface p-3">
        {messages.length === 0 && streamText === '' && (
          <p className="text-sm text-text-muted">
            Ask anything from this course. Answers only use your material pages
            and show citations like [p.3]. When the material has nothing, the
            tutor says so first.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === 'user'
                ? 'self-end max-w-[80%] rounded-[var(--radius)] bg-accent/20 px-3 py-2 text-sm'
                : 'max-w-[85%] rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-sm'
            }
          >
            <Markdown content={message.content} compact />
            {prefs.showCitationPages && message.citations.length > 0 && (
              <p className="mt-1 text-xs text-text-muted">
                Sources: {message.citations.map((page) => `p.${page}`).join(', ')}
              </p>
            )}
          </div>
        ))}
        {streaming && (
          <div className="max-w-[85%] rounded-[var(--radius)] border border-border bg-bg px-3 py-2 text-sm">
            {streamText === '' ? (
              <p>Thinking...</p>
            ) : (
              <>
                <Markdown content={streamText} compact />
                <span aria-hidden className="animate-pulse">
                  |
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {error !== '' && (
        <p className="rounded-[var(--radius)] border border-danger/40 bg-surface px-3 py-2 text-sm text-danger">
          {error}
          {failureCount >= 3 && (
            <>
              {' '}
              The local model keeps failing.{' '}
              <a href="/settings" className="text-accent underline-offset-4 hover:underline">
                Try a hosted provider in Settings
              </a>
              .
            </>
          )}
        </p>
      )}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send();
          }}
          placeholder="Ask about a topic..."
          className="flex-1 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={() => void send()}
          disabled={input.trim() === '' || streaming}
          className="rounded-[var(--radius)] bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
