import type { ProviderConfig } from './config';
import { fetchWithRetry } from './http';
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
  /**
   * Ollama's thinking switch. Leave undefined for endpoints that do not know
   * the field; set false on OCR to keep the whole budget for the transcript.
   */
  think?: boolean;
  signal?: AbortSignal;
}

export type ModelPurpose = 'chat' | 'embed' | 'vision';

/**
 * One hook runs before every model request. The desktop app uses it to swap
 * the local Ollama model: only the model for this request stays in memory,
 * and the others are unloaded first. A hook must never throw: if a swap
 * fails, the request itself should report the real problem.
 */
export type BeforeModelCall = (model: string, purpose: ModelPurpose) => Promise<void>;

let beforeModelCallHook: BeforeModelCall | null = null;

export function setBeforeModelCall(next: BeforeModelCall | null): void {
  beforeModelCallHook = next;
}

export async function beforeModelCall(model: string, purpose: ModelPurpose): Promise<void> {
  if (beforeModelCallHook === null) return;
  try {
    await beforeModelCallHook(model, purpose);
  } catch {
    // The provider request stays in charge of reporting failures.
  }
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  content: string;
  /**
   * Thinking models (Qwen3 and friends) put their scratchpad here and leave
   * `content` empty when the token budget runs out before the answer.
   */
  reasoning?: string;
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
  // Keep a versioned root (…/v1, …/v1beta) or a versioned OpenAI-compat root
  // (Gemini exposes …/v1beta/openai); append /v1 only when neither is there.
  if (!/\/v\d+(alpha|beta)?(\/openai)?$/.test(url)) {
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
  const response = await fetchWithRetry(
    `${normalizeBaseUrl(config.baseUrl)}${path}`,
    {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
      signal,
    },
    { signal },
  );
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
  const model = options.model ?? config.chatModel;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature: options.temperature,
  };
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options.think !== undefined) {
    body.think = options.think;
    // Ollama ignores unknown fields; vLLM and LM Studio read this one. It is
    // the only portable way to switch a thinking template off.
    if (!options.think) body.chat_template_kwargs = { enable_thinking: false };
  }
  await beforeModelCall(model, 'chat');
  const data = (await postJson(config, '/chat/completions', body, options.signal)) as {
    choices?: { message?: { content?: string; reasoning?: string; reasoning_content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };
  const message = data.choices?.[0]?.message;
  const content = typeof message?.content === 'string' ? message.content : '';
  const reasoning = typeof message?.reasoning === 'string' ? message.reasoning : message?.reasoning_content;
  // A thinking model can answer entirely in `reasoning`; that is still a reply.
  if (content === '' && (reasoning === undefined || reasoning === '')) {
    throw new ProviderError('chat: response has no message content');
  }
  const usage = data.usage;
  return {
    content,
    reasoning,
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
  const def = (schema as unknown as { _def?: { typeName?: string; in?: ZodType; out?: ZodType } })._def;
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
  // z.preprocess() wraps the real schema in a pipe. Follow the output side so
  // the model is shown the object shape instead of a bare "pipe".
  if (def?.out !== undefined) return zodShapeHint(def.out);
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
  await beforeModelCall(config.embedModel, 'embed');
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
