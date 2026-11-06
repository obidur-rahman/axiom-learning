import { normalizeBaseUrl } from './client';
import { getFetch } from './http';
import { VISION_HINT } from './probe';

/**
 * Hosted-provider setup: know the common OpenAI-compatible services, their
 * root URLs and key prefixes, and pick chat / OCR / embedding models from the
 * live `/models` list. The point is that pasting a key or choosing a provider
 * fills the rest in; nothing here is required for a custom endpoint.
 */

/** One hosted service Axiom can pre-fill. */
export interface HostedProviderPreset {
  id: string;
  label: string;
  /** OpenAI-compatible root, before /chat/completions. */
  baseUrl: string;
  /**
   * Key prefixes that identify the service. Longest match wins, so `sk-or-`
   * is checked before the generic `sk-`.
   */
  keyPrefixes: readonly string[];
  /** Model IDs to prefer, best first; checked against the live list. */
  preferChat: readonly string[];
  preferVision: readonly string[];
  preferEmbed: readonly string[];
}

/**
 * The services worth naming. Ordered roughly by how likely a learner is to
 * point Axiom at them; the order only matters when two presets share a prefix.
 */
export const HOSTED_PROVIDERS: readonly HostedProviderPreset[] = [
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPrefixes: ['gsk_'],
    // Self-serve free-tier models: Llama 3.x and the Llama 4 vision models
    // have moved to enterprise-only, so prefer the GPT-OSS pair and Qwen.
    preferChat: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    // Qwen 3.8 27B is Groq's multimodal model: images in, up to 3 per request.
    preferVision: ['qwen/qwen3.8-27b'],
    // Groq has no /embeddings endpoint, so retrieval falls back to keywords.
    preferEmbed: [],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPrefixes: ['sk-or-'],
    preferChat: [
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-haiku',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    preferVision: ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001'],
    preferEmbed: ['openai/text-embedding-3-small', 'openai/text-embedding-3-large'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyPrefixes: ['sk-proj-', 'sk-'],
    preferChat: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    preferVision: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    preferEmbed: ['text-embedding-3-small', 'text-embedding-3-large'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyPrefixes: ['AIza'],
    preferChat: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'],
    preferVision: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'],
    preferEmbed: ['text-embedding-004', 'gemini-embedding-001'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    keyPrefixes: [],
    preferChat: ['mistral-small-latest', 'mistral-large-latest'],
    preferVision: ['pixtral-12b-2409', 'mistral-small-latest'],
    preferEmbed: ['mistral-embed'],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyPrefixes: ['csk-'],
    preferChat: ['llama-3.3-70b', 'llama3.1-8b'],
    preferVision: [],
    preferEmbed: [],
  },
  {
    id: 'xai',
    label: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    keyPrefixes: ['xai-'],
    preferChat: ['grok-4-fast-non-reasoning', 'grok-3-mini', 'grok-2-latest'],
    preferVision: ['grok-2-vision-latest', 'grok-4-fast-non-reasoning'],
    preferEmbed: [],
  },
];

/** The preset whose root matches this base URL, or null for a custom endpoint. */
export function presetForBaseUrl(baseUrl: string): HostedProviderPreset | null {
  const trimmed = baseUrl.trim();
  if (trimmed === '') return null;
  const normalized = normalizeBaseUrl(trimmed);
  return (
    HOSTED_PROVIDERS.find((preset) => normalizeBaseUrl(preset.baseUrl) === normalized) ?? null
  );
}

/**
 * Guess the service from the shape of its key. Returns null for a custom
 * endpoint, an unrecognised key, or a key that is still being typed.
 */
export function hostedProviderForKey(apiKey: string): HostedProviderPreset | null {
  const key = apiKey.trim();
  if (key === '') return null;
  let match: HostedProviderPreset | null = null;
  let matchLength = 0;
  for (const preset of HOSTED_PROVIDERS) {
    for (const prefix of preset.keyPrefixes) {
      if (key.startsWith(prefix) && prefix.length > matchLength) {
        match = preset;
        matchLength = prefix.length;
      }
    }
  }
  return match;
}

/**
 * List the model IDs the endpoint advertises. Hosted endpoints answer
 * `GET {root}/models` with a Bearer key; this is the same shape as the local
 * probe, so the picking logic below works for either.
 */
export async function listHostedModels(
  baseUrl: string,
  apiKey: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/models`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = apiKey.trim();
  if (key !== '') headers.Authorization = `Bearer ${key}`;

  let response: Response;
  try {
    response = await getFetch()(url, {
      headers,
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch {
    throw new Error(`Could not reach ${url}. Check the base URL and your connection.`);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `The provider rejected the API key (HTTP ${response.status}). Check that the key is complete and belongs to this provider.`,
      );
    }
    throw new Error(`The provider answered HTTP ${response.status} for ${url}. Check the base URL.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${url} did not return JSON. Check that the base URL is the OpenAI-compatible root.`);
  }

  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error(`${url} returned no model list. Check that the base URL is the OpenAI-compatible root.`);
  }
  const models = data
    .map((entry) =>
      typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id : null,
    )
    .filter((id): id is string => id !== null);
  if (models.length === 0) {
    throw new Error('The provider returned an empty model list. Check the API key and base URL.');
  }
  return models;
}

/** The three model roles picked from a provider's advertised list. */
export interface HostedModelPicks {
  chatModel: string;
  /** Empty when the endpoint advertises no vision model. */
  ocrModel: string;
  /** Empty when the endpoint has no /embeddings or no embedding model. */
  embedModel: string;
}

/**
 * Split an advertised model list into roles. Known providers first try their
 * own preferred IDs; anything left over falls back to name heuristics so a
 * custom endpoint still gets a sensible starting point.
 */
export function pickHostedModels(
  models: readonly string[],
  preset: HostedProviderPreset | null = null,
): HostedModelPicks {
  const firstPresent = (candidates: readonly string[]) =>
    candidates.find((id) => models.includes(id)) ?? '';

  const embedModel =
    firstPresent(preset?.preferEmbed ?? []) ||
    models.find((id) => /embed/i.test(id) && !VISION_HINT.test(id)) ||
    '';

  const ocrModel =
    firstPresent(preset?.preferVision ?? []) ||
    models.find((id) => VISION_HINT.test(id) && !/embed/i.test(id)) ||
    '';

  const textModels = models.filter((id) => !/embed/i.test(id));
  const chatModel =
    firstPresent(preset?.preferChat ?? []) ||
    textModels.find((id) => /chat|instruct/i.test(id) && !VISION_HINT.test(id)) ||
    textModels.find((id) => !VISION_HINT.test(id)) ||
    textModels[0] ||
    '';

  return { chatModel, ocrModel, embedModel };
}
