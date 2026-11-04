import type { ProviderConfig } from './config';
import { getFetch } from './http';
import type { ZodType } from 'zod';

/** A chat message the caller composes. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  content: string;
  usage?: ChatUsage;
  model: string;
}

export interface EmbedResult {
  /** One vector per input, in input order. */
  vectors: number[][];
}

/**
 * Normalizes a base URL. Accepts forms with or without a trailing /v1 and
 * returns the endpoint root for OpenAI-style paths.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');
  if (!/\/v\d+(alpha|beta)?$/.test(url)) {
    url = `${url}/v1`;
  }
  return url;
}

function headers(config: ProviderConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) h.Authorization = `Bearer ${config.apiKey}`;
  return h;
}

async function postJson(
  config: ProviderConfig,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await getFetch()(`${normalizeBaseUrl(config.baseUrl)}${path}`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(`POST ${path} failed: ${response.status} ${text.slice(0, 300)}`, response.status);
  }
  return response.json();
}

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

/**
 * Non-streaming chat completion through an OpenAI-compatible endpoint.
 */
export async function chat(
  config: ProviderConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: options.model ?? config.chatModel,
    messages,
    stream: false,
    temperature: options.temperature,
  };
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  const data = (await postJson(config, '/chat/completions', body, options.signal)) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderError('chat: response has no message content');
  }
  const usage = data.usage;
  return {
    content,
    usage: usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined,
    model: data.model ?? (body.model as string),
  };
}

/**
 * Chat that must return JSON which passes `schema`. Sends the JSON shape as
 * part of the request (structured output where available), parses leniently,
 * and retries up to `retries` times when parsing or validation fails
 * (TRD 8.2: try again up to 2 times).
 */
export async function chatJson<T>(
  config: ProviderConfig,
  schema: ZodType<T>,
  messages: ChatMessage[],
  options: ChatOptions & { retries?: number } = {},
): Promise<{ data: T; raw: string; usage?: ChatUsage }> {
  const retries = options.retries ?? 2;
  const shaped: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You answer with JSON only. No markdown fences, no prose. The JSON must validate against this schema:\n' +
        JSON.stringify(zodShapeHint(schema)),
    },
    ...messages,
  ];
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await chat(config, shaped, {
      ...options,
      temperature: options.temperature ?? 0,
    });
    try {
      const parsed = parseLenientJson(result.content);
      return { data: schema.parse(parsed), raw: result.content, usage: result.usage };
    } catch (error) {
      lastError = error;
      // One repair nudge, then strict attempts.
      shaped.push({ role: 'assistant', content: result.content });
      shaped.push({
        role: 'user',
        content: 'That was not valid JSON for the schema. Reply again with JSON only.',
      });
    }
  }
  throw new ProviderError(
    `chatJson: schema validation failed after ${retries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Strip optional markdown fences and parse the first JSON value. */
export function parseLenientJson(text: string): unknown {
  const stripped = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  return JSON.parse(stripped);
}

/**
 * A compact structural hint from a Zod type: works for the object schemas
 * the pipeline uses, falls back to the type name.
 */
function zodShapeHint(schema: ZodType): unknown {
  const desc = (schema as unknown as { description?: string }).description;
  const def = (schema as unknown as { _def?: { typeName?: string } })._def;
  const inner = schema as unknown as {
    shape?: Record<string, ZodType>;
    element?: ZodType;
  };
  if (inner.shape) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inner.shape)) {
      out[key] = zodShapeHint(value);
    }
    return out;
  }
  if (inner.element) return [zodShapeHint(inner.element)];
  return def?.typeName ?? 'unknown';
}

/**
 * Embeddings through /v1/embeddings. Requires `embedModel` in the config.
 */
export async function embed(
  config: ProviderConfig,
  texts: string[],
  options: { signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  if (!config.embedModel) {
    throw new ProviderError('embed: no embedModel configured');
  }
  const data = (await postJson(
    config,
    '/embeddings',
    { model: config.embedModel, input: texts },
    options.signal,
  )) as { data?: { embedding?: unknown; index?: number }[] };
  const rows = data.data ?? [];
  if (rows.length !== texts.length || rows.some((r) => !Array.isArray(r.embedding))) {
    throw new ProviderError('embed: response does not hold one embedding per input');
  }
  const sorted = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return { vectors: sorted.map((r) => r.embedding as number[]) };
}
