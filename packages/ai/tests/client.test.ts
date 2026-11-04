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
