import { describe, expect, it } from 'vitest';
import { createDb, type DbDriver } from '@axiom/data';
import { retrievePages, streamTutorAnswer, type TutorMessage } from '../src';

class FakeDriver implements DbDriver {
  async execute(_sql: string, _params: unknown[] = []): Promise<number> {
    void _sql;
    void _params;
    return 1;
  }
  async select<T = Record<string, unknown>>(_sql: string, _params: unknown[] = []): Promise<T[]> {
    return [
      { page_number: 3, text: 'Diodes allow current one way.' },
      { page_number: 5, text: 'Diode forward voltage.' },
      { page_number: 9, text: 'Nothing related: banana recipes.' },
    ] as T[];
  }
}

function sseResponse(deltas: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const delta of deltas) {
        const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('retrievePages', () => {
  it('scores pages by question terms and drops empties', async () => {
    const pages = await retrievePages(new FakeDriver(), 'c1', 'How does the diode work?');
    expect(pages).toHaveLength(3);
    expect(pages[0]!.pageNumber).toBeGreaterThanOrEqual(3);
    expect(pages[0]!.score).toBeGreaterThan(pages[2]!.score);
  });
});

describe('streamTutorAnswer', () => {
  it('streams deltas and collects page citations from the full text', async () => {
    const seen: string[] = [];
    let done: number[] = [];
    let sentBody: { messages?: { content: string }[] } | null = null;
    await streamTutorAnswer(
      { baseUrl: 'http://localhost:11434/v1', chatModel: 'm' },
      'c1',
      new FakeDriver(),
      'How does a diode work? [p.3]',
      [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer [p.3]' }] as TutorMessage[],
      false,
      {
        onDelta: (chunk) => seen.push(chunk),
        onDone: (citations) => {
          done = citations;
        },
        onError: () => {
          throw new Error('unexpected error');
        },
      },
      async (_url, init) => {
        sentBody = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content: string }[] };
        return sseResponse(['Diodes conduct one way [p.', '3].']);
      },
    );
    expect(seen.join('')).toBe('Diodes conduct one way [p.3].');
    expect(done).toEqual([3]);
    const system = (sentBody as { messages?: { content: string }[] } | null)?.messages?.[0]?.content ?? '';
    expect(system).toContain('I could not find this in your material');
    expect(system).toContain('PAGE 3');
    expect(system).not.toContain('GUIDE MODE');
  });

  it('adds the guide instruction in guide mode', async () => {
    let sentBody: { messages?: { content: string }[] } | null = null;
    await streamTutorAnswer(
      { baseUrl: 'http://localhost:11434/v1', chatModel: 'm' },
      'c1',
      new FakeDriver(),
      'What is a diode?',
      [],
      true,
      { onDelta: () => undefined, onDone: () => undefined, onError: () => undefined },
      async (_url, init) => {
        sentBody = JSON.parse(String(init?.body ?? '{}')) as { messages?: { content: string }[] };
        return sseResponse(['ok']);
      },
    );
    const guideSystem = (sentBody as { messages?: { content: string }[] } | null)?.messages?.[0]?.content ?? '';
    expect(guideSystem).toContain('GUIDE MODE');
  });

  it('reports HTTP errors through onError, not by throwing', async () => {
    let failure: string | null = null;
    await streamTutorAnswer(
      { baseUrl: 'http://localhost:11434/v1', chatModel: 'm' },
      'c1',
      new FakeDriver(),
      'Question',
      [],
      false,
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (error) => {
          failure = error.message;
        },
      },
      async () => new Response('model unloaded', { status: 500 }),
    );
    expect(failure).toBe('provider returned HTTP 500');
  });
});
