import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listLoadedOllamaModels,
  listOllamaModels,
  loadOllamaModel,
  ollamaRoot,
  pullOllamaModel,
  setFetchImplementation,
  unloadOllamaModel,
} from '../src';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ndjsonResponse(lines: string[]) {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

afterEach(() => {
  setFetchImplementation(null);
  vi.unstubAllGlobals();
});

describe('ollamaRoot', () => {
  it('strips the OpenAI and native API suffixes', () => {
    expect(ollamaRoot('http://localhost:11434/v1')).toBe('http://localhost:11434');
    expect(ollamaRoot('http://localhost:11434/api/')).toBe('http://localhost:11434');
    expect(ollamaRoot('http://localhost:11434')).toBe('http://localhost:11434');
  });
});

describe('Ollama model management', () => {
  it('lists downloaded models from the native endpoint, not /v1', async () => {
    const stub = vi.fn(async () =>
      jsonResponse({
        models: [
          {
            name: 'qwen2.5vl:3b',
            size: 3_200_000_000,
            modified_at: '2026-11-01T10:00:00Z',
            details: { parameter_size: '3B', family: 'qwen2.5vl' },
          },
          { model: 'nomic-embed-text:latest' },
        ],
      }),
    );
    vi.stubGlobal('fetch', stub);

    const models = await listOllamaModels('http://localhost:11434/v1');
    expect(models).toEqual([
      {
        name: 'qwen2.5vl:3b',
        sizeBytes: 3_200_000_000,
        parameterSize: '3B',
        family: 'qwen2.5vl',
        modifiedAt: '2026-11-01T10:00:00Z',
      },
      {
        name: 'nomic-embed-text:latest',
        sizeBytes: null,
        parameterSize: null,
        family: null,
        modifiedAt: null,
      },
    ]);
    const [url] = stub.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://localhost:11434/api/tags');
  });

  it('reports the models currently in memory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          models: [{ name: 'qwen2.5:7b', size: 4_700_000_000, expires_at: '2026-11-06T12:10:00Z' }],
        }),
      ),
    );
    expect(await listLoadedOllamaModels('http://localhost:11434')).toEqual([
      { name: 'qwen2.5:7b', sizeBytes: 4_700_000_000, expiresAt: '2026-11-06T12:10:00Z' },
    ]);
  });

  it('unloads with keep_alive 0 and warms with a positive keep_alive', async () => {
    const stub = vi.fn(async () => jsonResponse({ done: true }));
    vi.stubGlobal('fetch', stub);

    await unloadOllamaModel('http://localhost:11434/v1', 'qwen2.5vl:3b');
    await loadOllamaModel('http://localhost:11434/v1', 'qwen2.5:7b', { keepAlive: '10m' });

    const first = stub.mock.calls[0] as unknown as [string, RequestInit];
    const second = stub.mock.calls[1] as unknown as [string, RequestInit];
    expect(first[0]).toBe('http://localhost:11434/api/generate');
    expect(JSON.parse(String(first[1].body))).toMatchObject({
      model: 'qwen2.5vl:3b',
      keep_alive: 0,
    });
    expect(JSON.parse(String(second[1].body))).toMatchObject({
      model: 'qwen2.5:7b',
      keep_alive: '10m',
    });
  });

  it('streams download progress and reports a completed size', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjsonResponse([
          '{"status":"pulling manifest"}',
          '{"status":"downloading","completed":50,"total":100}',
          '{"status":"success"}',
        ]),
      ),
    );
    const seen: (number | null)[] = [];
    await pullOllamaModel('http://localhost:11434', 'qwen3:4b', {
      onProgress: (progress) => seen.push(progress.percent),
    });
    expect(seen).toEqual([null, 50, null]);
  });

  it('turns an error line into a readable failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjsonResponse(['{"error":"model not found"}'])),
    );
    await expect(
      pullOllamaModel('http://localhost:11434', 'missing:1b'),
    ).rejects.toThrow('model not found');
  });
});
