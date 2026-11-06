import { ProviderError } from './client';
import { getFetch } from './http';

/**
 * Ollama's native API, used for model management only. Chat and embeddings go
 * through the OpenAI-compatible /v1 surface; the native /api surface is the
 * only place that can list loaded models, unload one, or stream a download.
 */

/** One downloaded model on the machine. */
export interface OllamaModel {
  name: string;
  sizeBytes: number | null;
  parameterSize: string | null;
  family: string | null;
  modifiedAt: string | null;
}

/** One model currently held in memory. */
export interface OllamaLoadedModel {
  name: string;
  sizeBytes: number | null;
  /** When Ollama will drop it on its own. */
  expiresAt: string | null;
}

export interface PullProgress {
  status: string;
  completed: number | null;
  total: number | null;
  /** 0..100 when the server reported a size, otherwise null. */
  percent: number | null;
}

/** Root of the native API: a configured base URL may carry /v1 or /api. */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/(api|v1)$/i, '');
}

/**
 * Best-effort hint before probing /api/version. A custom port can still be
 * Ollama, so this is only used to skip work for hosted URLs.
 */
export function looksLikeOllama(baseUrl: string): boolean {
  if (!baseUrl.startsWith('http://localhost:') && !baseUrl.startsWith('http://127.0.0.1:')) {
    return /ollama/i.test(baseUrl);
  }
  const url = new URL(ollamaRoot(baseUrl));
  return url.port === '11434' || /ollama/i.test(baseUrl);
}

async function request<T>(
  root: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await getFetch()(`${root}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ProviderError(
      `Ollama ${path} failed: ${response.status} ${text.slice(0, 200)}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

/** The Ollama version, or null when this endpoint is not Ollama. */
export async function ollamaVersion(
  baseUrl: string,
  timeoutMs = 1_500,
): Promise<string | null> {
  try {
    const body = await request<{ version?: unknown }>(
      ollamaRoot(baseUrl),
      '/api/version',
      undefined,
      AbortSignal.timeout(timeoutMs),
    );
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Every model downloaded on the machine, in server order. */
export async function listOllamaModels(
  baseUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<OllamaModel[]> {
  const body = await request<{ models?: unknown[] }>(
    ollamaRoot(baseUrl),
    '/api/tags',
    undefined,
    AbortSignal.timeout(options.timeoutMs ?? 5_000),
  );
  return (body.models ?? [])
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const details = (row.details ?? {}) as Record<string, unknown>;
      const name = text(row.name) ?? text(row.model);
      return name === null
        ? null
        : {
            name,
            sizeBytes: count(row.size),
            parameterSize: text(details.parameter_size),
            family: text(details.family),
            modifiedAt: text(row.modified_at),
          };
    })
    .filter((model): model is OllamaModel => model !== null);
}

/** Models currently loaded in memory, with their expiry. */
export async function listLoadedOllamaModels(
  baseUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<OllamaLoadedModel[]> {
  const body = await request<{ models?: unknown[] }>(
    ollamaRoot(baseUrl),
    '/api/ps',
    undefined,
    AbortSignal.timeout(options.timeoutMs ?? 3_000),
  );
  return (body.models ?? [])
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const name = text(row.name) ?? text(row.model);
      return name === null
        ? null
        : { name, sizeBytes: count(row.size), expiresAt: text(row.expires_at) };
    })
    .filter((model): model is OllamaLoadedModel => model !== null);
}

/**
 * Loads a model into memory ahead of the request that needs it. Ollama would
 * load it on demand anyway, but doing it here makes the swap explicit and
 * gives the request the model already warm.
 */
export async function loadOllamaModel(
  baseUrl: string,
  model: string,
  options: { keepAlive?: string; signal?: AbortSignal } = {},
): Promise<void> {
  await request(
    ollamaRoot(baseUrl),
    '/api/generate',
    { model, prompt: '', stream: false, keep_alive: options.keepAlive ?? '10m' },
    options.signal,
  );
}

/** Drops one model from memory. */
export async function unloadOllamaModel(
  baseUrl: string,
  model: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  await request(
    ollamaRoot(baseUrl),
    '/api/generate',
    { model, prompt: '', stream: false, keep_alive: 0 },
    options.signal,
  );
}

/** Parses one progress line of a streaming pull response. */
function pullProgress(payload: Record<string, unknown>): PullProgress {
  const completed = count(payload.completed);
  const total = count(payload.total);
  return {
    status: text(payload.status) ?? 'pulling',
    completed,
    total,
    percent:
      completed !== null && total !== null && total > 0
        ? Math.min(100, Math.round((completed / total) * 100))
        : null,
  };
}

function parsePullLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Downloads a model and reports progress. Ollama streams newline-delimited
 * JSON; the desktop HTTP transport exposes the body as a stream, but a server
 * or transport that buffers the whole response still works through the text
 * fallback.
 */
export async function pullOllamaModel(
  baseUrl: string,
  model: string,
  options: {
    onProgress?: (progress: PullProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const response = await getFetch()(`${ollamaRoot(baseUrl)}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ProviderError(
      `Ollama could not download ${model}: ${response.status} ${detail.slice(0, 200)}`,
      response.status,
    );
  }

  let lastError: string | null = null;
  const handleLine = (line: string) => {
    const payload = parsePullLine(line);
    if (payload === null) return;
    if (typeof payload.error === 'string') {
      lastError = payload.error;
      return;
    }
    options.onProgress?.(pullProgress(payload));
  };

  if (response.body === null) {
    for (const line of (await response.text()).split('\n')) handleLine(line);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim() !== '') handleLine(buffer);
  }

  if (lastError !== null) throw new ProviderError(`Ollama could not download ${model}: ${lastError}`);
}
