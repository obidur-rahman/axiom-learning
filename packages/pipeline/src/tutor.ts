import type { DbDriver } from '@axiom/data';
import { TUTOR_SYSTEM } from './prompts';
import { tokenize } from './lessons';
import type { ProviderConfig } from '@axiom/ai';
import { retrievePagesSmart } from './embeddings';

/** One exchange in the tutor thread (kept in the UI, not in the DB). */
export interface TutorMessage {
  role: 'user' | 'assistant';
  content: string;
  citations: number[];
  guiding?: boolean;
}

const MAX_RETRIEVAL_CHARS = 8_000;

/** Top pages for the question: keyword score against the question terms. */
export async function retrievePages(
  driver: DbDriver,
  courseId: string,
  question: string,
  limit = 6,
): Promise<{ pageNumber: number; text: string; score: number }[]> {
  const rows = await driver.select<{ page_number: number; text: string | null }>(
    `SELECT p.page_number, p.text FROM material_pages p
     JOIN materials m ON m.id = p.material_id
     WHERE m.course_id = $1`,
    [courseId],
  );
  const terms = tokenize(question);
  return rows
    .map((row) => ({
      pageNumber: row.page_number,
      text: row.text ?? '',
      score: terms.reduce((total, term) => total + countTerm(row.text ?? '', term), 0),
    }))
    .filter((page) => page.text !== '')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function countTerm(text: string, term: string): number {
  if (term === '') return 0;
  let count = 0;
  let offset = text.toLowerCase().indexOf(term);
  while (offset !== -1) {
    count += 1;
    offset = text.toLowerCase().indexOf(term, offset + term.length);
  }
  return count;
}

const GUIDE_INSTRUCTION =
  '\n\nGUIDE MODE: first ask one short guiding question back to the learner. Do not give the full answer until they try.';

export interface StreamCallbacks {
  onDelta(chunk: string): void;
  onDone(citations: number[]): void;
  onError(error: Error): void;
}

/**
 * Tutor chat (pivot plan task 7): streams one answer from the provider with
 * SSE (`stream: true`), grounding on retrieved pages, the no-evidence rule
 * in the system prompt, and the guide-me mode toggle. Returns nothing;
 * pushes to callbacks. Citation markers are [p.12] style.
 */
export async function streamTutorAnswer(
  config: ProviderConfig,
  courseId: string,
  driver: DbDriver,
  question: string,
  history: TutorMessage[],
  guideMode: boolean,
  callbacks: StreamCallbacks,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const pages = await retrievePagesSmart(driver, courseId, question, config, fetchImpl);
  const grounded = pages
    .map((page) => `PAGE ${page.pageNumber}\n${page.text}`)
    .join('\n\n')
    .slice(0, MAX_RETRIEVAL_CHARS);

  const body = {
    model: config.chatModel,
    stream: true,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          TUTOR_SYSTEM +
          (guideMode ? GUIDE_INSTRUCTION : '') +
          (grounded === ''
            ? '\n\nNote: the learner has no readable material pages for this question.'
            : `\n\nMaterial pages:\n<material>\n${grounded}\n</material>`),
      },
      ...history.slice(-6).map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: question },
    ],
  };

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    return;
  }
  if (!response.ok || response.body === null) {
    callbacks.onError(new Error(`provider returned HTTP ${response.status}`));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        const dataLine = event.split('\n').find((lineText) => lineText.startsWith('data:'));
        const payload = dataLine?.slice(5).trim() ?? '';
        if (payload === '' || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = parsed.choices?.[0]?.delta?.content ?? '';
          if (delta !== '') {
            full += delta;
            callbacks.onDelta(delta);
          }
        } catch {
          // keep-alive or partial line: ignore
        }
      }
    }
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    return;
  }

  const citations = [...full.matchAll(/\[p\.(\d+)\]/g)].map((match) => Number(match[1]));
  callbacks.onDone([...new Set(citations)]);
}
