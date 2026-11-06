import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hostedProviderForKey,
  listHostedModels,
  normalizeBaseUrl,
  pickHostedModels,
  presetForBaseUrl,
  setFetchImplementation,
} from '../src';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  setFetchImplementation(null);
  vi.unstubAllGlobals();
});

describe('hostedProviderForKey', () => {
  it('recognises the common key shapes', () => {
    expect(hostedProviderForKey('gsk_abc123')?.id).toBe('groq');
    expect(hostedProviderForKey('csk-abc123')?.id).toBe('cerebras');
    expect(hostedProviderForKey('xai-abc123')?.id).toBe('xai');
    expect(hostedProviderForKey('AIzaSyAbc123')?.id).toBe('gemini');
  });

  it('prefers the longer sk- prefix over the generic OpenAI one', () => {
    expect(hostedProviderForKey('sk-or-v1-abc123')?.id).toBe('openrouter');
    expect(hostedProviderForKey('sk-proj-abc123')?.id).toBe('openai');
    expect(hostedProviderForKey('sk-abc123')?.id).toBe('openai');
  });

  it('returns null for a blank or unknown key', () => {
    expect(hostedProviderForKey('')).toBeNull();
    expect(hostedProviderForKey('   ')).toBeNull();
    expect(hostedProviderForKey('random-key')).toBeNull();
  });
});

describe('presetForBaseUrl', () => {
  it('matches with or without the version path and trailing slash', () => {
    expect(presetForBaseUrl('https://api.groq.com/openai/v1')?.id).toBe('groq');
    expect(presetForBaseUrl('https://api.groq.com/openai/')?.id).toBe('groq');
    expect(presetForBaseUrl('https://api.groq.com/openai')?.id).toBe('groq');
  });

  it('returns null for a custom endpoint', () => {
    expect(presetForBaseUrl('https://models.example.com/v1')).toBeNull();
    expect(presetForBaseUrl('')).toBeNull();
  });
});

describe('normalizeBaseUrl', () => {
  it('keeps a versioned OpenAI-compatible root such as Gemini', () => {
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
  });
});

describe('listHostedModels', () => {
  it('asks /models with the Bearer key and returns the IDs', async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ data: [{ id: 'a' }, { id: 'b' }, { nope: 1 }] }),
    );
    vi.stubGlobal('fetch', mock);

    const models = await listHostedModels('https://api.groq.com/openai', 'gsk_test');

    expect(models).toEqual(['a', 'b']);
    const call = mock.mock.calls[0];
    expect(call?.[0]).toBe('https://api.groq.com/openai/v1/models');
    expect((call?.[1]?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      'Bearer gsk_test',
    );
  });

  it('omits Authorization when no key is set', async () => {
    const mock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ data: [{ id: 'a' }] }),
    );
    vi.stubGlobal('fetch', mock);

    await listHostedModels('http://localhost:1234', '');

    const call = mock.mock.calls[0];
    expect((call?.[1]?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it('explains a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad key' }, 401)));
    await expect(listHostedModels('https://api.groq.com/openai/v1', 'gsk_bad')).rejects.toThrow(
      /rejected the API key \(HTTP 401\)/,
    );
  });

  it('explains an unreachable endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(listHostedModels('https://nope.example.com/v1', 'k')).rejects.toThrow(
      /Could not reach/,
    );
  });

  it('rejects a non-JSON answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>login</html>', { status: 200 })),
    );
    await expect(listHostedModels('https://example.com/v1', 'k')).rejects.toThrow(/did not return JSON/);
  });
});

describe('pickHostedModels', () => {
  it('uses a known provider’s preferred IDs from the live list', () => {
    const groq = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'whisper-large-v3'];
    expect(pickHostedModels(groq, presetForBaseUrl('https://api.groq.com/openai/v1'))).toEqual({
      chatModel: 'llama-3.3-70b-versatile',
      ocrModel: '',
      embedModel: '',
    });

    const groqVision = [
      ...groq,
      'meta-llama/llama-4-scout-17b-16e-instruct',
    ];
    expect(pickHostedModels(groqVision, presetForBaseUrl('https://api.groq.com/openai/v1'))).toEqual({
      chatModel: 'llama-3.3-70b-versatile',
      ocrModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
      embedModel: '',
    });
  });

  it('falls back to name heuristics for an unknown endpoint', () => {
    const picks = pickHostedModels([
      'text-embedding-3-small',
      'gpt-4o',
      'gpt-4o-vision',
    ]);
    expect(picks).toEqual({
      chatModel: 'gpt-4o',
      ocrModel: 'gpt-4o-vision',
      embedModel: 'text-embedding-3-small',
    });
  });

  it('returns empty roles for an empty list', () => {
    expect(pickHostedModels([])).toEqual({ chatModel: '', ocrModel: '', embedModel: '' });
  });
});
