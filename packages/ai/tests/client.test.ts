import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLenientJson, ProviderError } from '../src';
import { chat, chatJson, embed, normalizeBaseUrl } from '../src';
import type { ProviderConfig } from '../src';
import { z } from 'zod';

const config: ProviderConfig = {
  baseUrl: 'http://localhost:11434',
  apiKey: 'sk-test',
  chatModel: 'test-chat',
  embedModel: 'test-embed',
};

type FetchStub = ReturnType<typeof vi.fn>;

function responses(...bodies: (object | string)[]): {
  stub: FetchStub;
  bodies: unknown[];
} {
  const jsonBodies = bodies.map((b) => (typeof b === 'string' ? { error: b } : b));
  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const body = jsonBodies.shift();
    return new Response(body === undefined ? '{}' : JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', stub);
  return { stub, bodies: jsonBodies };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client', () => {
  it('normalizeBaseUrl adds /v1 when missing and keeps an existing version', () => {
    expect(normalizeBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
    expect(normalizeBaseUrl('https://openrouter.ai/api')).toBe('https://openrouter.ai/api/v1');
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1');
  });

  it('chat posts to /v1/chat/completions with the configured model and bearer key', async () => {
    const { stub } = responses({
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      model: 'test-chat',
    });
    const result = await chat(config, [{ role: 'user', content: 'hello' }]);
    expect(result.content).toBe('hi');
    expect(result.usage?.totalTokens).toBe(3);
    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-chat');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('chatJson parses valid JSON and validates against the schema', async () => {
    responses({ choices: [{ message: { content: '{"title":"Set A","count":3}' } }] });
    const schema = z.object({ title: z.string(), count: z.number() });
    const { data } = await chatJson(config, schema, [{ role: 'user', content: '?' }]);
    expect(data).toEqual({ title: 'Set A', count: 3 });
  });

  it('chatJson retries on bad JSON and succeeds on a later attempt', async () => {
    responses(
      { choices: [{ message: { content: 'not json at all' } }] },
      { choices: [{ message: { content: '```json\n{"title":"ok","count":1}\n```' } }] },
    );
    const schema = z.object({ title: z.string(), count: z.number() });
    const { data } = await chatJson(config, schema, [{ role: 'user', content: '?' }]);
    expect(data).toEqual({ title: 'ok', count: 1 });
  });

  it('chatJson fails after the retry budget (TRD 8.2: up to 2 retries)', async () => {
    responses(
      { choices: [{ message: { content: 'bad' } }] },
      { choices: [{ message: { content: 'bad' } }] },
      { choices: [{ message: { content: '{"title":"no","count":"wrong"}' } }] },
    );
    const schema = z.object({ title: z.string(), count: z.number() });
    await expect(
      chatJson(config, schema, [{ role: 'user', content: '?' }]),
    ).rejects.toThrowError(ProviderError);
  });

  it('embed returns vectors in input order', async () => {
    responses({
      data: [
        { index: 1, embedding: [3, 4] },
        { index: 0, embedding: [1, 2] },
      ],
    });
    const { vectors } = await embed(config, ['a', 'b']);
    expect(vectors).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('embed throws a clear error without a configured embed model', async () => {
    await expect(embed({ ...config, embedModel: undefined }, ['a'])).rejects.toThrowError(
      ProviderError,
    );
  });

  it('parseLenientJson strips markdown fences', () => {
    expect(parseLenientJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseLenientJson('nope')).toThrowError();
  });
});

describe('provider fallback chain', () => {
  interface Scripted {
    status?: number;
    body: object;
    headers?: Record<string, string>;
  }

  function scripted(...steps: Scripted[]): FetchStub {
    const queue = [...steps];
    const stub = vi.fn(async () => {
      const step = queue.shift() ?? { body: {} };
      return new Response(JSON.stringify(step.body), {
        status: step.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(step.headers ?? {}) },
      });
    });
    vi.stubGlobal('fetch', stub);
    return stub;
  }

  const backup: ProviderConfig = {
    baseUrl: 'https://backup.example/api',
    apiKey: 'sk-backup',
    chatModel: 'backup-chat',
    embedModel: 'backup-embed',
  };

  it('chat moves to the next profile on a rate limit', async () => {
    const stub = scripted(
      { status: 429, body: { error: 'slow down' }, headers: { 'retry-after': '0' } },
      { body: { choices: [{ message: { content: 'from backup' } }] } },
    );
    const result = await chat(
      { ...config, fallbacks: [backup] },
      [{ role: 'user', content: 'hello' }],
    );
    expect(result.content).toBe('from backup');
    expect(stub).toHaveBeenCalledTimes(2);
    const [url, init] = stub.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://backup.example/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-backup');
  });

  it('chat moves on for a rejected key but not for a bad request', async () => {
    const rotated = scripted(
      { status: 401, body: { error: 'bad key' } },
      { body: { choices: [{ message: { content: 'ok' } }] } },
    );
    await expect(
      chat({ ...config, fallbacks: [backup] }, [{ role: 'user', content: 'hi' }]),
    ).resolves.toMatchObject({ content: 'ok' });
    expect(rotated).toHaveBeenCalledTimes(2);

    const rejected = scripted({ status: 400, body: { error: 'bad prompt' } });
    await expect(
      chat({ ...config, fallbacks: [backup] }, [{ role: 'user', content: 'hi' }]),
    ).rejects.toThrowError(ProviderError);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('chatJson tries the next profile when a model cannot produce the schema', async () => {
    const stub = scripted(
      { body: { choices: [{ message: { content: 'not json' } }] } },
      { body: { choices: [{ message: { content: 'still not json' } }] } },
      { body: { choices: [{ message: { content: '{"title":"x","count":2}' } }] } },
    );
    const schema = z.object({ title: z.string(), count: z.number() });
    const { data } = await chatJson(
      { ...config, fallbacks: [backup] },
      schema,
      [{ role: 'user', content: '?' }],
      { retries: 1 },
    );
    expect(data).toEqual({ title: 'x', count: 2 });
    // Two attempts on the primary, then the fallback.
    expect(stub).toHaveBeenCalledTimes(3);
    const [url] = stub.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('https://backup.example/api/v1/chat/completions');
  });

  it('embed skips profiles without an embedding model', async () => {
    const stub = scripted({ body: { data: [{ index: 0, embedding: [9] }] } });
    const { vectors } = await embed(
      { ...config, embedModel: undefined, fallbacks: [backup] },
      ['a'],
    );
    expect(vectors).toEqual([[9]]);
    expect(stub).toHaveBeenCalledTimes(1);
    const [url, init] = stub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://backup.example/api/v1/embeddings');
    expect(JSON.parse(init.body as string).model).toBe('backup-embed');
  });
});
