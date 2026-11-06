import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectLocalProvider,
  pickLocalModels,
  probeCapabilities,
  setFetchImplementation,
} from '../src';
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
  setFetchImplementation(null);
  vi.unstubAllGlobals();
});

describe('probeCapabilities', () => {
  it('reports chat and jsonMode when the endpoint answers both', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/embeddings')) {
          return jsonResponse({ data: [{ index: 0, embedding: [0.1] }] });
        }
        // The vision probe sends a solid red image; answer it like a VLM would.
        if (String(init?.body ?? '').includes('image_url')) {
          return jsonResponse(chatBody('red'));
        }
        return jsonResponse(chatBody('{"ok":true}'));
      }),
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

  it('marks vision false when the model answers without seeing the image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        String(init?.body ?? '').includes('image_url')
          ? jsonResponse(chatBody('I cannot view images.'))
          : jsonResponse(chatBody('{"ok":true}')),
      ),
    );
    const caps = await probeCapabilities(config);
    expect(caps.chat).toBe(true);
    expect(caps.vision).toBe(false);
  });

  it('accepts a hex answer from a model that does see the image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        String(init?.body ?? '').includes('image_url')
          ? jsonResponse(chatBody('#FF0000'))
          : jsonResponse(chatBody('{"ok":true}')),
      ),
    );
    expect((await probeCapabilities(config)).vision).toBe(true);
  });

  it('reads a reply that a thinking model left in reasoning only', async () => {
    // qwen3-vl:8b defaults to thinking and spends a small budget entirely on
    // the scratchpad, returning content: "". The probe must still see the answer.
    const thinking = (reasoning: string) =>
      jsonResponse({ choices: [{ message: { content: '', reasoning } }], model: 'vlm' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        String(init?.body ?? '').includes('image_url')
          ? thinking('The image provided is a solid red color.')
          : thinking('We are to return exactly the JSON: {"ok":true}'),
      ),
    );
    const caps = await probeCapabilities(config);
    expect(caps.chat).toBe(true);
    expect(caps.jsonMode).toBe(true);
    expect(caps.vision).toBe(true);
  });

  it('fails chat when the reply holds neither content nor reasoning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ choices: [{ message: { content: '' } }], model: 'x' })),
    );
    expect((await probeCapabilities(config)).chat).toBe(false);
  });

  it('skips the embedding probe when no embed model is configured', async () => {
    const stub = vi.fn(async () => jsonResponse(chatBody('{"ok":true}')));
    vi.stubGlobal('fetch', stub);
    const caps = await probeCapabilities(config);
    expect(caps.embeddings).toBe(false);
  });

  it('uses the installed fetch implementation', async () => {
    const installed = vi.fn(async () => jsonResponse(chatBody('{"ok":true}')));
    setFetchImplementation(installed);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'wrong transport' }, 500)));
    const caps = await probeCapabilities(config);
    expect(caps.chat).toBe(true);
    expect(installed).toHaveBeenCalled();
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
    const found = await detectLocalProvider();
    expect(found).toEqual({ baseUrl: 'http://localhost:11434', models: ['llama3'] });
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
    expect(await detectLocalProvider({ ports: [11434, 1234, 8080] })).toEqual({
      baseUrl: 'http://localhost:1234',
      models: ['x'],
    });
  });

  it('returns every model id the server advertises', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: 'prism-ml/bonsai-27b' },
            { id: 'text-embedding-nomic-embed-text-v1.5' },
            { object: 'model' },
          ],
        }),
      ),
    );
    expect(await detectLocalProvider({ ports: [1234] })).toEqual({
      baseUrl: 'http://localhost:1234',
      models: ['prism-ml/bonsai-27b', 'text-embedding-nomic-embed-text-v1.5'],
    });
  });
});

describe('pickLocalModels', () => {
  it('uses the advertised chat and embedding ids instead of Ollama defaults', () => {
    expect(
      pickLocalModels([
        'prism-ml/bonsai-27b',
        'google/gemma-4-12b-qat',
        'text-embedding-nomic-embed-text-v1.5',
      ]),
    ).toEqual({
      chatModel: 'prism-ml/bonsai-27b',
      embedModel: 'text-embedding-nomic-embed-text-v1.5',
    });
  });

  it('prefers a chat or instruct model when the list has one', () => {
    expect(pickLocalModels(['reasoner', 'qwen2.5-instruct', 'bge-embed'])).toEqual({
      chatModel: 'qwen2.5-instruct',
      embedModel: 'bge-embed',
    });
  });

  it('leaves the embedding model empty when none is advertised', () => {
    expect(pickLocalModels(['llama3'])).toEqual({ chatModel: 'llama3', embedModel: '' });
  });
});
