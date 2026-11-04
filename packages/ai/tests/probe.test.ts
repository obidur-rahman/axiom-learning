import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLocalProvider, probeCapabilities } from '../src';
import type { ProviderConfig } from '../src';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function chatBody(content: string) {
  return { choices: [{ message: { content } }], model: 'test-chat' };
}

const config: ProviderConfig = {
  baseUrl: 'http://localhost:11434',
  apiKey: 'sk-test',
  chatModel: 'test-chat',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeCapabilities', () => {
  it('reports chat and jsonMode when the endpoint answers both', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/embeddings')
          ? jsonResponse({ data: [{ index: 0, embedding: [0.1] }] })
          : jsonResponse(chatBody('{"ok":true}')),
      ),
    );
    const caps = await probeCapabilities({ ...config, embedModel: 'e' });
    expect(caps.chat).toBe(true);
    expect(caps.jsonMode).toBe(true);
    expect(caps.embeddings).toBe(true);
    expect(caps.vision).toBe(true);
  });

  it('stops early when the chat probe fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 500)));
    const caps = await probeCapabilities(config);
    expect(caps.chat).toBe(false);
    expect(caps.jsonMode).toBe(false);
  });

  it('marks jsonMode false when the model answers in prose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(chatBody('Sure! Here is it: fine stone.'))),
    );
    const caps = await probeCapabilities(config);
    expect(caps.chat).toBe(true);
    expect(caps.jsonMode).toBe(false);
  });

  it('skips the embedding probe when no embed model is configured', async () => {
    const stub = vi.fn(async () => jsonResponse(chatBody('{"ok":true}')));
    vi.stubGlobal('fetch', stub);
    const caps = await probeCapabilities(config);
    expect(caps.embeddings).toBe(false);
  });
});

describe('detectLocalProvider', () => {
  it('returns the first local endpoint that serves a model list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes(':11434')) {
          return jsonResponse({ data: [{ id: 'llama3' }] });
        }
        return jsonResponse({ error: 'closed' }, 500);
      }),
    );
    const baseUrl = await detectLocalProvider();
    expect(baseUrl).toBe('http://localhost:11434');
  });

  it('returns null when no common port answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    expect(await detectLocalProvider()).toBeNull();
  });

  it('skips endpoints without a non-empty model list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes(':11434')) return jsonResponse({ data: [] });
        if (url.includes(':1234')) return jsonResponse({ data: [{ id: 'x' }] });
        return jsonResponse({ error: 'closed' }, 500);
      }),
    );
    expect(await detectLocalProvider({ ports: [11434, 1234, 8080] })).toBe(
      'http://localhost:1234',
    );
  });
});
